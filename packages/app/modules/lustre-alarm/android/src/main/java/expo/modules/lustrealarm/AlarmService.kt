package expo.modules.lustrealarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Rings until someone stops it, the way an alarm clock does: the tone on a
 * loop on the alarm stream (so the ringer switch does not silence it and the
 * alarm volume sets it), vibration on a loop, and a notification whose
 * full-screen intent puts [AlarmActivity] over the lock screen. On a phone in
 * use Android shows that notification as a banner instead, with the same two
 * buttons: Done for today ([Dismissal]) and Open reminders.
 *
 * A service rather than the screen doing the ringing, because the screen is
 * not always shown: Android 14 can withhold full-screen intents, and an
 * unlocked phone gets the banner. The sound must not depend on either.
 */
class AlarmService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val giveUp = Runnable { stopSelf() }
  private var player: MediaPlayer? = null
  private var focus: AudioFocusRequest? = null
  private var started = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Before the notification goes up: its full-screen intent can open the
    // screen at once, and the screen closes itself if nothing is ringing.
    ringing = true
    running = this
    val tried = intent?.getBooleanExtra(EXTRA_TRIAL, false) ?: false
    // A real ring landing on a trial one makes it real, and its day the one Done stops.
    if (!started || !tried) day = intent?.getStringExtra(EXTRA_DAY) ?: day
    val notification = buildNotification(AlarmSchedule.copy(this))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    trial = if (started) trial && tried else tried
    // A ring landing on one still going carries on from where it is.
    if (!started) {
      started = true
      startSound()
      startVibration()
    }
    handler.removeCallbacks(giveUp)
    handler.postDelayed(giveUp, RING_FOR_MS)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(giveUp)
    player?.run {
      stop()
      release()
    }
    player = null
    vibrator().cancel()
    abandonFocus()
    ringing = false
    trial = false
    day = null
    if (running === this) running = null
    silenced?.invoke()
    super.onDestroy()
  }

  private fun startSound() {
    val audio = getSystemService(AudioManager::class.java)
    // Mid-call the tone would go down the earpiece at alarm volume. The
    // vibration and the screen still come.
    if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) return

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(ALARM_AUDIO).build()
      focus = request
      audio.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }

    // The phone's own alarm sound if the bundled tone will not play: a
    // silent alarm is the one outcome this exists to rule out.
    player = runCatching {
      loop { player ->
        resources.openRawResourceFd(R.raw.lustre_alarm_tone).use {
          player.setDataSource(it.fileDescriptor, it.startOffset, it.length)
        }
      }
    }.recoverCatching {
      loop { it.setDataSource(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)) }
    }.getOrNull()
  }

  private fun loop(source: (MediaPlayer) -> Unit): MediaPlayer {
    val player = MediaPlayer()
    try {
      player.setAudioAttributes(ALARM_AUDIO)
      source(player)
      player.isLooping = true
      player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
      player.prepare()
      player.start()
    } catch (e: Exception) {
      player.release()
      throw e
    }
    return player
  }

  private fun abandonFocus() {
    val audio = getSystemService(AudioManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focus?.let { audio.abandonAudioFocusRequest(it) }
      focus = null
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(null)
    }
  }

  private fun vibrator(): Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      getSystemService(VibratorManager::class.java).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Vibrator::class.java)
    }

  private fun startVibration() {
    val vibrator = vibrator()
    when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
        vibrator.vibrate(
          VibrationEffect.createWaveform(VIBRATION, 0),
          VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM),
        )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ->
        @Suppress("DEPRECATION")
        vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, 0), ALARM_AUDIO)
      else ->
        @Suppress("DEPRECATION")
        vibrator.vibrate(VIBRATION, 0, ALARM_AUDIO)
    }
  }

  /**
   * The ringing screen is up. Android also pins the notification over it as a
   * banner, for as long as it carries a full-screen intent, hiding the clock;
   * posted again without one, the banner drops back into the shade.
   */
  private fun screenShown() {
    getSystemService(NotificationManager::class.java)
      .notify(NOTIFICATION_ID, buildNotification(AlarmSchedule.copy(this), fullScreen = false))
  }

  private fun buildNotification(copy: AlarmCopy, fullScreen: Boolean = true): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // High is the least a full-screen intent needs. Silent, because the
      // service is the sound: a channel's sound plays once and stops.
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, copy.channelName, NotificationManager.IMPORTANCE_HIGH).apply {
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this).setPriority(Notification.PRIORITY_MAX)
    }

    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val screen = PendingIntent.getActivity(this, 0, Intent(this, AlarmActivity::class.java), flags)
    val done = PendingIntent.getBroadcast(
      this,
      1,
      Intent(this, AlarmReceiver::class.java).setAction(AlarmReceiver.ACTION_DONE).putExtra(AlarmReceiver.EXTRA_DAY, day),
      flags,
    )
    // An activity, not a receiver that starts one: Android 12 blocks that trampoline.
    val open = PendingIntent.getActivity(
      this,
      2,
      Intent(this, AlarmActivity::class.java).setAction(AlarmActivity.ACTION_OPEN),
      flags,
    )
    val icon = Icon.createWithResource(this, smallIcon(this))

    // Public on the lock screen: the nudge names no patient.
    return builder
      .setSmallIcon(smallIcon(this))
      .setColor(NudgeNotice.ICON_COLOR)
      .setContentTitle(copy.title)
      .setContentText(copy.body)
      .setCategory(Notification.CATEGORY_ALARM)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply { if (fullScreen) setFullScreenIntent(screen, true) }
      .setContentIntent(screen)
      .addAction(Notification.Action.Builder(icon, copy.done, done).build())
      .addAction(Notification.Action.Builder(icon, copy.open, open).build())
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "reminders-ringing"
    private const val NOTIFICATION_ID = 7202
    // What the stock clock gives up after. The series rings again anyway.
    private const val RING_FOR_MS = 10 * 60 * 1000L
    private val VIBRATION = longArrayOf(0, 800, 800)
    private val ALARM_AUDIO = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    private const val EXTRA_TRIAL = "trial"
    private const val EXTRA_DAY = "day"

    @Volatile
    var ringing = false
      private set

    /** Demo mode's "Try the alarm". Disarming the series leaves it ringing. */
    @Volatile
    var trial = false
      private set

    /** The clinic day of the ring going, which Done for today stops. Null for a ring armed before this build. */
    @Volatile
    var day: String? = null
      private set

    @Volatile
    private var running: AlarmService? = null

    fun screenShown() {
      running?.screenShown()
    }

    /** Set by the screen, to close itself when the ringing stops from anywhere else. */
    @Volatile
    var silenced: (() -> Unit)? = null

    fun ring(context: Context, trial: Boolean, day: String?) {
      val intent = Intent(context, AlarmService::class.java).putExtra(EXTRA_TRIAL, trial).putExtra(EXTRA_DAY, day)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: IllegalStateException) {
        // Only if Android refused the alarm-clock exemption. Nothing to fall back to.
      }
    }

    fun silence(context: Context) {
      context.stopService(Intent(context, AlarmService::class.java))
    }
  }
}
