package expo.modules.lustrealarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build

// The white "C" `expo-notifications` generates from assets/notification-icon.png.
internal fun smallIcon(context: Context): Int =
  context.resources.getIdentifier("notification_icon", "drawable", context.packageName).takeIf { it != 0 }
    ?: context.applicationInfo.icon

/**
 * The daily nudge when it is not set to ring: one ordinary notification, on
 * the channel JS already made and named (`reminders`, in notifications.ts), so
 * what the user set for that channel in Android settings still applies.
 */
object NudgeNotice {
  // Kept equal to `CHANNEL_ID` in src/notifications/notifications.ts.
  private const val CHANNEL_ID = "reminders"
  private const val NOTIFICATION_ID = 7203
  // `color.ink` in src/theme/tokens.ts.
  const val ICON_COLOR = 0xFF111114.toInt()

  fun post(context: Context) {
    val copy = AlarmSchedule.copy(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // JS makes it on every arm; this is only for a phone that lost it since.
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, copy.title, NotificationManager.IMPORTANCE_DEFAULT),
        )
      }
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    // The alarm screen's Open, which goes to the reminders list and closes itself.
    val open = PendingIntent.getActivity(
      context,
      3,
      Intent(context, AlarmActivity::class.java).setAction(AlarmActivity.ACTION_OPEN),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val done = PendingIntent.getBroadcast(
      context,
      4,
      Intent(context, AlarmReceiver::class.java)
        .setAction(AlarmReceiver.ACTION_DONE)
        .putExtra(AlarmReceiver.EXTRA_DAY, AlarmSchedule.day(context)),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val icon = Icon.createWithResource(context, smallIcon(context))
    // Public on the lock screen: the nudge names no patient.
    manager.notify(
      NOTIFICATION_ID,
      builder
        .setSmallIcon(smallIcon(context))
        .setColor(ICON_COLOR)
        .setContentTitle(copy.title)
        .setContentText(copy.body)
        .setCategory(Notification.CATEGORY_REMINDER)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setContentIntent(open)
        .addAction(Notification.Action.Builder(icon, copy.done, done).build())
        .build(),
    )
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }
}
