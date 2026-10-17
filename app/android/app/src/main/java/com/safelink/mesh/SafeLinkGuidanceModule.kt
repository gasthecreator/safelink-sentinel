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
 *   speak(text: string, language)  replaces anything still being spoken; language is the app's ("es", "en")
 *   stopSpeaking()
 *   isSpeechAvailable(language): Promise<boolean>   true if the phone has a voice for that language ("es", "en")
 *   startBackground(title, text, channelName, channelDescription) / stopBackground()   keep running with the screen locked (a foreground service)
 */
class SafeLinkGuidanceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), TextToSpeech.OnInitListener {

  private var tts: TextToSpeech? = null
  private var ready = false
  private var failed = false
  private var pending: Pair<String, String?>? = null
  private val availabilityWaiters = mutableListOf<Pair<String?, Promise>>()

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
  fun startBackground(title: String?, text: String?, channelName: String?, channelDescription: String?) {
    try {
      val intent =
          Intent(reactContext.applicationContext, GuidanceService::class.java).apply {
            title?.let { putExtra(GuidanceService.EXTRA_TITLE, it.take(80)) }
            text?.let { putExtra(GuidanceService.EXTRA_TEXT, it.take(160)) }
            channelName?.let { putExtra(GuidanceService.EXTRA_CHANNEL_NAME, it.take(60)) }
            channelDescription?.let { putExtra(GuidanceService.EXTRA_CHANNEL_DESCRIPTION, it.take(160)) }
          }
      ContextCompat.startForegroundService(reactContext.applicationContext, intent)
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
        ready = true
        failed = false
      }
      val say = pending
      pending = null
      if (ready && say != null && applyLanguage(say.second)) speakNow(say.first)
      availabilityWaiters.forEach { (tag, promise) -> promise.resolve(ready && applyLanguage(tag)) }
      availabilityWaiters.clear()
    }
  }

  /**
   * Speak in the language of the app (what the person chose), not the phone's: Spanish directions read by an
   * English voice are gibberish. False when the phone has no voice for that language; the directions then stay
   * on screen only.
   */
  private fun applyLanguage(tag: String?): Boolean {
    val engine = tts ?: return false
    fun usable(result: Int) = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED
    if (tag.isNullOrBlank()) {
      return usable(engine.setLanguage(Locale.getDefault())) || usable(engine.setLanguage(Locale.US))
    }
    return usable(engine.setLanguage(Locale.forLanguageTag(tag)))
  }

  private fun speakNow(text: String) {
    tts?.speak(text.take(300), TextToSpeech.QUEUE_FLUSH, null, "safelink-guidance")
  }

  @ReactMethod
  @Synchronized
  fun speak(text: String, language: String?) {
    if (engine() == null) return
    if (ready) {
      if (applyLanguage(language)) speakNow(text)
    } else if (!failed) {
      pending = Pair(text, language)
    }
  }

  @ReactMethod
  @Synchronized
  fun stopSpeaking() {
    pending = null
    tts?.stop()
  }

  @ReactMethod
  @Synchronized
  fun isSpeechAvailable(language: String?, promise: Promise) {
    if (engine() == null) {
      promise.resolve(false)
    } else if (ready || failed) {
      promise.resolve(ready && applyLanguage(language))
    } else {
      availabilityWaiters.add(Pair(language, promise))
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
