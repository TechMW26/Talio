import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { getIO } from '@/lib/socket'
import mongoose from 'mongoose'

// POST - Approve or reject out-of-premises request
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLog', 'Employee', 'User', 'Notification']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { GeofenceLog, Employee, User } = models;

    const { logId, action, comments } = await request.json();

    if (!logId || !mongoose.Types.ObjectId.isValid(logId) || !action) {
      return NextResponse.json(
        { success: false, message: 'Log ID and action are required' },
        { status: 400 }
      );
    }

    if (!['approved', 'rejected'].includes(action)) {
      return NextResponse.json(
        { success: false, message: 'Invalid action. Must be "approved" or "rejected"' },
        { status: 400 }
      );
    }

    // Get user and employee data
    const userRecord = await User.findById(user._id || user.userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      );
    }

    const reviewer = await Employee.findById(userRecord.employeeId).select('firstName lastName department');

    // Get the geofence log
    const log = await GeofenceLog.findById(logId)
      .populate('employee', 'firstName lastName')
      .populate('user')

    if (!log) {
      return NextResponse.json(
        { success: false, message: 'Geofence log not found' },
        { status: 404 }
      )
    }

    if (log.outOfPremisesRequest?.status !== 'pending') {
      return NextResponse.json(
        { success: false, message: 'This request has already been reviewed' },
        { status: 409 }
      )
    }

    // Check if user has permission to approve/reject
    // Only managers, department heads, admin, and HR can approve
    const canApprove = 
      user.role === 'admin' ||
      user.role === 'hr' ||
      (user.role === 'department_head' && reviewer.department?.toString() === log.department?.toString()) ||
      (user.role === 'manager' && log.reportingManager?.toString() === reviewer._id.toString())

    if (!canApprove) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to approve/reject this request' },
        { status: 403 }
      )
    }

    // Update the log
    log.outOfPremisesRequest.status = action
    log.outOfPremisesRequest.reviewedBy = reviewer._id
    log.outOfPremisesRequest.reviewedAt = new Date()
    log.outOfPremisesRequest.reviewerComments = comments || ''

    await log.save()

    // Send notification to employee
    try {
      const employeeUser = log.user
      if (employeeUser) {
        // Send push notification
        await sendPushToUser(
          employeeUser._id.toString(),
          {
            title: `Out-of-Premises Request ${action === 'approved' ? 'Approved ✅' : 'Rejected ❌'}`,
            body: `Your request to be outside office premises has been ${action} by ${reviewer.firstName} ${reviewer.lastName}`,
          },
          {
            eventType: 'geofenceApproval',
            clickAction: '/dashboard/team/geofencing',
            icon: '/icon-192x192.png',
            data: {
              type: 'geofence_approval',
              logId: log._id.toString(),
              action,
            },
            models: { User: models.User, Notification: models.Notification }
          }
        )

        // Send Socket.IO event for real-time notification
        try {
          const io = getIO()
          if (io) {
            io.to(`user:${employeeUser._id.toString()}`).emit('geofence-approval', {
              action,
              log: {
                _id: log._id,
                reason: log.outOfPremisesRequest.reason,
                status: action,
                reviewedBy: {
                  firstName: reviewer.firstName,
                  lastName: reviewer.lastName
                },
                reviewedAt: log.outOfPremisesRequest.reviewedAt,
                reviewerComments: log.outOfPremisesRequest.reviewerComments
              }
            })
            console.log(`[Socket.IO] Sent geofence-approval event to user:${employeeUser._id}`)
          }
        } catch (socketError) {
          console.error('Failed to send Socket.IO event:', socketError)
        }
      }
    } catch (notifError) {
      console.error('Failed to send notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      message: `Request ${action} successfully`,
      data: log
    })

  } catch (error) {
    console.error('Approve geofence request error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to process request' },
      { status: 500 }
    )
  }
}

