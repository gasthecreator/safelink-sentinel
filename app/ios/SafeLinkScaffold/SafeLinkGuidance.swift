import AVFoundation
import CoreLocation
import Foundation
import UIKit

/// Support for live directions: keep the screen on, and speak instructions with the phone's own
/// voices (no network).
///
/// JS API (NativeModules.SafeLinkGuidance):
///   keepAwake(on: Bool)
///   speak(text: String)          replaces anything still being spoken
///   stopSpeaking()
///   isSpeechAvailable(): Promise<Bool>
///   startBackground() / stopBackground()   keep running with the phone locked (iOS shows the blue location indicator)
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

  @objc(speak:)
  func speak(_ text: String) {
    DispatchQueue.main.async {
      // lower other audio (music) while speaking, and give it back afterwards
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
      try? session.setActive(true)
      if self.synthesizer.isSpeaking { self.synthesizer.stopSpeaking(at: .immediate) }
      let utterance = AVSpeechUtterance(string: String(text.prefix(300)))
      utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
      self.synthesizer.speak(utterance)
    }
  }

  /// An active location manager that is allowed to run in the background keeps the app alive while the
  /// phone is locked, so the GPS watch in JavaScript keeps delivering positions. It is only on between
  /// "Start live directions" and "Stop".
  @objc func startBackground() {
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

  @objc(isSpeechAvailable:rejecter:)
  func isSpeechAvailable(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(!AVSpeechSynthesisVoice.speechVoices().isEmpty)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
