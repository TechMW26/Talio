import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateVisionContent } from '@/lib/gemini'
import fs from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * Helper function to determine if a URL is remote or local
 */
function isRemoteUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'))
}

/**
 * Helper function to fetch image as base64 from URL or local path
 */
async function fetchImageAsBase64(url) {
  if (isRemoteUrl(url)) {
    // Fetch from remote URL
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    return buffer.toString('base64')
  } else {
    // Read from local file path
    const filePath = path.join(process.cwd(), url)
    const buffer = await fs.readFile(filePath)
    return buffer.toString('base64')
  }
}

/**
 * Helper function to determine mime type from URL
 */
function getMimeType(url) {
  const lowerUrl = url.toLowerCase()
  if (lowerUrl.includes('.png')) return 'image/png'
  if (lowerUrl.includes('.webp')) return 'image/webp'
  if (lowerUrl.includes('.gif')) return 'image/gif'
  return 'image/jpeg' // Default to JPEG
}

/**
 * POST /api/profile/verify-aadhaar
 * Verify Aadhaar documents using OCR (Gemini Vision)
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { User, Employee } = models

    const user = await User.findById(authUser._id || authUser.userId)
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
    const employee = await Employee.findById(user.employeeId)
      .select('firstName lastName dateOfBirth address')
      .lean()

    if (!employee) {
      return NextResponse.json({
        success: false,
        message: 'Employee profile not found. Please complete your profile first.',
        failureReason: 'PROFILE_NOT_FOUND',
        suggestion: 'Please complete your personal information in the profile section before verifying Aadhaar.'
      }, { status: 400 })
    }

    // Fetch image data (works for both remote URLs and local paths)
    let frontImageData, backImageData

    try {
      console.log('[OCR] Fetching Aadhaar images...')
      console.log('[OCR] Front URL:', frontUrl)
      console.log('[OCR] Back URL:', backUrl)

      // Fetch images in parallel
      const [frontData, backData] = await Promise.all([
        fetchImageAsBase64(frontUrl),
        fetchImageAsBase64(backUrl)
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

    // Determine mime types from URLs
    const frontMime = getMimeType(frontUrl)
    const backMime = getMimeType(backUrl)

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
      const response = await generateVisionContent(ocrPrompt, [
        { mimeType: frontMime, data: frontImageData },
        { mimeType: backMime, data: backImageData }
      ])

      // Parse the JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        ocrResult = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('Invalid OCR response format')
      }
    } catch (error) {
      console.error('[OCR] Gemini Vision error:', error)

      // Update verification status to failed
      await User.findByIdAndUpdate(authUser._id || authUser.userId, {
        $set: {
          'profileCompletion.ocrVerification.status': 'failed',
          'profileCompletion.ocrVerification.verifiedAt': new Date(),
          'profileCompletion.ocrVerification.failureReason': 'OCR_PROCESSING_FAILED'
        }
      })

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

      await User.findByIdAndUpdate(authUser._id || authUser.userId, {
        $set: {
          'profileCompletion.ocrVerification.status': 'failed',
          'profileCompletion.ocrVerification.verifiedAt': new Date(),
          'profileCompletion.ocrVerification.failureReason': 'INVALID_DOCUMENT',
          'profileCompletion.ocrVerification.validationIssues': validationIssues
        }
      })

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
    if (ocrResult.address && (!employee.address || employee.address.trim() === '')) {
      suggestions.push(`Your address from Aadhaar can be added to your profile: "${ocrResult.address}"`)
    }

    // Determine verification status
    const verificationStatus = mismatches.length > 0 ? 'mismatch' : 'verified'
    const isComplete = verificationStatus === 'verified'

    // Update user's OCR verification status
    const updateData = {
      'profileCompletion.ocrVerification.status': verificationStatus,
      'profileCompletion.ocrVerification.extractedData': {
        name: ocrResult.name,
        dateOfBirth: ocrResult.dateOfBirth,
        aadhaarNumber: ocrResult.aadhaarNumber,
        address: ocrResult.address
      },
      'profileCompletion.ocrVerification.mismatches': mismatches,
      'profileCompletion.ocrVerification.suggestions': suggestions,
      'profileCompletion.ocrVerification.verifiedAt': new Date(),
      'profileCompletion.ocrVerification.confidence': ocrResult.confidence,
      'profileCompletion.completedFields.ocrVerified': isComplete
    }

    // Update overall profile completion status if verified
    if (isComplete && user.profileCompletion?.completedFields?.personalInfo &&
      user.profileCompletion?.completedFields?.aadhaarUploaded) {
      updateData['profileCompletion.status'] = 'complete'
      updateData['profileCompletion.completedAt'] = new Date()
    } else if (user.profileCompletion?.completedFields?.aadhaarUploaded) {
      updateData['profileCompletion.status'] = 'partially_complete'
    }

    await User.findByIdAndUpdate(authUser._id || authUser.userId, { $set: updateData })

    // Auto-fill address from Aadhaar OCR if employee address is missing
    let addressAutoFilled = false
    if (ocrResult.address && (!employee.address || employee.address.trim() === '')) {
      try {
        await Employee.findByIdAndUpdate(user.employeeId, {
          $set: { address: ocrResult.address }
        })
        addressAutoFilled = true
        console.log('[OCR] Auto-filled address from Aadhaar for employee:', user.employeeId)
      } catch (addressError) {
        console.error('[OCR] Failed to auto-fill address:', addressError)
        // Don't fail the verification if address update fails
      }
    }

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
    }, { status: 500 })
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
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { User } = models

    const user = await User.findById(authUser._id || authUser.userId)
      .select('profileCompletion.ocrVerification')
      .lean()

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
