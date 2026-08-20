const { withAppDelegate, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// Scene lifecycle for iOS 27.
//
// From iOS 27 on, UIKit terminates every app that still opens its window in the
// AppDelegate instead of in the scene lifecycle. The crash comes without a
// message, after roughly 250 ms, with signal 5; in the simulator the same app
// keeps running because the check does not apply there. Expo's prebuild template
// still produces exactly that old shape (expo/expo#46663, open), hence this
// plugin.
//
// It does two things that `prebuild` would otherwise undo on every run:
//   1. Info.plist gets a UIApplicationSceneManifest.
//   2. AppDelegate.swift hands window creation over to a SceneDelegate.
//
// As soon as Expo solves this itself, this plugin can go away entirely. Until
// then it fails loudly here (see the checks below) instead of quietly doing
// nothing: a plugin that no longer finds its anchors has to stop the build,
// otherwise the app simply stops starting on the device.

const SCENE_DELEGATE_CLASS = 'SceneDelegate';

// What has to disappear from didFinishLaunchingWithOptions. Exactly the block
// the template produces.
const WINDOW_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const WINDOW_REPLACEMENT = `    // No window at this point: from iOS 27 on, UIKit terminates an app that
    // opens its window in the AppDelegate instead of in the scene lifecycle
    // («UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption»).
    // It is created in ${SCENE_DELEGATE_CLASS}.scene(_:willConnectTo:options:).
    storedLaunchOptions = launchOptions`;

const LAUNCH_OPTIONS_PROPERTY = `  // Kept because React Native is only started up in the ${SCENE_DELEGATE_CLASS}
  // and still needs the options there.
  var storedLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?`;

const SCENE_DELEGATE = `
// The scene lifecycle iOS 27 demands. Deliberately in this file and not in one
// of its own: a new file would have to be registered in the project file, and
// editing that from the outside is considerably more error-prone than a few
// extra lines here.
//
// The class name is referenced in Info.plist (see withSceneLifecycle.js).
// @objc keeps it stable, otherwise it would be a Swift symbol with a module
// prefix and UIKit would not find the class at runtime.
@objc(${SCENE_DELEGATE_CLASS})
class ${SCENE_DELEGATE_CLASS}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let newWindow = UIWindow(windowScene: windowScene)
    window = newWindow
    factory.startReactNative(
      withModuleName: "main",
      in: newWindow,
      launchOptions: appDelegate.storedLaunchOptions)

    sceneStartLinks(connectionOptions)
  }

  // Deep links. In the scene model \`application(_:open:options:)\` no longer
  // reaches the app, and without this forwarding every invite link
  // (/join/<code>) and every share link would run into the void.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal links, for the same reason.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }

  // A link that starts the app in the first place does not arrive through the
  // two methods above, it is already sitting in the connection options.
  func sceneStartLinks(_ connectionOptions: UIScene.ConnectionOptions) {
    for context in connectionOptions.urlContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      RCTLinkingManager.application(
        UIApplication.shared,
        continue: activity,
        restorationHandler: { _ in })
    }
  }
}
`;

function failure(what) {
  return new Error(
    `[withSceneLifecycle] ${what}\n` +
      'The template of expo prebuild has changed. Check whether Expo now creates the ' +
      'scene lifecycle itself (expo/expo#46663). If so, this plugin can go away; if ' +
      'not, the anchors in plugins/withSceneLifecycle.js have to be moved along. ' +
      'Without either, the app does not start on iOS 27.'
  );
}

const withSceneManifest = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return config;
  });

const withSceneDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw failure(`AppDelegate is "${config.modResults.language}", swift was expected.`);
    }

    let contents = config.modResults.contents;

    // Catch a repeated run: prebuild may invoke mods more than once, and two
    // SceneDelegate classes in one file do not compile.
    if (contents.includes(`class ${SCENE_DELEGATE_CLASS}`)) return config;

    if (!contents.includes(WINDOW_BLOCK)) {
      throw failure('The expected window block in didFinishLaunchingWithOptions is missing.');
    }
    contents = contents.replace(WINDOW_BLOCK, WINDOW_REPLACEMENT);

    const propertyAnchor = '  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?';
    if (!contents.includes(propertyAnchor)) {
      throw failure(
        'The reactNativeDelegate property is missing, storedLaunchOptions hangs off it.'
      );
    }
    contents = contents.replace(propertyAnchor, LAUNCH_OPTIONS_PROPERTY);

    const classAnchor = 'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {';
    if (!contents.includes(classAnchor)) {
      throw failure('The ReactNativeDelegate class is missing, the SceneDelegate belongs before it.');
    }
    contents = contents.replace(classAnchor, `${SCENE_DELEGATE}\n${classAnchor}`);

    config.modResults.contents = contents;
    return config;
  });

// Xcode 26/27 puts the app code into a separate `<Name>.debug.dylib` by default
// and lets the actual binary do nothing but load it. On a real device the app
// dies with that after roughly 250 ms with signal 5, without a message and
// without a crash report; in the simulator the same app runs, because dylib
// signatures are not checked strictly there.
//
// The setting belongs in the project and not on the individual invocation:
// otherwise only the terminal build with the matching flag works, while ⌘R in
// Xcode and `npm run ios` quietly produce an app again that does not start.
const withoutDebugDylib = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    let matched = 0;

    for (const entry of Object.values(configurations)) {
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      // Only the app target, not the Pods: there the setting has no effect and
      // would only bloat the project file.
      if (!entry.buildSettings.PRODUCT_NAME) continue;
      entry.buildSettings.ENABLE_DEBUG_DYLIB = 'NO';
      matched += 1;
    }

    if (matched === 0) {
      throw failure('No build configuration with PRODUCT_NAME found.');
    }
    return config;
  });

module.exports = (config) => withoutDebugDylib(withSceneDelegate(withSceneManifest(config)));
