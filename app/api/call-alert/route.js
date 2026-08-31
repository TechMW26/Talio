import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { 
  generateSpeechBase64, 
  processMessageTemplate, 
  PREBUILT_MESSAGES 
} from '@/lib/audio';
import mongoose from 'mongoose';

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

/**
 * POST /api/call-alert
 * Send a call/alert to selected users
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'CallAlert'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department, CallAlert } = models

    const userId = user?._id || user?.userId
    if (!userId || !isValidObjectId(userId.toString())) {
      return NextResponse.json(
        { success: false, message: 'Invalid user ID' },
        { status: 400 }
      );
    }

    // Get sender user and employee data from auth
  const senderUser = await User.findById(userId);
    if (!senderUser || !senderUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found or inactive' },
        { status: 404 }
      );
    }

    if (!senderUser.employeeId || !isValidObjectId(senderUser.employeeId.toString())) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee reference' },
        { status: 400 }
      );
    }

    const senderEmployee = await Employee.findById(senderUser.employeeId)
      .populate({
        path: 'department',
        select: 'name',
        options: { strictPopulate: false }
      });
    
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

    // Permission check: Only admin, admin, or department_head can send alerts
    const isAdmin = ['admin'].includes(senderUser.role);
    const isDepartmentHead = senderUser.role === 'department_head' || !!senderDepartmentHead;

    if (!isAdmin && !isDepartmentHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to send call alerts' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
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

    const normalizedTargetIds = targetUserIds
      .map(id => id?.toString?.())
      .filter(Boolean)

    if (normalizedTargetIds.some(id => !isValidObjectId(id))) {
      return NextResponse.json(
        { success: false, message: 'Invalid recipient ID provided' },
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
      _id: { $in: normalizedTargetIds },
      isActive: true
    }).populate({
      path: 'employeeId',
      populate: { 
        path: 'department', 
        select: 'name',
        options: { strictPopulate: false }
      },
      options: { strictPopulate: false }
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
      console.log(`[CallAlert] Voice generation ENABLED, starting generation for ${processedMessages.length} messages...`);
      console.log(`[CallAlert] Pollinations API Key present:`, !!process.env.POLLINATIONS_API_KEY);
      
      callAlert.voiceGeneration.status = 'generating';
      await callAlert.save();

      try {
        // Generate voice for each personalized message
        for (const pm of processedMessages) {
          console.log(`[CallAlert] Generating voice for receiver ${pm.receiverId}, message length: ${pm.message.length}`);
          
          const voiceResult = await generateSpeechBase64(pm.message, {
            preset: priority === 'urgent' ? 'urgent' : 'default'
          });

          if (voiceResult.success) {
            console.log(`[CallAlert] ✅ Voice generated successfully, audioDataUrl length: ${voiceResult.audioDataUrl?.length || 0}`);
            
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
            console.error(`[CallAlert] Voice generation failed for receiver ${pm.receiverId}:`, voiceResult.error);
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

        // Log payload details for debugging
        console.log(`📢 [CallAlert] Emitting alert to user:${receiver.user}`, {
          voiceEnabled: alertPayload.voiceEnabled,
          hasAudioDataUrl: !!alertPayload.audioDataUrl,
          audioDataUrlLength: alertPayload.audioDataUrl?.length || 0,
          priority: alertPayload.priority
        });

        // Emit to user's room
        global.io.to(`user:${receiver.user}`).emit('call-alert', alertPayload);
        console.log(`📢 [CallAlert] Alert emitted to user:${receiver.user}`);

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['CallAlert'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
  const { user, models } = auth
  const { CallAlert } = models

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'received'; // 'sent', 'received', or 'logs'
    const limitParam = searchParams.get('limit') || '20'
    const skipParam = searchParams.get('skip') || '0'
    const limit = Number.parseInt(limitParam, 10)
    const skip = Number.parseInt(skipParam, 10)

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return NextResponse.json(
        { success: false, message: 'Invalid limit value' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(skip) || skip < 0) {
      return NextResponse.json(
        { success: false, message: 'Invalid skip value' },
        { status: 400 }
      )
    }

    const isAdmin = ['admin'].includes(user.role);

    let alerts;

    if (type === 'logs' && isAdmin) {
      // Admin can see all logs
      alerts = await CallAlert.getAlertLogs({ limit, skip });
    } else if (type === 'sent') {
      // Get alerts sent by user
      alerts = await CallAlert.find({ sender: user._id })
        .populate({
          path: 'receivers.employee',
          select: 'firstName lastName employeeCode',
          options: { strictPopulate: false }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
    } else {
      // Get alerts received by user
      alerts = await CallAlert.getAlertsForUser(user._id, { limit, skip });
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
