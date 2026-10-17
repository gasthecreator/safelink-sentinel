#import <React/RCTBridgeModule.h>

// Exposes the Swift SafeLinkGuidance class (SafeLinkGuidance.swift) to JS.
@interface RCT_EXTERN_MODULE (SafeLinkGuidance, NSObject)

RCT_EXTERN_METHOD(keepAwake : (BOOL)on)

RCT_EXTERN_METHOD(speak : (NSString *)text language : (NSString *)language)

RCT_EXTERN_METHOD(stopSpeaking)

RCT_EXTERN_METHOD(startBackground : (NSString *)title text : (NSString *)text channelName : (NSString *)channelName channelDescription : (NSString *)channelDescription)

RCT_EXTERN_METHOD(stopBackground)

RCT_EXTERN_METHOD(isSpeechAvailable : (NSString *)language resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
