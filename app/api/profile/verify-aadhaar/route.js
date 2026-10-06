import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProfileStore, getProfileRecords, saveAadhaarVerification, invalidateProfile } from '@/lib/platform/firestoreProfile.server'
import { generateVisionContent } from '@/lib/gemini'
import { parseAIJsonResponse } from '@/lib/aiJsonResponse'
import { compressScreenshot } from '@/lib/imageCompression'
import { readProfileDocumentImage } from '@/lib/platform/profileDocumentImage.server'

export const dynamic = 'force-dynamic'

/**
 * Downscale/compress an uploaded document image before OCR so large photos
 * don't slow down or exceed the vision model's request budget.
 */
async function compressForOCR(imageData) {
  try {
    const compressed = await compressScreenshot(imageData.base64, {
      maxWidth: 1600,
      maxHeight: 1200,
      quality: 85,
      returnDataUri: true,
    });
    const match = compressed.fullData.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  } catch (error) {
    console.error('[OCR] Image compression failed:', error.message);
  }
  return { mimeType: imageData.mimeType, data: imageData.base64 };
}

/**
 * POST /api/profile/verify-aadhaar
 * Verify Aadhaar documents using OCR (Gemini Vision)
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser } = auth
    const store = await getProfileStore(auth.tenant.databaseName)
    const { user, employee } = await getProfileRecords(store, authUser._id || authUser.userId)
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Check if both Aadhaar images are uploaded
    const frontUrl = user.profileCompletion?.aadhaarFront?.url
    const backUrl = user.profileCompletion?.aadhaarBack?.url

    if (!frontUrl || !backUrl) {
      return NextResponse.json({
        success: false,
        message: 'Both Aadhaar front and back images must be uploaded before verification',
        failureReason: 'MISSING_IMAGES',
        suggestion: 'Please upload both front and back images of your Aadhaar card.'
      }, { status: 400 })
    }

    // Get employee data for comparison

    if (!employee) {
      return NextResponse.json({
        success: false,
        message: 'Employee profile not found. Please complete your profile first.',
        failureReason: 'PROFILE_NOT_FOUND',
        suggestion: 'Please complete your personal information in the profile section before verifying Aadhaar.'
      }, { status: 400 })
    }

    // Read verified tenant media or retained ImageKit references.
    let frontImageData, backImageData

    try {
      console.log('[OCR] Fetching Aadhaar images...')

      // Fetch images in parallel
      const [frontData, backData] = await Promise.all([
        readProfileDocumentImage(user.profileCompletion.aadhaarFront, auth.tenant.databaseName),
        readProfileDocumentImage(user.profileCompletion.aadhaarBack, auth.tenant.databaseName)
      ])

      frontImageData = frontData
      backImageData = backData
      console.log('[OCR] Successfully fetched both images')
    } catch (error) {
      console.error('[OCR] Error fetching images:', error)
      return NextResponse.json({
        success: false,
        message: 'Failed to fetch Aadhaar images. Please re-upload them.',
        failureReason: 'IMAGE_FETCH_FAILED',
        suggestion: 'The uploaded images could not be accessed. Please try uploading clearer images of your Aadhaar card.',
        error: error.message
      }, { status: 400 })
    }

    // OCR extraction prompt with detailed field extraction
    const ocrPrompt = `You are analyzing Indian Aadhaar card images (front and back).
Extract the following information and return it as JSON only, with no additional text:

{
  "name": "Full name as printed on the card",
  "dateOfBirth": "Date of birth in DD/MM/YYYY format",
  "aadhaarNumber": "Last 4 digits of Aadhaar number only (for security)",
  "gender": "Male/Female/Other",
  "address": "Complete address as printed on the card",
  "isValid": true/false (whether this appears to be a valid Aadhaar card),
  "confidence": 0-100 (confidence score of extraction accuracy),
  "validationIssues": ["List of any issues found with the document, e.g., 'Image blurry', 'Text not readable', 'Not an Aadhaar card'"]
}

Important:
- Extract name exactly as printed (in English)
- For security, only extract last 4 digits of Aadhaar number
- Return ONLY the JSON object, no explanations
- If you cannot read certain fields clearly, set them to null and add the issue to validationIssues
- Set isValid to false if the images don't appear to be valid Aadhaar cards
- Include specific reasons in validationIssues if document appears invalid`

    // Call Gemini Vision API with both images
    let ocrResult
    try {
      const [frontImage, backImage] = await Promise.all([
        compressForOCR(frontImageData),
        compressForOCR(backImageData)
      ])

      const response = await generateVisionContent(ocrPrompt, [frontImage, backImage])

      ocrResult = parseAIJsonResponse(response, { expectedRoot: 'object' })
    } catch (error) {
      console.error('[OCR] Gemini Vision error:', error)

      // Update verification status to failed
      await saveAadhaarVerification(store, user, { status: 'failed', verifiedAt: new Date(), failureReason: 'OCR_PROCESSING_FAILED' })
      await invalidateProfile(auth.tenant.databaseName, user._id)

      return NextResponse.json({
        success: false,
        message: 'OCR verification failed. Please ensure the images are clear and try again.',
        failureReason: 'OCR_PROCESSING_FAILED',
        suggestion: 'Please upload high-quality, well-lit images of your Aadhaar card. Make sure the text is clearly visible and the document is not blurry.',
        error: error.message
      }, { status: 400 })
    }

    // Check if the document appears valid
    if (!ocrResult.isValid) {
      const validationIssues = ocrResult.validationIssues || ['Document does not appear to be a valid Aadhaar card']

      await saveAadhaarVerification(store, user, { status: 'failed', verifiedAt: new Date(), failureReason: 'INVALID_DOCUMENT', validationIssues })
      await invalidateProfile(auth.tenant.databaseName, user._id)

      return NextResponse.json({
        success: false,
        message: 'The uploaded images do not appear to be valid Aadhaar cards.',
        failureReason: 'INVALID_DOCUMENT',
        validationIssues: validationIssues,
        suggestion: 'Please upload clear photos of your original Aadhaar card. Ensure both front and back sides are clearly visible and the document is not expired or damaged.',
        confidence: ocrResult.confidence
      }, { status: 400 })
    }

    // Compare extracted data with profile
    const mismatches = []
    const suggestions = []

    // Compare name
    const profileName = `${employee.firstName} ${employee.lastName}`.toLowerCase().trim()
    const aadhaarName = (ocrResult.name || '').toLowerCase().trim()

    if (aadhaarName && !compareNames(profileName, aadhaarName)) {
      mismatches.push({
        field: 'Name',
        profileValue: `${employee.firstName} ${employee.lastName}`,
        aadhaarValue: ocrResult.name
      })
      suggestions.push(`Update your profile name to match your Aadhaar: "${ocrResult.name}"`)
    }

    // Compare date of birth
    if (employee.dateOfBirth && ocrResult.dateOfBirth) {
      const profileDob = formatDateForComparison(employee.dateOfBirth)
      const aadhaarDob = ocrResult.dateOfBirth

      if (profileDob && aadhaarDob && !compareDates(profileDob, aadhaarDob)) {
        mismatches.push({
          field: 'Date of Birth',
          profileValue: profileDob,
          aadhaarValue: aadhaarDob
        })
        suggestions.push(`Update your profile date of birth to match your Aadhaar: "${ocrResult.dateOfBirth}"`)
      }
    } else if (!employee.dateOfBirth && ocrResult.dateOfBirth) {
      // Date of birth missing in profile but available in Aadhaar
      suggestions.push(`Add your date of birth from Aadhaar to your profile: "${ocrResult.dateOfBirth}"`)
    }

    // Check for address
    const profileAddress = formatAddress(employee.address)
    if (ocrResult.address && !profileAddress) {
      suggestions.push(`Your address from Aadhaar can be added to your profile: "${ocrResult.address}"`)
    }

    // Determine verification status
    const verificationStatus = mismatches.length > 0 ? 'mismatch' : 'verified'
    const isComplete = verificationStatus === 'verified'

    // Update user's OCR verification status
    const verification = {
      status: verificationStatus,
      extractedData: {
        name: ocrResult.name,
        dateOfBirth: ocrResult.dateOfBirth,
        aadhaarNumber: ocrResult.aadhaarNumber,
        address: ocrResult.address
      },
      mismatches, suggestions, verifiedAt: new Date(), confidence: ocrResult.confidence,
    }

    const { addressAutoFilled } = await saveAadhaarVerification(store, user, verification, {
      employeeId: employee._id, address: !profileAddress ? ocrResult.address : undefined,
    })
    await invalidateProfile(auth.tenant.databaseName, user._id)

    // Prepare response
    if (mismatches.length > 0) {
      return NextResponse.json({
        success: true,
        verified: false,
        message: 'Aadhaar verification found mismatches with your profile data',
        failureReason: 'DATA_MISMATCH',
        data: {
          status: 'mismatch',
          extractedData: {
            name: ocrResult.name,
            dateOfBirth: ocrResult.dateOfBirth,
            aadhaarNumber: ocrResult.aadhaarNumber ? `XXXX-XXXX-${ocrResult.aadhaarNumber}` : null,
            address: ocrResult.address
          },
          mismatches,
          suggestions,
          confidence: ocrResult.confidence,
          addressAutoFilled
        },
        suggestion: suggestions.length > 0
          ? `To fix: ${suggestions.join('. ')}`
          : 'Please update your profile information to match your Aadhaar details (Name, DOB, Address).'
      })
    }

    return NextResponse.json({
      success: true,
      verified: true,
      message: addressAutoFilled
        ? 'Aadhaar verification successful. Address has been auto-filled from your Aadhaar card.'
        : 'Aadhaar verification successful',
      data: {
        status: 'verified',
        extractedData: {
          name: ocrResult.name,
          dateOfBirth: ocrResult.dateOfBirth,
          aadhaarNumber: ocrResult.aadhaarNumber ? `XXXX-XXXX-${ocrResult.aadhaarNumber}` : null
        },
        confidence: ocrResult.confidence,
        addressAutoFilled
      }
    })

  } catch (error) {
    console.error('[OCR Verification] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to verify Aadhaar document'
    }, { status: error.status || 500 })
  }
}

/**
 * Compare two names with fuzzy matching
 * Handles different orderings and minor variations
 */
