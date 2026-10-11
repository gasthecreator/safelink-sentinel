#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift SafeLinkPeripheral class (SafeLinkPeripheral.swift) to JS.
@interface RCT_EXTERN_MODULE (SafeLinkPeripheral, RCTEventEmitter)

RCT_EXTERN_METHOD(isSupported : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(start : (NSString *)serviceUuid messageCharUuid : (NSString *)messageCharUuid identityCharUuid : (
    NSString *)identityCharUuid identityBase64 : (NSString *)identityBase64 resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateIdentity : (NSString *)identityBase64 resolver : (RCTPromiseResolveBlock)resolve rejecter : (
    RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
