import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';
import CallAlert from '@/models/CallAlert';
import { 
  generateSpeechBase64, 
  processMessageTemplate, 
  PREBUILT_MESSAGES 
} from '@/lib/elevenLabs';

/**
 * POST /api/call-alert
 * Send a call/alert to selected users
 */
export async function POST(request) {
  try {
    await connectDB();

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload: decoded } = await jwtVerify(token, secret);

    // Get sender user and employee data
    const senderUser = await User.findById(decoded.userId);
    if (!senderUser || !senderUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found or inactive' },
        { status: 404 }
      );
    }

    const senderEmployee = await Employee.findById(senderUser.employeeId)
      .populate('department', 'name');
    
    if (!senderEmployee) {
      return NextResponse.json(
        { success: false, message: 'Employee profile not found' },
        { status: 404 }
      );
    }

    // Check if user is a department head
    let senderDepartmentHead = null;
    if (senderUser.role === 'department_head' || senderEmployee) {
      senderDepartmentHead = await Department.findOne({
        head: senderEmployee._id,
        isActive: true
      });
    }

    // Permission check: Only admin, god_admin, or department_head can send alerts
    const isAdmin = ['admin', 'god_admin'].includes(senderUser.role);
    const isDepartmentHead = senderUser.role === 'department_head' || !!senderDepartmentHead;

    if (!isAdmin && !isDepartmentHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to send call alerts' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      targetUserIds,
      messageTemplate,
      prebuiltMessageId,
      priority = 'high',
      alertSound = 'default',
      triggerPlatform = 'web',
      triggerLocation = 'dashboard',
      generateVoice = true
    } = body;

    // Validate target users
    if (!targetUserIds || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Please select at least one recipient' },
        { status: 400 }
      );
    }

    // Get message template
    let finalTemplate = messageTemplate;
    if (prebuiltMessageId) {
      const prebuilt = PREBUILT_MESSAGES.find(m => m.id === prebuiltMessageId);
      if (prebuilt) {
        finalTemplate = prebuilt.template;
      }
    }

    if (!finalTemplate || finalTemplate.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: 'Message template is required' },
        { status: 400 }
      );
    }

    // Get target users with their employee data
    const targetUsers = await User.find({
      _id: { $in: targetUserIds },
      isActive: true
    }).populate({
      path: 'employeeId',
      populate: { path: 'department', select: 'name' }
    });

    if (targetUsers.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No valid recipients found' },
        { status: 400 }
      );
    }

    // NOTE: Department heads have full access to send alerts to ALL employees
    // (previously restricted to own department only, now removed per requirement)

    // Build sender name
    const senderName = `${senderEmployee.firstName} ${senderEmployee.lastName}`;

    // Build receivers array and process messages
    const receivers = [];
    const processedMessages = [];

    for (const targetUser of targetUsers) {
      const targetEmployee = targetUser.employeeId;
      if (!targetEmployee) continue;

      const receiverName = `${targetEmployee.firstName} ${targetEmployee.lastName}`;
      const receiverDepartment = targetEmployee.department?.name || 'Unknown Department';

      // Process message with placeholders
      const processedMessage = processMessageTemplate(finalTemplate, {
        senderName,
        senderRole: senderUser.role,
        receiverName,
        receiverDepartment
      });

      receivers.push({
        user: targetUser._id,
        employee: targetEmployee._id,
        name: receiverName,
        department: targetEmployee.department?._id || targetEmployee.department,
        departmentName: receiverDepartment,
        deliveryStatus: {
          socketIO: { delivered: false },
          web: { received: false, audioPlayed: false },
          desktop: { received: false, audioPlayed: false },
          mobile: { received: false, audioPlayed: false }
        },
        acknowledged: false
      });

      processedMessages.push({
        receiverId: targetUser._id,
        message: processedMessage
      });
    }

    // Create call alert record
    const callAlert = new CallAlert({
      sender: senderUser._id,
      senderEmployee: senderEmployee._id,
      senderRole: senderUser.role,
      senderName,
      receivers,
      messageTemplate: finalTemplate,
      processedMessages,
      priority,
      alertSound,
      triggerPlatform,
      triggerLocation,
      status: 'pending',
      voiceGeneration: {
        status: generateVoice ? 'pending' : 'skipped'
      }
    });

    await callAlert.save();

    // Generate voice for each unique message if enabled
    let voiceGenerationResults = [];
    if (generateVoice) {
      callAlert.voiceGeneration.status = 'generating';
      await callAlert.save();

      try {
        // Generate voice for each personalized message
        for (const pm of processedMessages) {
          const voiceResult = await generateSpeechBase64(pm.message, {
            preset: priority === 'urgent' ? 'urgent' : 'default'
          });

          if (voiceResult.success) {
            voiceGenerationResults.push({
              receiverId: pm.receiverId,
              audioDataUrl: voiceResult.audioDataUrl,
              success: true
            });

            callAlert.voiceGeneration.audioUrls.push({
              receiverId: pm.receiverId,
              url: voiceResult.audioDataUrl,
              generatedAt: new Date()
            });
          } else {
            voiceGenerationResults.push({
              receiverId: pm.receiverId,
              success: false,
              error: voiceResult.error
            });
          }
        }

        callAlert.voiceGeneration.status = 'completed';
        callAlert.voiceGeneration.generatedAt = new Date();
      } catch (error) {
        console.error('[CallAlert] Voice generation error:', error);
        callAlert.voiceGeneration.status = 'failed';
        callAlert.voiceGeneration.errorMessage = error.message;
      }

      await callAlert.save();
    }

    // Send real-time alerts via Socket.IO
    if (global.io) {
      for (const receiver of receivers) {
        const processedMsg = processedMessages.find(
          pm => pm.receiverId.toString() === receiver.user.toString()
        );
        const voiceData = voiceGenerationResults.find(
          vr => vr.receiverId.toString() === receiver.user.toString()
        );

        const alertPayload = {
          alertId: callAlert._id,
          sender: {
            id: senderUser._id,
            name: senderName,
            role: senderUser.role,
            employeeCode: senderEmployee.employeeCode
          },
          message: processedMsg?.message || finalTemplate,
          priority,
          alertSound,
          voiceEnabled: generateVoice && voiceData?.success,
          audioDataUrl: voiceData?.audioDataUrl || null,
          timestamp: new Date().toISOString(),
          triggerPlatform,
          triggerLocation
        };

        // Emit to user's room
        global.io.to(`user:${receiver.user}`).emit('call-alert', alertPayload);
        console.log(`📢 [CallAlert] Alert sent to user:${receiver.user}`);

        // Mark as delivered via Socket.IO
        const receiverRecord = callAlert.receivers.find(
          r => r.user.toString() === receiver.user.toString()
        );
        if (receiverRecord) {
          receiverRecord.deliveryStatus.socketIO.delivered = true;
          receiverRecord.deliveryStatus.socketIO.deliveredAt = new Date();
        }
      }

      callAlert.status = 'sent';
      callAlert.sentAt = new Date();
      await callAlert.save();
    }

    console.log(`[CallAlert] Alert ${callAlert._id} created and sent to ${receivers.length} recipients`);

    return NextResponse.json({
      success: true,
      message: `Alert sent successfully to ${receivers.length} recipient(s)`,
      data: {
        alertId: callAlert._id,
        recipientCount: receivers.length,
        voiceGenerated: callAlert.voiceGeneration.status === 'completed',
        status: callAlert.status
      }
    });

  } catch (error) {
    console.error('[CallAlert] Error sending alert:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to send alert', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/call-alert
 * Get call alert history/logs
 */
export async function GET(request) {
  try {
    await connectDB();

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload: decoded } = await jwtVerify(token, secret);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'received'; // 'sent', 'received', or 'logs'
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = parseInt(searchParams.get('skip') || '0');

    const isAdmin = ['admin', 'god_admin'].includes(decoded.role);

    let alerts;

    if (type === 'logs' && isAdmin) {
      // Admin can see all logs
      alerts = await CallAlert.getAlertLogs({ limit, skip });
    } else if (type === 'sent') {
      // Get alerts sent by user
      alerts = await CallAlert.find({ sender: decoded.userId })
        .populate('receivers.employee', 'firstName lastName employeeCode')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
    } else {
      // Get alerts received by user
      alerts = await CallAlert.getAlertsForUser(decoded.userId, { limit, skip });
    }

    return NextResponse.json({
      success: true,
      data: alerts,
      pagination: {
        limit,
        skip,
        count: alerts.length
      }
    });

  } catch (error) {
    console.error('[CallAlert] Error fetching alerts:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch alerts', error: error.message },
      { status: 500 }
    );
  }
}
