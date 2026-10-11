#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"SafeLinkMesh";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}

- (NSURL *)getBundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end

// Info.plist's UIApplicationSceneManifest names this class as the scene
// delegate. UIKit instantiates a brand new object for that role - never the
// AppDelegate singleton itself, even if that singleton happens to be the
// same class and already (redundantly, since no scene exists yet) built its
// own window in -application:didFinishLaunchingWithOptions:. This class
// reuses the root view controller that window already built, and gives it
// a real window attached to the UIWindowScene UIKit actually connects.
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation SceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                  options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }

  UIWindowScene *windowScene = (UIWindowScene *)scene;
  AppDelegate *appDelegate = (AppDelegate *)[UIApplication sharedApplication].delegate;
  UIViewController *rootViewController = appDelegate.window.rootViewController;

  self.window = [[UIWindow alloc] initWithWindowScene:windowScene];
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];

  // AppDelegate's own window (built without a scene, since none existed yet
  // during didFinishLaunchingWithOptions) now has no reason to exist - hide
  // it so it can't linger as an invisible, keyless duplicate.
  appDelegate.window.hidden = YES;
}

@end
