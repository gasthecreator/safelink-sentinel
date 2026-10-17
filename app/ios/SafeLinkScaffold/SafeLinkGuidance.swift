import AVFoundation
import CoreLocation
import Foundation
import UIKit

/// Support for live directions: keep the screen on, and speak instructions with the phone's own
/// voices (no network).
///
/// JS API (NativeModules.SafeLinkGuidance):
///   keepAwake(on: Bool)
///   speak(text: String, language: String)   replaces anything still being spoken; language is the app's ("es", "en")
///   stopSpeaking()
///   isSpeechAvailable(language: String): Promise<Bool>   true if the phone has a voice for that language
///   startBackground(title, text, channelName, channelDescription) / stopBackground()   (the texts are for Android's notification; unused here)
///     keep running with the phone locked (iOS shows the blue location indicator)
@objc(SafeLinkGuidance)
class SafeLinkGuidance: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var background: CLLocationManager?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(keepAwake:)
  func keepAwake(_ on: Bool) {
    DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
  }

  /// A voice for the app's language (what the person chose, not the phone's): Spanish directions read by an
  /// English voice are gibberish. Prefers the phone's own regional variant. nil when the phone has none.
  private func voice(for language: String?) -> AVSpeechSynthesisVoice? {
    guard let language = language, !language.isEmpty else {
      return AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
    }
    let matching = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased().hasPrefix(language.lowercased()) }
    let current = AVSpeechSynthesisVoice.currentLanguageCode()
    return matching.first { $0.language == current } ?? matching.first
  }

  @objc(speak:language:)
  func speak(_ text: String, language: String?) {
    DispatchQueue.main.async {
      guard let voice = self.voice(for: language) else { return }
      // lower other audio (music) while speaking, and give it back afterwards
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
      try? session.setActive(true)
      if self.synthesizer.isSpeaking { self.synthesizer.stopSpeaking(at: .immediate) }
      let utterance = AVSpeechUtterance(string: String(text.prefix(300)))
      utterance.voice = voice
      self.synthesizer.speak(utterance)
    }
  }

  /// An active location manager that is allowed to run in the background keeps the app alive while the
  /// phone is locked, so the GPS watch in JavaScript keeps delivering positions. It is only on between
  /// "Start live directions" and "Stop".
  @objc(startBackground:text:channelName:channelDescription:)
  func startBackground(_ title: String?, text: String?, channelName: String?, channelDescription: String?) {
    DispatchQueue.main.async {
      guard self.background == nil else { return }
      let manager = CLLocationManager()
      manager.desiredAccuracy = kCLLocationAccuracyBest
      manager.distanceFilter = 5
      manager.activityType = .fitness
      manager.pausesLocationUpdatesAutomatically = false
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
      manager.startUpdatingLocation()
      self.background = manager
    }
  }

  @objc func stopBackground() {
    DispatchQueue.main.async {
      self.background?.stopUpdatingLocation()
      self.background = nil
    }
  }

  @objc func stopSpeaking() {
    DispatchQueue.main.async { self.synthesizer.stopSpeaking(at: .immediate) }
  }

  @objc(isSpeechAvailable:resolver:rejecter:)
  func isSpeechAvailable(_ language: String?, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(voice(for: language) != nil)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
