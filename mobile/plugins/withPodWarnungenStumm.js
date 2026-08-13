const { withPodfile, withXcodeProject } = require('expo/config-plugins');

// Compiler-Warnungen aus fremdem Code stummschalten.
//
// Der Xcode-Build meldete rund 530 Warnungen. Keine einzige stammte aus diesem
// Projekt: `mobile/src`, `mobile/modules` und `ios/Reelive` sind sauber. Sie
// kamen alle aus Abhaengigkeiten, allen voran
//
//   ~176  expo-sqlite/ios/sqlite3.c   (die SQLite-Amalgamation: 110x
//                                      -Wshorten-64-to-32, 61x -Wambiguous-macro)
//    ~63  Sentry                      (@_implementationOnly ohne library evolution)
//    ~43  react-native-maps
//    ~31  expo-image-picker
//
// Diesen Code zu korrigieren ist keine Option: er liegt in node_modules und in
// Pods, und das naechste `npm install` bzw. `pod install` macht jede Aenderung
// wieder zunichte. Bleibt, die Warnungen dort abzuschalten, wo sie entstehen —
// sonst gehen die eigenen zwischen den fremden unter, und genau dafuer sind sie
// da.
//
// Der Eingriff gehoert ins Podfile und nicht an den Xcode-Aufruf: die
// Pods-Projektdatei erzeugt CocoaPods bei jedem `pod install` neu, und nur der
// post_install-Hook laeuft danach. Und er gehoert in dieses Plugin und nicht
// von Hand ins Podfile, weil `expo prebuild` das Verzeichnis ios/ komplett neu
// schreibt.
//
// Was bewusst NICHT stummgeschaltet wird:
//   - die eigenen Native-Module aus modules/. Sie werden zwar als Pods gebaut,
//     sind aber eigener Code; ihre Warnungen sollen auffallen.
//   - Swift-Warnungen im App-Target Reelive. Dort liegt mit AppDelegate.swift
//     eigener Code.
//   - Linker-Meldungen (ld: duplicate libraries, -undefined dynamic_lookup) und
//     die Hinweise auf Skript-Phasen ohne Ausgabedateien. Die kommen nicht vom
//     Compiler und haben kein Warnungs-Flag; sie blieben uebrig.

const MARKER = '# @reelive Warnungen aus fremdem Code';

const BLOCK = `
    ${MARKER} — siehe plugins/withPodWarnungenStumm.js.
    # Die eigenen Native-Module aus modules/ bleiben ausgenommen: sie werden zwar
    # als Pods gebaut, sind aber eigener Code. Die Liste kommt aus den Podspecs
    # und nicht aus einer festen Aufzaehlung, damit ein neues Modul nicht
    # versehentlich mitverstummt.
    eigene_module = Dir.glob(File.join(__dir__, '..', 'modules', '*', 'ios', '*.podspec'))
                       .map { |pfad| File.basename(pfad, '.podspec') }

    fremde_projekte = [installer.pods_project]
    fremde_projekte += installer.generated_projects if installer.respond_to?(:generated_projects)
    fremde_projekte.compact.uniq.each do |projekt|
      projekt.targets.each do |ziel|
        next if eigene_module.include?(ziel.name)
        ziel.build_configurations.each do |konfiguration|
          konfiguration.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'
          konfiguration.build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
          # Rund 40 Meldungen der Form "libtool: 'X.o' has no symbols". Sie
          # entstehen beim Zusammenpacken der statischen Bibliotheken, nicht
          # beim Kompilieren, und gehen deshalb an den Warnungs-Flags vorbei.
          konfiguration.build_settings['OTHER_LIBTOOLFLAGS'] =
            '$(inherited) -no_warning_for_no_symbols'
        end
      end
    end
`;

const ANKER = 'react_native_post_install(';

// Warnungen aus fremden Objective-C-Headern. Das App-Target zieht ueber den
// Bridging-Header die Header von ExpoModulesCore, Expo und React-Core herein
// und meldet daraus rund 47 Warnungen aus Code, der uns nicht gehoert:
//
//   ~43  -Wnullability-completeness   (Zeiger ohne _Nonnull/_Nullable)
//     2  -Wdeprecated-declarations    ('RCTRootView' is deprecated)
//     2  -Wprotocol                   (RCTHostDelegate ohne Protokolldefinition)
//
// Alle entstehen im Schritt `PrecompileSwiftBridgingHeader`, also im
// Clang-Importer des Swift-Compilers, wenn er ios/Reelive-Bridging-Header.h
// uebersetzt. Der Header besteht ausschliesslich aus Imports fremder Header.
//
// Warum pauschal -w und nicht drei gezielte -Wno-Schalter: "cannot find
// protocol definition" ist in Clang eine Warnung ohne Diagnosegruppe
// (warn_undef_protocolref) — im Build-Log steht bei ihr kein [-W…]-Flag, und es
// gibt folglich kein -Wno- dafuer. Sie laesst sich nur mit -w abstellen.
//
// Zwei Umwege, die hier zuerst versucht wurden und nicht wirken: OTHER_CFLAGS
// und GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS erreichen den Importer nicht, der
// liest nur -Xcc. Nach einem sauberen Build standen die Warnungen unveraendert
// da.
//
// -Xcc wirkt ausschliesslich auf diesen Import. Eigener Swift-Code bleibt
// unberuehrt — auch seine Deprecation-Hinweise, denn die kommen vom
// Swift-Compiler selbst und nicht vom Importer. Kaeme eines Tages eigener
// Objective-C-Code dazu, wuerde er ebenfalls weiter gewarnt: der wird
// regulaer uebersetzt und geht gar nicht durch -Xcc. Fehler bleiben in jedem
// Fall Fehler; -w schaltet nur Warnungen ab.
const APP_EINSTELLUNGEN = {};

