package expo.modules.lustrealarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/** The words on the ringing screen, worded by JS in the app's language when it arms. */
data class AlarmCopy(
  val title: String,
  val body: String,
  val done: String,
  val open: String,
  val channelName: String,
)

/**
 * The series JS last armed, kept on disk because what reads it — the nudge
 * firing, the phone booting — runs with no JS at all. Only the next one is ever
 * with `AlarmManager`, and each arms the one after it, so the alarm icon in the
 * status bar shows the next ring rather than the last.
 *
 * A series either rings ([AlarmService]) or posts a plain notification
 * ([NudgeNotice]). A ringing one is armed with `setAlarmClock`: the one Doze
 * never defers, and the one that lets it start a foreground service from the
 * background. A plain one with an exact alarm allowed while idle, which puts no
 * alarm icon in the status bar for what is only a notification.
 */
object AlarmSchedule {
  private const val PREFS = "lustre.alarm"
  private const val KEY_AT = "at"
  private const val KEY_RINGS = "rings"
  private const val KEY_TITLE = "title"
  private const val KEY_BODY = "body"
  private const val KEY_DONE = "done"
  private const val KEY_DAY = "day"
  private const val KEY_OPEN = "open"
  private const val KEY_CHANNEL = "channelName"
  private const val KEY_CHECK_BASES = "checkBases"
  private const val KEY_CHECK_PENDING = "checkPending"
  private const val KEY_CHECK_SETTINGS = "checkSettings"
  private const val KEY_CHECK_TODAY = "checkToday"

  /**
   * False when Android refused the alarm: the exact-alarm permission revoked, on
   * 12. `day` is the clinic day the series belongs to, which Done for today
   * stops ([Dismissal]).
   */
  fun replace(
    context: Context,
    at: List<Long>,
    day: String,
    copy: AlarmCopy,
    check: ReminderCheck.Check?,
    rings: Boolean,
  ): Boolean {
    saveCopy(context, copy)
    prefs(context).edit()
      .putString(KEY_AT, at.sorted().joinToString(","))
      .putString(KEY_DAY, day)
      .putBoolean(KEY_RINGS, rings)
      .putString(KEY_CHECK_BASES, check?.bases?.joinToString("\n"))
      .putString(KEY_CHECK_PENDING, check?.pendingPath)
      .putString(KEY_CHECK_SETTINGS, check?.settingsPath)
      .putString(KEY_CHECK_TODAY, check?.today)
      .apply()
    return armNext(context, System.currentTimeMillis())
  }

  /**
   * One ring at `at`, beside the series rather than in it, so trying the alarm
   * out never moves the day's real ones. For demo mode.
   */
  fun tryAt(context: Context, at: Long, day: String, copy: AlarmCopy): Boolean {
    saveCopy(context, copy)
    val ring = PendingIntent.getBroadcast(
      context,
      1,
      Intent(context, AlarmReceiver::class.java).setAction(AlarmReceiver.ACTION_TRY).putExtra(AlarmReceiver.EXTRA_DAY, day),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return try {
      context.getSystemService(AlarmManager::class.java)
        .setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(context)), ring)
      true
    } catch (_: SecurityException) {
      false
    }
  }

  private fun saveCopy(context: Context, copy: AlarmCopy) {
    prefs(context).edit()
      .putString(KEY_TITLE, copy.title)
      .putString(KEY_BODY, copy.body)
      .putString(KEY_DONE, copy.done)
      .putString(KEY_OPEN, copy.open)
      .putString(KEY_CHANNEL, copy.channelName)
      .apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
    context.getSystemService(AlarmManager::class.java).cancel(ringIntent(context, 0))
  }

  /** Arms the first ring strictly after `after`, or cancels when there is none left today or it was done for. */
  fun armNext(context: Context, after: Long): Boolean {
    val manager = context.getSystemService(AlarmManager::class.java)
    val next = if (Dismissal.covers(context, day(context))) null else times(context).firstOrNull { it > after }
    if (next == null) {
      manager.cancel(ringIntent(context, 0))
      return true
    }
    return try {
      if (rings(context)) {
        manager.setAlarmClock(AlarmManager.AlarmClockInfo(next, showIntent(context)), ringIntent(context, next))
      } else {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, ringIntent(context, next))
      }
      true
    } catch (_: SecurityException) {
      false
    }
  }

  /** Whether a series is armed and not done for: `clear` empties the file. */
  fun armed(context: Context): Boolean = prefs(context).contains(KEY_AT) && !Dismissal.covers(context, day(context))

  /** The clinic day the armed series is for, or null when there is none. */
  fun day(context: Context): String? = prefs(context).getString(KEY_DAY, null)

  /** Whether the series rings like an alarm, or only posts the nudge. */
  fun rings(context: Context): Boolean = prefs(context).getBoolean(KEY_RINGS, true)

  fun copy(context: Context): AlarmCopy {
    val prefs = prefs(context)
    return AlarmCopy(
      title = prefs.getString(KEY_TITLE, null) ?: "Reminders pending",
      body = prefs.getString(KEY_BODY, null) ?: "",
      done = prefs.getString(KEY_DONE, null) ?: "Done for today",
      open = prefs.getString(KEY_OPEN, null) ?: "Open",
      channelName = prefs.getString(KEY_CHANNEL, null) ?: "Reminder alarm",
    )
  }

  /** What to ask the server before a ring of the series, or null to ring without asking. */
  fun check(context: Context): ReminderCheck.Check? {
    val prefs = prefs(context)
    val bases = prefs.getString(KEY_CHECK_BASES, null)?.split("\n")?.filter { it.isNotEmpty() } ?: return null
    return ReminderCheck.Check(
      bases = bases.ifEmpty { return null },
      pendingPath = prefs.getString(KEY_CHECK_PENDING, null) ?: return null,
      settingsPath = prefs.getString(KEY_CHECK_SETTINGS, null) ?: return null,
      today = prefs.getString(KEY_CHECK_TODAY, null) ?: return null,
    )
  }

  private fun times(context: Context): List<Long> =
    prefs(context).getString(KEY_AT, null)
      ?.split(",")
      ?.mapNotNull { it.toLongOrNull() }
      ?: emptyList()

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // One request code for every ring, so arming the next replaces the last and
  // one cancel clears it. The instant rides along so the ring can arm the one
  // after it without re-arming itself a moment early.
  private fun ringIntent(context: Context, at: Long): PendingIntent = PendingIntent.getBroadcast(
    context,
    0,
    Intent(context, AlarmReceiver::class.java).setAction(AlarmReceiver.ACTION_RING).putExtra(AlarmReceiver.EXTRA_AT, at),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  // What tapping the alarm in the notification shade opens.
  private fun showIntent(context: Context): PendingIntent? =
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
