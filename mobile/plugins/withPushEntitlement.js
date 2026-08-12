const fs = require('fs');
const plist = require('@expo/plist').default;
const { withFinalizedMod, IOSConfig } = require('expo/config-plugins');

// Das Push-Entitlement abschaltbar machen.
//
// `expo-notifications` schreibt bei jedem prebuild `aps-environment` in die
// Entitlements (node_modules/expo-notifications/plugin/build/withNotificationsIOS.js).
// Ein kostenloses Apple-Konto ("Personal Team") darf die Push-Capability nicht
// fuehren: Xcode findet dann kein Provisioning-Profil und bricht den Build ab,
// bevor ueberhaupt kompiliert wird ("Personal development teams ... do not
// support the Push Notifications capability").
//
// Wer ohne bezahltes Developer-Programm auf einem echten Geraet baut, setzt
// deshalb REELIVE_OHNE_PUSH=1 (in .env, die ist lokal und gitignored). Dieses
// Plugin nimmt das Entitlement dann wieder heraus.
//
// WARUM ueber `finalized` und die fertige Datei, nicht ueber
// withEntitlementsPlist: Die Position in app.json hilft hier nicht.
// `expo-notifications` steht in `versionedExpoSDKPackages`
// (@expo/prebuild-config/build/plugins/withDefaultPlugins.js), und diese
// Plugins haengt Expo NACH allen Plugins aus app.json an — ein
// withEntitlementsPlist-Mod von hier sieht die Entitlements darum noch leer
// und wird danach ueberschrieben (nachgemessen, nicht vermutet). Der
// `finalized`-Mod hat dagegen Vorrang 1 und laeuft als einziger garantiert nach
// allen anderen iOS-Mods (@expo/config-plugins/build/plugins/mod-compiler.js,
// `precedences`). Zu dem Zeitpunkt steht die Datei bereits auf der Platte.
//
// Ohne das Entitlement bekommt das Geraet keine Remote-Pushes. Die App laeuft
// normal weiter: registrierePushToken() faengt das ab und gibt 'fehler' zurueck
// (src/features/push/pushApi.ts), dieser Pfad ist dort als Normalfall
// dokumentiert. EAS-Builds sind nicht betroffen, sie lesen die lokale .env
// nicht.

const SCHALTER = 'REELIVE_OHNE_PUSH';
const ENTITLEMENT = 'aps-environment';

module.exports = (config) =>
  withFinalizedMod(config, [
    'ios',
    (config) => {
      if (process.env[SCHALTER] !== '1') return config;

      const pfad = IOSConfig.Paths.getEntitlementsPath(config.modRequest.projectRoot);
      // Kein Pfad heisst: es gibt gar keine Entitlements-Datei. Dann ist auch
      // nichts zu entfernen, und das ist der gewuenschte Zustand.
      if (!pfad) return config;

      const eintraege = plist.parse(fs.readFileSync(pfad, 'utf8'));
      if (!(ENTITLEMENT in eintraege)) return config;

      delete eintraege[ENTITLEMENT];
      // Die uebrigen Eintraege bleiben stehen: hier landen mit der Zeit auch
      // Associated Domains und Aehnliches, die mit Push nichts zu tun haben.
      fs.writeFileSync(pfad, plist.build(eintraege));

      // Laut, nicht still: ein weggelassenes Entitlement erklaert spaeter genau
      // die Frage «warum kommen auf diesem Build keine Pushes an».
      console.log(
        `[withPushEntitlement] ${SCHALTER}=1 gesetzt, «${ENTITLEMENT}» entfernt. ` +
          'Dieser Build empfaengt keine Remote-Pushes.'
      );
      return config;
    },
  ]);