const APP_SWIFT_FLAGS = ['-Xcc', '-w'];

function fehler(was) {
  return new Error(
    `[withPodWarnungenStumm] ${was}\n` +
      'Das Podfile von expo prebuild hat sich geaendert. Zieh die Ankerstelle in ' +
      'plugins/withPodWarnungenStumm.js nach oder entferne das Plugin — ein Plugin, ' +
      'das seine Ankerstelle nicht mehr findet, meldet sich lieber laut, als still ' +
      '530 Warnungen zurueckkehren zu lassen.'
  );
}

// Das Ende des Aufrufs ueber die Klammerbilanz suchen statt ueber die letzte
// Zeile: deren Argumente (mac_catalyst_enabled, ccache_enabled …) wechseln
// zwischen den Expo-Versionen, die Klammern nicht.
function endeDesAufrufs(inhalt, start) {
  let tiefe = 0;
  for (let i = start; i < inhalt.length; i += 1) {
    if (inhalt[i] === '(') tiefe += 1;
    else if (inhalt[i] === ')') {
      tiefe -= 1;
      if (tiefe === 0) return i + 1;
    }
  }
  return -1;
}

// Als eigene Funktionen und nicht nur in den Mods, damit dasselbe auch auf ein
// bestehendes ios/ angewendet werden kann, ohne dafuer `expo prebuild` laufen
// zu lassen (das loescht Pods und die Team-Auswahl).
function podfileMitStummschaltung(inhalt) {
  // Mehrfachlauf abfangen: prebuild ruft Mods unter Umstaenden erneut auf.
  if (inhalt.includes(MARKER)) return inhalt;

  const start = inhalt.indexOf(ANKER);
  if (start === -1) {
    throw fehler(`Der Aufruf "${ANKER}" fehlt im post_install-Block.`);
  }

  const ende = endeDesAufrufs(inhalt, start);
  if (ende === -1) {
    throw fehler(`Die schliessende Klammer von "${ANKER}" fehlt.`);
  }

  // Hinter react_native_post_install und nicht davor: der Aufruf setzt selbst
  // Build-Settings und wuerde die Stummschaltung sonst ueberschreiben.
  return inhalt.slice(0, ende) + '\n' + BLOCK + inhalt.slice(ende);
}

// OTHER_SWIFT_FLAGS steht in der Projektdatei mal als Liste, mal als einzelner
// String und mal gar nicht. Anhaengen statt setzen, damit nichts verlorengeht,
// was `prebuild` oder ein anderes Plugin dort schon abgelegt hat.
function ergaenzeSwiftFlags(buildSettings, flags) {
  const vorhanden = buildSettings.OTHER_SWIFT_FLAGS;
  const bisher = Array.isArray(vorhanden)
    ? [...vorhanden]
    : typeof vorhanden === 'string'
      ? [vorhanden]
      : ['"$(inherited)"'];

  // Ueber die zusammengesetzte Zeile pruefen und nicht ueber einzelne Elemente:
  // "-Xcc" steht mehrfach darin, und ein Paar ist nur zusammen aussagekraeftig.
  const zeile = bisher.join(' ');
  for (let i = 0; i < flags.length; i += 2) {
    const paar = [flags[i], flags[i + 1]];
    if (zeile.includes(paar[1])) continue;
    bisher.push(...paar);
  }

  buildSettings.OTHER_SWIFT_FLAGS = bisher;
}

function setzeAppTargetEinstellung(projekt) {
  const konfigurationen = projekt.pbxXCBuildConfigurationSection();
  let getroffen = 0;

  for (const eintrag of Object.values(konfigurationen)) {
    if (typeof eintrag !== 'object' || !eintrag.buildSettings) continue;
    // Nur das App-Target, nicht die Pods (gleiche Abgrenzung wie in
    // withSceneLifecycle.js und withSentryOhneUpload.js).
    if (!eintrag.buildSettings.PRODUCT_NAME) continue;
    Object.assign(eintrag.buildSettings, APP_EINSTELLUNGEN);
    ergaenzeSwiftFlags(eintrag.buildSettings, APP_SWIFT_FLAGS);
    getroffen += 1;
  }

  if (getroffen === 0) {
    throw fehler('Keine Build-Konfiguration mit PRODUCT_NAME gefunden.');
  }
  return getroffen;
}

const withPodfileStumm = (config) =>
  withPodfile(config, (config) => {
    config.modResults.contents = podfileMitStummschaltung(config.modResults.contents);
    return config;
  });

const withAppTargetStumm = (config) =>
  withXcodeProject(config, (config) => {
    setzeAppTargetEinstellung(config.modResults);
    return config;
  });

module.exports = (config) => withAppTargetStumm(withPodfileStumm(config));

module.exports.podfileMitStummschaltung = podfileMitStummschaltung;
module.exports.setzeAppTargetEinstellung = setzeAppTargetEinstellung;
