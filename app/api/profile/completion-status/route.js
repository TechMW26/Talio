import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'

/**
 * GET /api/profile/completion-status
 * Get comprehensive profile completion status
 */
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee } = models

    const user = await User.findById(decoded.userId)
      .select('employeeId isActive profileCompletion suspensionReason suspendedAt')
      .lean()

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Check if account is suspended due to profile incomplete
    if (!user.isActive && user.suspensionReason === 'profile_incomplete') {
      return NextResponse.json({
        success: true,
        data: {
          status: 'suspended',
          suspensionReason: 'profile_incomplete',
          suspendedAt: user.suspendedAt,
          message: 'Your account has been suspended due to incomplete profile. Please contact HR.'
        }
      })
    }

    const profileCompletion = user.profileCompletion || {}

    // Calculate days remaining
    let daysRemaining = null
    let deadline = null
    
    if (profileCompletion.profileCompletionDeadline) {
      deadline = new Date(profileCompletion.profileCompletionDeadline)
      const now = new Date()
      const diffTime = deadline - now
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (daysRemaining < 0) daysRemaining = 0
    }

    // Get employee data to check mandatory fields and track which are missing
    let personalInfoComplete = false
    let missingPersonalFields = []
    let filledPersonalFields = []
    
    if (user.employeeId) {
      const employee = await Employee.findById(user.employeeId)
        .select('firstName lastName email phone dateOfBirth gender address bloodGroup')
        .lean()

      if (employee) {
        // Check each mandatory field individually
        const fieldChecks = {
          'First Name': !!employee.firstName,
          'Last Name': !!employee.lastName,
          'Email': !!employee.email,
          'Phone Number': !!employee.phone,
          'Date of Birth': !!employee.dateOfBirth,
          'Gender': !!employee.gender,
          // Address can be a string or object - handle both
          'Address': !!(employee.address && (
            typeof employee.address === 'string' 
              ? employee.address.trim().length > 0
              : (employee.address.city || employee.address.street || employee.address.state)
          ))
        }

        // Categorize fields
        for (const [field, isComplete] of Object.entries(fieldChecks)) {
          if (isComplete) {
            filledPersonalFields.push(field)
          } else {
            missingPersonalFields.push(field)
          }
        }

        // Personal info is complete if all mandatory fields are filled
        personalInfoComplete = missingPersonalFields.length === 0
      }
    }

    // Check Aadhaar upload status
    const aadhaarFrontUploaded = !!profileCompletion.aadhaarFront?.url
    const aadhaarBackUploaded = !!profileCompletion.aadhaarBack?.url
    const aadhaarComplete = aadhaarFrontUploaded && aadhaarBackUploaded

    // Check OCR verification status
    const ocrStatus = profileCompletion.ocrVerification?.status || 'pending'
    const ocrComplete = ocrStatus === 'verified' || ocrStatus === 'matched'
    
    // Get extracted data from OCR (including address)
    const ocrExtractedData = profileCompletion.ocrVerification?.extractedData || null

    // Calculate completion percentage based on actual completion
    // Personal Info: 40%, Aadhaar Upload: 30%, OCR Verification: 30%
    let completionPercentage = 0
    if (personalInfoComplete) completionPercentage += 40
    if (aadhaarComplete) completionPercentage += 30
    if (ocrComplete) completionPercentage += 30

    // Determine display status
    const isFullyComplete = personalInfoComplete && aadhaarComplete && ocrComplete
    let displayStatus = 'incomplete'
    if (isFullyComplete) {
      displayStatus = 'complete'
    } else if (completionPercentage > 0) {
      displayStatus = 'partially_complete'
    }

    return NextResponse.json({
      success: true,
      data: {
        status: displayStatus,
        completionPercentage,
        isComplete: isFullyComplete,
        showModal: !isFullyComplete,
        deadline,
        daysRemaining,
        firstLoginAt: profileCompletion.firstLoginAt,
        completedAt: profileCompletion.completedAt,
        steps: {
          personalInfo: {
            complete: personalInfoComplete,
            label: 'Personal Information',
            description: missingPersonalFields.length > 0 
              ? `Missing: ${missingPersonalFields.join(', ')}` 
              : 'All personal details are complete',
            filledFields: filledPersonalFields,
            missingFields: missingPersonalFields,
            totalFields: 7,
            completedCount: filledPersonalFields.length
          },
          aadhaarUpload: {
            complete: aadhaarComplete,
            frontUploaded: aadhaarFrontUploaded,
            backUploaded: aadhaarBackUploaded,
            label: 'Aadhaar Upload',
            description: aadhaarComplete 
              ? 'Front & Back uploaded'
              : aadhaarFrontUploaded
                ? 'Back side pending'
                : aadhaarBackUploaded
                  ? 'Front side pending'
                  : 'Upload front and back of your Aadhaar card'
          },
          ocrVerification: {
            complete: ocrComplete,
            status: ocrStatus,
            mismatches: profileCompletion.ocrVerification?.mismatches || [],
            extractedData: ocrExtractedData,
            label: 'Identity Verification',
            description: ocrComplete
              ? 'Verification successful'
              : ocrStatus === 'mismatch'
                ? 'Data mismatch found - please review'
                : ocrStatus === 'failed'
                  ? 'Verification failed - please retry'
                  : 'Verify your identity through Aadhaar OCR'
          }
        },
        warning: daysRemaining !== null && daysRemaining <= 7 ? {
          message: daysRemaining === 0 
            ? 'Your profile completion deadline has passed. Your account may be suspended.'
            : `You have ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left to complete your profile.`,
          urgent: daysRemaining <= 2
        } : null
      }
    })

  } catch (error) {
    console.error('[Profile Status] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to get profile status'
    }, { status: 500 })
  }
}