function compareNames(name1, name2) {
  // Normalize names
  const normalize = (name) => name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')

  const n1 = normalize(name1)
  const n2 = normalize(name2)

  // Exact match after normalization
  if (n1 === n2) return true

  // Check if all words from one are contained in the other
  const words1 = n1.split(' ')
  const words2 = n2.split(' ')

  const allWords1InWords2 = words1.every(w =>
    words2.some(w2 => w2.includes(w) || w.includes(w2))
  )
  const allWords2InWords1 = words2.every(w =>
    words1.some(w1 => w1.includes(w) || w.includes(w1))
  )

  return allWords1InWords2 || allWords2InWords1
}

function formatAddress(address) {
  if (!address) return ''
  if (typeof address === 'string') return address.trim()
  return [
    address.fullAddress,
    address.street,
    address.city,
    address.state,
    address.country,
    address.postalCode,
  ].filter(Boolean).join(', ').trim()
}

/**
 * Compare two dates
 */
function compareDates(date1, date2) {
  // Parse dates in various formats
  const parseDate = (dateStr) => {
    if (!dateStr) return null

    // Try DD/MM/YYYY format
    const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (ddmmyyyy) {
      return new Date(ddmmyyyy[3], ddmmyyyy[2] - 1, ddmmyyyy[1])
    }

    // Try YYYY-MM-DD format
    const yyyymmdd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (yyyymmdd) {
      return new Date(yyyymmdd[1], yyyymmdd[2] - 1, yyyymmdd[3])
    }

    return new Date(dateStr)
  }

  const d1 = parseDate(date1)
  const d2 = parseDate(date2)

  if (!d1 || !d2 || isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    return false
  }

  return d1.toDateString() === d2.toDateString()
}

/**
 * Format date for comparison
 */
function formatDateForComparison(date) {
  if (!date) return null
  const d = new Date(date)
  if (isNaN(d.getTime())) return null

  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()

  return `${day}/${month}/${year}`
}

/**
 * GET /api/profile/verify-aadhaar
 * Get OCR verification status
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser } = auth
    const store = await getProfileStore(auth.tenant.databaseName)
    const user = await store.get('users', authUser._id || authUser.userId)

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const verification = user.profileCompletion?.ocrVerification || {
      status: 'pending',
      extractedData: null,
      mismatches: [],
      verifiedAt: null
    }

    return NextResponse.json({
      success: true,
      data: verification
    })

  } catch (error) {
    console.error('[OCR Status] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to get verification status'
    }, { status: 500 })
  }
}
