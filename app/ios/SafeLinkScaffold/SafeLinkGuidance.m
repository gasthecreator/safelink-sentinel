#import <React/RCTBridgeModule.h>

// Exposes the Swift SafeLinkGuidance class (SafeLinkGuidance.swift) to JS.
@interface RCT_EXTERN_MODULE (SafeLinkGuidance, NSObject)

RCT_EXTERN_METHOD(keepAwake : (BOOL)on)

RCT_EXTERN_METHOD(speak : (NSString *)text)

RCT_EXTERN_METHOD(stopSpeaking)

RCT_EXTERN_METHOD(isSpeechAvailable : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
