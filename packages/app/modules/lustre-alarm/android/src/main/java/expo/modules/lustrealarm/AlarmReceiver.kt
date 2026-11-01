package expo.modules.lustrealarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_RING -> {
        AlarmSchedule.armNext(context, intent.getLongExtra(EXTRA_AT, System.currentTimeMillis()))
        // Done for today was pressed after this one was armed.
        if (!AlarmSchedule.armed(context)) return
        val day = AlarmSchedule.day(context)
        val nudge = {
          if (AlarmSchedule.rings(context)) AlarmService.ring(context, trial = false, day) else NudgeNotice.post(context)
        }
        val check = AlarmSchedule.check(context) ?: return nudge()
        // Off the main thread for the network, and held open until it answers.
        // An empty list skips only this one: more can fall due before the next.
        val pending = goAsync()
        thread {
          try {
            // The app can have cancelled the series while the server was
            // being asked: the list cleared, the switch turned off.
            if (ReminderCheck.shouldRing(check) && AlarmSchedule.armed(context)) nudge()
          } finally {
            pending.finish()
          }
        }
      }
      ACTION_TRY -> AlarmService.ring(context, trial = true, intent.getStringExtra(EXTRA_DAY))
      ACTION_DONE -> Dismissal.press(context, intent.getStringExtra(EXTRA_DAY))
    }
  }

  companion object {
    const val ACTION_RING = "expo.modules.lustrealarm.RING"
    const val ACTION_TRY = "expo.modules.lustrealarm.TRY"
    const val ACTION_DONE = "expo.modules.lustrealarm.DONE"
    const val EXTRA_AT = "at"
    const val EXTRA_DAY = "day"
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      AlarmSchedule.armNext(context, System.currentTimeMillis())
    }
  }
}
