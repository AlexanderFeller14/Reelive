const { withAppDelegate, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// Scene-Lebenszyklus fuer iOS 27.
//
// Ab iOS 27 bricht UIKit jede App ab, die ihr Fenster noch im AppDelegate
// aufspannt statt im Scene-Lebenszyklus. Der Absturz kommt ohne Meldung, nach
// rund 250 ms, mit Signal 5; im Simulator laeuft dieselbe App weiter, weil die
// Pruefung dort nicht greift. Expos prebuild-Vorlage erzeugt bis heute genau
// diese alte Form (expo/expo#46663, offen), deshalb dieses Plugin.
//
// Es macht zwei Dinge, die `prebuild` sonst bei jedem Durchlauf wieder
// zunichte machen wuerde:
//   1. Info.plist bekommt ein UIApplicationSceneManifest.
//   2. AppDelegate.swift gibt die Fenster-Erstellung an einen SceneDelegate ab.
//
// Sobald Expo das selbst loest, kann dieses Plugin ersatzlos entfallen. Dann
// schlaegt es hier laut fehl (siehe die Pruefungen unten), statt still nichts
// zu tun: ein Plugin, das seine Ankerstellen nicht mehr findet, muss den Build
// anhalten, sonst startet die App erst auf dem Geraet nicht mehr.

const SCENE_DELEGATE_KLASSE = 'SceneDelegate';

// Was aus didFinishLaunchingWithOptions verschwinden muss. Genau der Block,
// den die Vorlage erzeugt.
const FENSTER_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const FENSTER_ERSATZ = `    // Kein Fenster an dieser Stelle: ab iOS 27 bricht UIKit eine App ab, die
    // ihr Fenster im AppDelegate aufspannt statt im Scene-Lebenszyklus
    // («UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption»).
    // Es entsteht in ${SCENE_DELEGATE_KLASSE}.scene(_:willConnectTo:options:).
    gemerkteStartoptionen = launchOptions`;

const STARTOPTIONEN_PROPERTY = `  // Aufgehoben, weil React Native erst im ${SCENE_DELEGATE_KLASSE} hochgefahren
  // wird und die Optionen dort noch braucht.
  var gemerkteStartoptionen: [UIApplication.LaunchOptionsKey: Any]?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?`;

const SCENE_DELEGATE = `
// Der Scene-Lebenszyklus, den iOS 27 verlangt. Bewusst in dieser Datei und
// nicht in einer eigenen: eine neue Datei muesste in die Projektdatei
// eingetragen werden, und die von aussen zu bearbeiten ist deutlich
// fehleranfaelliger als ein paar Zeilen mehr hier.
//
// Der Klassenname wird in Info.plist referenziert (siehe withSceneLifecycle.js).
// @objc haelt ihn stabil, sonst waere er ein Swift-Symbol mit Modulpraefix und
// UIKit faende die Klasse zur Laufzeit nicht.
@objc(${SCENE_DELEGATE_KLASSE})
class ${SCENE_DELEGATE_KLASSE}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let fensterSzene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let fenster = UIWindow(windowScene: fensterSzene)
    window = fenster
    factory.startReactNative(
      withModuleName: "main",
      in: fenster,
      launchOptions: appDelegate.gemerkteStartoptionen)

    szeneStartLinks(connectionOptions)
  }

  // Deep Links. Im Scene-Modell erreicht \`application(_:open:options:)\` die App
  // nicht mehr, und ohne diese Weiterleitung liefe jeder Einladungslink
  // (/join/<code>) und jeder Teilen-Link ins Leere.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for kontext in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: kontext.url, options: [:])
    }
  }

  // Universal Links, aus demselben Grund.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }

  // Ein Link, der die App erst startet, kommt nicht ueber die beiden Methoden
  // oben, sondern liegt bereits in den Verbindungsoptionen.
  func szeneStartLinks(_ connectionOptions: UIScene.ConnectionOptions) {
    for kontext in connectionOptions.urlContexts {
      RCTLinkingManager.application(UIApplication.shared, open: kontext.url, options: [:])
    }
    for aktivitaet in connectionOptions.userActivities {
      RCTLinkingManager.application(
        UIApplication.shared,
        continue: aktivitaet,
        restorationHandler: { _ in })
    }
  }
}
`;

function fehler(was) {
  return new Error(
    `[withSceneLifecycle] ${was}\n` +
      'Die Vorlage von expo prebuild hat sich geaendert. Pruefe, ob Expo den ' +
      'Scene-Lebenszyklus inzwischen selbst erzeugt (expo/expo#46663). Wenn ja, ' +
      'kann dieses Plugin entfallen; wenn nein, muessen die Ankerstellen in ' +
      'plugins/withSceneLifecycle.js nachgezogen werden. Ohne beides startet ' +
      'die App auf iOS 27 nicht.'
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
            UISceneDelegateClassName: SCENE_DELEGATE_KLASSE,
          },
        ],
      },
    };
    return config;
  });

const withSceneDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw fehler(`AppDelegate ist "${config.modResults.language}", erwartet wurde swift.`);
    }

    let inhalt = config.modResults.contents;

    // Mehrfachlauf abfangen: prebuild ruft Mods unter Umstaenden erneut auf,
    // und zwei SceneDelegate-Klassen in einer Datei kompilieren nicht.
    if (inhalt.includes(`class ${SCENE_DELEGATE_KLASSE}`)) return config;

    if (!inhalt.includes(FENSTER_BLOCK)) {
      throw fehler('Der erwartete Fenster-Block in didFinishLaunchingWithOptions fehlt.');
    }
    inhalt = inhalt.replace(FENSTER_BLOCK, FENSTER_ERSATZ);

    const propertyAnker = '  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?';
    if (!inhalt.includes(propertyAnker)) {
      throw fehler('Die Eigenschaft reactNativeDelegate fehlt, dort haengt gemerkteStartoptionen.');
    }
    inhalt = inhalt.replace(propertyAnker, STARTOPTIONEN_PROPERTY);

    const klassenAnker = 'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {';
    if (!inhalt.includes(klassenAnker)) {
      throw fehler('Die Klasse ReactNativeDelegate fehlt, davor gehoert der SceneDelegate.');
    }
    inhalt = inhalt.replace(klassenAnker, `${SCENE_DELEGATE}\n${klassenAnker}`);

    config.modResults.contents = inhalt;
    return config;
  });

// Xcode 26/27 legt den App-Code standardmaessig in eine separate
// `<Name>.debug.dylib` und laesst das eigentliche Binary nur noch laden. Auf
// einem echten Geraet stirbt die App damit nach rund 250 ms mit Signal 5,
// ohne Meldung und ohne Absturzbericht; im Simulator laeuft dieselbe App, weil
// Dylib-Signaturen dort nicht streng geprueft werden.
//
// Die Einstellung gehoert ins Projekt und nicht an den einzelnen Aufruf: sonst
// funktioniert nur der Terminal-Build mit dem passenden Flag, waehrend ⌘R in
// Xcode und `npm run ios` still wieder eine App erzeugen, die nicht startet.
const withoutDebugDylib = (config) =>
  withXcodeProject(config, (config) => {
    const projekt = config.modResults;
    const konfigurationen = projekt.pbxXCBuildConfigurationSection();
    let getroffen = 0;

    for (const eintrag of Object.values(konfigurationen)) {
      if (typeof eintrag !== 'object' || !eintrag.buildSettings) continue;
      // Nur das App-Target, nicht die Pods: dort ist die Einstellung ohne
      // Wirkung und wuerde die Projektdatei unnoetig aufblaehen.
      if (!eintrag.buildSettings.PRODUCT_NAME) continue;
      eintrag.buildSettings.ENABLE_DEBUG_DYLIB = 'NO';
      getroffen += 1;
    }

    if (getroffen === 0) {
      throw fehler('Keine Build-Konfiguration mit PRODUCT_NAME gefunden.');
    }
    return config;
  });

module.exports = (config) => withoutDebugDylib(withSceneDelegate(withSceneManifest(config)));
