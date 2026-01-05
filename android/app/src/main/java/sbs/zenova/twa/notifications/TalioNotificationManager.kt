package sbs.zenova.twa.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import sbs.zenova.twa.MainActivity
import sbs.zenova.twa.R

class TalioNotificationManager(private val context: Context) {

    companion object {
        // Notification Channels
        const val CHANNEL_MESSAGES = "talio_messages"
        const val CHANNEL_ANNOUNCEMENTS = "talio_announcements"
        const val CHANNEL_TASKS = "talio_tasks"
        const val CHANNEL_GENERAL = "talio_general"
        
        // Notification IDs
        const val NOTIFICATION_ID_MESSAGE = 1001
        const val NOTIFICATION_ID_ANNOUNCEMENT = 1002
        const val NOTIFICATION_ID_TASK = 1003
        const val NOTIFICATION_ID_GENERAL = 1004
    }

    init {
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Messages Channel
            val messagesChannel = NotificationChannel(
                CHANNEL_MESSAGES,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Chat messages and direct communications"
                enableLights(true)
                lightColor = Color.BLUE
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 250, 250)
                setShowBadge(true)
            }

            // Announcements Channel
            val announcementsChannel = NotificationChannel(
                CHANNEL_ANNOUNCEMENTS,
                "Announcements",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Company and department announcements"
                enableLights(true)
                lightColor = Color.YELLOW
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500)
                setShowBadge(true)
            }

            // Tasks Channel
            val tasksChannel = NotificationChannel(
                CHANNEL_TASKS,
                "Tasks",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Task assignments and updates"
                enableLights(true)
                lightColor = Color.GREEN
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 200, 300)
                setShowBadge(true)
            }

            // General Channel
            val generalChannel = NotificationChannel(
                CHANNEL_GENERAL,
                "General",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "General notifications"
                enableLights(true)
                lightColor = Color.WHITE
                enableVibration(true)
                setShowBadge(true)
            }

            notificationManager.createNotificationChannels(
                listOf(messagesChannel, announcementsChannel, tasksChannel, generalChannel)
            )
        }
    }

    fun showMessageNotification(
        title: String,
        message: String,
        chatId: String? = null,
        senderId: String? = null,
        senderName: String? = null
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "/dashboard/chat")
            chatId?.let { putExtra("chat_id", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_MESSAGE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setVibrate(longArrayOf(0, 250, 250, 250))
            .setLights(Color.BLUE, 1000, 1000)
            .setColor(Color.parseColor("#192A5A"))
            .build()

        NotificationManagerCompat.from(context).notify(
            NOTIFICATION_ID_MESSAGE + (chatId?.hashCode() ?: 0),
            notification
        )
    }

    fun showAnnouncementNotification(
        title: String,
        content: String,
        priority: String = "normal",
        announcementId: String? = null
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "/dashboard/announcements")
            announcementId?.let { putExtra("announcement_id", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_ANNOUNCEMENT,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationPriority = when (priority.lowercase()) {
            "high", "urgent" -> NotificationCompat.PRIORITY_HIGH
            "critical" -> NotificationCompat.PRIORITY_MAX
            else -> NotificationCompat.PRIORITY_DEFAULT
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ANNOUNCEMENTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("📢 $title")
            .setContentText(content)
            .setStyle(NotificationCompat.BigTextStyle().bigText(content))
            .setPriority(notificationPriority)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setVibrate(longArrayOf(0, 500, 200, 500))
            .setLights(Color.YELLOW, 1000, 1000)
            .setColor(Color.parseColor("#FFA500"))
            .build()

        NotificationManagerCompat.from(context).notify(
            NOTIFICATION_ID_ANNOUNCEMENT + (announcementId?.hashCode() ?: 0),
            notification
        )
    }

    fun showTaskNotification(
        title: String,
        taskTitle: String,
        priority: String = "normal",
        dueDate: String? = null,
        taskId: String? = null,
        action: String = "assigned" // assigned, updated, approved, rejected
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "/dashboard/todo")
            taskId?.let { putExtra("task_id", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_TASK,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val emoji = when (action) {
            "assigned" -> "📋"
            "updated" -> "🔄"
            "approved" -> "✅"
            "rejected" -> "❌"
            else -> "📋"
        }

        val message = buildString {
            append(taskTitle)
            if (dueDate != null) {
                append("\nDue: $dueDate")
            }
            if (priority != "normal") {
                append("\nPriority: ${priority.uppercase()}")
            }
        }

        val notificationPriority = when (priority.lowercase()) {
            "high", "urgent" -> NotificationCompat.PRIORITY_HIGH
            "critical" -> NotificationCompat.PRIORITY_MAX
            else -> NotificationCompat.PRIORITY_DEFAULT
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_TASKS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$emoji $title")
            .setContentText(taskTitle)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(notificationPriority)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setVibrate(longArrayOf(0, 300, 200, 300))
            .setLights(Color.GREEN, 1000, 1000)
            .setColor(Color.parseColor("#4CAF50"))
            .build()

        NotificationManagerCompat.from(context).notify(
            NOTIFICATION_ID_TASK + (taskId?.hashCode() ?: 0),
            notification
        )
    }

    fun showGeneralNotification(
        title: String,
        message: String,
        url: String? = null
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            url?.let { putExtra("navigate_to", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_GENERAL,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setColor(Color.parseColor("#192A5A"))
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_GENERAL, notification)
    }

    fun cancelNotification(notificationId: Int) {
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    fun cancelAllNotifications() {
        NotificationManagerCompat.from(context).cancelAll()
    }
}

