package expo.modules.lustrealarm

import android.content.Context

/**
 * Done for today, pressed on the ring or the plain nudge. It has to hold with
 * no JS running: the rest of the day's series is cancelled here, and kept
 * cancelled for that clinic day even if JS arms it again before it has heard.
 *
 * Its own file, apart from [AlarmSchedule]'s: JS clears that one whenever the
 * plan comes out empty, and this must outlive it until JS has told the server
 * (`reminder.dismissToday`, which the other desk phone reads before it rings).
 * The native side cannot tell the server itself: its checks carry no device
 * credential, so a clinic that requires provisioning would refuse the write.
 */
object Dismissal {
  data class Record(val day: String, val sent: Boolean)

  private const val PREFS = "lustre.alarm.done"
  private const val KEY_DAY = "day"
  private const val KEY_SENT = "sent"

  /** Tells JS, while it is listening: the press can land with the app on screen, where no foreground follows. */
  @Volatile
  var dismissed: (() -> Unit)? = null

  fun read(context: Context): Record? {
    val prefs = prefs(context)
    val day = prefs.getString(KEY_DAY, null) ?: return null
    return Record(day, prefs.getBoolean(KEY_SENT, false))
  }

  /** Whether the series armed for `day` stays quiet. */
  fun covers(context: Context, day: String?): Boolean = day != null && read(context)?.day == day

  /**
   * Stops the ring, cancels the rest of `day`'s series, and keeps it for JS to
   * send. A null `day` is a ring armed before this build knew its day: it is
   * only stopped.
   */
  fun press(context: Context, day: String?) {
    if (day != null) {
      prefs(context).edit().putString(KEY_DAY, day).putBoolean(KEY_SENT, false).commit()
      AlarmSchedule.armNext(context, System.currentTimeMillis())
    }
    AlarmService.silence(context)
    NudgeNotice.cancel(context)
    dismissed?.invoke()
  }

  /** The server has it. Kept until JS has read the settings back, so a re-arm in between stays quiet. */
  fun markSent(context: Context, day: String) {
    if (read(context)?.day == day) prefs(context).edit().putBoolean(KEY_SENT, true).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