/**
 * POST /api/profile/completion-status
 * Update profile completion status (mark personal info complete)
 */
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const user = await User.findById(decoded.userId)
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action } = body

    if (action === 'mark_personal_info_complete') {
      // Verify employee has required fields
      if (!user.employeeId) {
        return NextResponse.json({
          success: false,
          message: 'Employee profile not found'
        }, { status: 400 })
      }

      const employee = await Employee.findById(user.employeeId)
        .select('firstName lastName email phone dateOfBirth address')
        .lean()

      if (!employee) {
        return NextResponse.json({
          success: false,
          message: 'Employee profile not found'
        }, { status: 400 })
      }

      // Check mandatory fields
      const missingFields = []
      if (!employee.firstName) missingFields.push('First Name')
      if (!employee.lastName) missingFields.push('Last Name')
      if (!employee.email) missingFields.push('Email')
      if (!employee.phone) missingFields.push('Phone')
      if (!employee.dateOfBirth) missingFields.push('Date of Birth')
      if (!employee.address?.city) missingFields.push('City')
      if (!employee.address?.state) missingFields.push('State')

      if (missingFields.length > 0) {
        return NextResponse.json({
          success: false,
          message: `Please complete the following fields: ${missingFields.join(', ')}`
        }, { status: 400 })
      }

      // Update completion status
      const completedFields = user.profileCompletion?.completedFields || {}
      const updateData = {
        'profileCompletion.completedFields.personalInfo': true
      }

      // Update overall status
      if (completedFields.aadhaarUploaded && completedFields.ocrVerified) {
        updateData['profileCompletion.status'] = 'complete'
        updateData['profileCompletion.completedAt'] = new Date()
      } else if (completedFields.aadhaarUploaded) {
        updateData['profileCompletion.status'] = 'partially_complete'
      }

      await User.findByIdAndUpdate(decoded.userId, { $set: updateData })

      return NextResponse.json({
        success: true,
        message: 'Personal information marked as complete'
      })
    }

    return NextResponse.json({
      success: false,
      message: 'Invalid action'
    }, { status: 400 })

  } catch (error) {
    console.error('[Profile Status Update] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to update profile status'
    }, { status: 500 })
  }
}
