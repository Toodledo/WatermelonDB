#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

// Bridgeless-compatible JSI install (RN 0.74+ / new architecture).
//
// The legacy install path (DatabaseBridge.initializeJSI -> installWatermelonJSI)
// obtains the JS runtime via RCTCxxBridge.runtime, which does not exist in
// bridgeless mode — so JSI silently never installs and WatermelonDB falls back
// to the slow async NativeModules dispatcher.
//
// This module takes React Native's supported TurboModule hook instead:
// RCTTurboModuleManager calls installJSIBindingsWithRuntime: (on the JS thread)
// when the module is created, handing us the jsi::Runtime directly. Creation is
// triggered by JS simply accessing NativeModules.JSIInstaller — which
// makeDispatcher/index.native.js already does at import time.
//
// On the old architecture this class is a plain no-op legacy module (the
// TurboModule hooks are never invoked) and the classic bridge path still works.

#if __has_include(<ReactCommon/RCTTurboModule.h>)
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import "Database.h"
#define WMELON_TURBO_AVAILABLE 1
#endif

@interface JSIInstallerModule : NSObject <RCTBridgeModule
#ifdef WMELON_TURBO_AVAILABLE
                                          ,
                                          RCTTurboModule,
                                          RCTTurboModuleWithJSIBindings
#endif
                                          >
@end

@implementation JSIInstallerModule

RCT_EXPORT_MODULE(JSIInstaller)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#ifdef WMELON_TURBO_AVAILABLE

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  watermelondb::Database::install(&runtime);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  // No JS-callable methods are needed — the install happens above, at module
  // creation. A bare ObjCTurboModule satisfies the TurboModule contract.
  return std::make_shared<facebook::react::ObjCTurboModule>(params);
}

#endif

@end
