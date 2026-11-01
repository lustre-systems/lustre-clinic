package expo.modules.lustrealarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextClock
import android.widget.TextView

/**
 * The full-screen ringing screen over the lock screen. Done for today stops the
 * ringing and the rest of the day's series ([Dismissal]); tomorrow's arms as
 * usual. Open stops only this ring, and asks for the unlock on the way into the
 * app, where the list is.
 *
 * Plain views, not React: it has to come up in a process where JS is not
 * running, and fast.
 */
class AlarmActivity : Activity() {
  private val close: () -> Unit = { runOnUiThread { finish() } }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (intent?.action == ACTION_OPEN) return open()
    // A notification tapped after its ring was over.
    if (!AlarmService.ringing) return finish()

    // The manifest says the same from 8.1 up.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContentView(layout(AlarmSchedule.copy(this)))
    AlarmService.silenced = close
  }

  override fun onResume() {
    super.onResume()
    AlarmService.screenShown()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (intent.action == ACTION_OPEN) open()
  }

  override fun onDestroy() {
    if (AlarmService.silenced === close) AlarmService.silenced = null
    super.onDestroy()
  }

  private fun open() {
    // Unhooked first, or the silence would close the screen mid-unlock.
    if (AlarmService.silenced === close) AlarmService.silenced = null
    AlarmService.silence(this)

    val launch = packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (launch == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !keyguard.isKeyguardLocked) {
      launch?.let { openApp(it) }
      finish()
      return
    }
    keyguard.requestDismissKeyguard(
      this,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          openApp(launch)
          finish()
        }

        override fun onDismissCancelled() = finish()

        override fun onDismissError() = finish()
      },
    )
  }

  // The app reads the flag when it comes up, and goes to the reminders list
  // rather than wherever it was left.
  private fun openApp(launch: Intent) {
    openRequested = true
    startActivity(launch)
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun layout(copy: AlarmCopy): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(INK_DEEP)
      setPadding(dp(24), dp(96), dp(24), dp(48))
    }

    root.addView(
      TextClock(this).apply {
        format12Hour = "h:mm"
        format24Hour = "HH:mm"
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 76f)
        typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
      },
    )
    root.addView(
      text(copy.title, 26f, Color.WHITE, Typeface.DEFAULT_BOLD).apply { setPadding(0, dp(24), 0, 0) },
    )
    root.addView(text(copy.body, 17f, MUTED, Typeface.DEFAULT).apply { setPadding(0, dp(8), 0, 0) })

    root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))

    root.addView(button(copy.open, ACCENT) { open() }, buttonParams(0))
    root.addView(button(copy.done, RAISED) { Dismissal.press(this, AlarmService.day) }, buttonParams(dp(12)))
    return root
  }

  private fun text(value: String, size: Float, colour: Int, face: Typeface) = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(colour)
    typeface = face
    gravity = Gravity.CENTER
  }

  private fun buttonParams(top: Int) =
    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { topMargin = top }

  private fun button(label: String, fill: Int, onPress: () -> Unit) = TextView(this).apply {
    text = label
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
    setTextColor(Color.WHITE)
    typeface = Typeface.DEFAULT_BOLD
    gravity = Gravity.CENTER
    isClickable = true
    isFocusable = true
    val shape = GradientDrawable().apply {
      cornerRadius = dp(30).toFloat()
      setColor(fill)
    }
    background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), shape, null)
    setOnClickListener { onPress() }
  }

  companion object {
    const val ACTION_OPEN = "expo.modules.lustrealarm.OPEN"

    /** Open reminders was tapped and the app has not taken it yet. Same process, so memory is enough. */
    @Volatile
    var openRequested = false
    // `color.inkDeep`, `color.accent` and `color.muted` in src/theme/tokens.ts.
    private const val INK_DEEP = 0xFF0E1116.toInt()
    private const val ACCENT = 0xFF2F5BFF.toInt()
    private const val MUTED = 0xFF8B8B92.toInt()
    private const val RAISED = 0xFF262A31.toInt()
  }
}
