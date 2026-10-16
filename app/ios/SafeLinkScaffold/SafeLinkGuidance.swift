import AVFoundation
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
@objc(SafeLinkGuidance)
class SafeLinkGuidance: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()

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
