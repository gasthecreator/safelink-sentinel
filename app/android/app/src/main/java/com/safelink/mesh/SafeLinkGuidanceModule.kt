package com.safelink.mesh

import android.content.Intent
import android.speech.tts.TextToSpeech
import androidx.core.content.ContextCompat
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

/**
 * Support for live directions: keep the screen on, and speak instructions.
 * No network and no permissions: it uses the phone's own text-to-speech engine.
 *
 * JS API (NativeModules.SafeLinkGuidance):
 *   keepAwake(on: boolean)
 *   speak(text: string)            replaces anything still being spoken
 *   stopSpeaking()
 *   isSpeechAvailable(): Promise<boolean>
 *   startBackground() / stopBackground()   keep running with the screen locked (a foreground service)
 */
class SafeLinkGuidanceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), TextToSpeech.OnInitListener {

  private var tts: TextToSpeech? = null
  private var ready = false
  private var failed = false
  private var pending: String? = null
  private val availabilityWaiters = mutableListOf<Promise>()

  override fun getName() = "SafeLinkGuidance"

  @ReactMethod
  fun keepAwake(on: Boolean) {
    val activity = currentActivity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  @ReactMethod
  fun startBackground() {
    try {
      ContextCompat.startForegroundService(
          reactContext.applicationContext, Intent(reactContext.applicationContext, GuidanceService::class.java))
    } catch (e: Exception) {
      // not allowed right now (for example the app is not in front): directions still work in the foreground
    }
  }

  @ReactMethod
  fun stopBackground() {
    try {
      reactContext.applicationContext.stopService(
          Intent(reactContext.applicationContext, GuidanceService::class.java))
    } catch (e: Exception) {
      // already stopped
    }
  }

  @Synchronized
  private fun engine(): TextToSpeech? {
    if (tts == null && !failed) {
      try {
        tts = TextToSpeech(reactContext.applicationContext, this)
      } catch (e: Exception) {
        failed = true
      }
    }
    return tts
  }

  override fun onInit(status: Int) {
    synchronized(this) {
      val engine = tts
      if (status != TextToSpeech.SUCCESS || engine == null) {
        failed = true
        ready = false
      } else {
        // the phone's language if it has a voice for it, otherwise English
        var result = engine.setLanguage(Locale.getDefault())
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
          result = engine.setLanguage(Locale.US)
        }
        ready = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED
        failed = !ready
      }
      val say = pending
      pending = null
      if (ready && say != null) speakNow(say)
      availabilityWaiters.forEach { it.resolve(ready) }
      availabilityWaiters.clear()
    }
  }

  private fun speakNow(text: String) {
    tts?.speak(text.take(300), TextToSpeech.QUEUE_FLUSH, null, "safelink-guidance")
  }

  @ReactMethod
  @Synchronized
  fun speak(text: String) {
    if (engine() == null) return
    if (ready) speakNow(text) else if (!failed) pending = text
  }

  @ReactMethod
  @Synchronized
  fun stopSpeaking() {
    pending = null
    tts?.stop()
  }

  @ReactMethod
  @Synchronized
  fun isSpeechAvailable(promise: Promise) {
    if (engine() == null) {
      promise.resolve(false)
    } else if (ready || failed) {
      promise.resolve(ready)
    } else {
      availabilityWaiters.add(promise)
    }
  }

  override fun invalidate() {
    super.invalidate()
    stopBackground()
    tts?.stop()
    tts?.shutdown()
    tts = null
  }
}
