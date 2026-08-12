const { withXcodeProject } = require('expo/config-plugins');

// Die Apple-Team-ID aus der Umgebung ins Xcode-Projekt schreiben.
//
// `DEVELOPMENT_TEAM` traegt sonst Xcode ein, sobald man unter Signing &
// Capabilities ein Team waehlt — und `expo prebuild` erzeugt die pbxproj bei
// jedem Durchlauf neu, `ios/` ist gitignored (mobile/.gitignore:44). Ohne
// dieses Plugin ist die Auswahl nach jedem prebuild wieder weg und der
// Geraetebuild scheitert an fehlendem Signing. Ueber app.json geht es nicht:
// `@expo/prebuild-config` kennt kein Feld fuer die Team-ID.
//
// Der Wert steht in .env (lokal, gitignored) und nicht in app.json, weil die
// Team-ID zur Person und zum Rechner gehoert, nicht zum Projekt. Ohne die
// Variable tut das Plugin nichts: EAS-Builds bekommen ihr Team ueber die
// EAS-Credentials, dort waere ein fest eingetragenes Team sogar hinderlich.

const VARIABLE = 'REELIVE_APPLE_TEAM_ID';
const EINSTELLUNG = 'DEVELOPMENT_TEAM';

module.exports = (config) => {
  const team = process.env[VARIABLE]?.trim();
  if (!team) return config;

  // Eine Team-ID sind genau zehn alphanumerische Zeichen. Ein Klarname
  // ("Alexander Feller") ist der naheliegende Fehlgriff, und der erzeugt sonst
  // still ein Projekt, das erst in Xcode mit einer unverstaendlichen
  // Signing-Meldung auffaellt.
  if (!/^[A-Z0-9]{10}$/i.test(team)) {
    throw new Error(
      `[withAppleTeam] ${VARIABLE}="${team}" ist keine Team-ID. Erwartet werden zehn ` +
        'alphanumerische Zeichen (Xcode: Signing & Capabilities, oder ' +
        'developer.apple.com/account unter Membership details).'
    );
  }

  return withXcodeProject(config, (config) => {
    const konfigurationen = config.modResults.pbxXCBuildConfigurationSection();
    let getroffen = 0;

    for (const eintrag of Object.values(konfigurationen)) {
      if (typeof eintrag !== 'object' || !eintrag.buildSettings) continue;
      // Nur das App-Target, gleiche Abgrenzung wie in withSceneLifecycle.js.
      if (!eintrag.buildSettings.PRODUCT_NAME) continue;
      eintrag.buildSettings[EINSTELLUNG] = team;
      getroffen += 1;
    }

    if (getroffen === 0) {
      throw new Error(
        '[withAppleTeam] Keine Build-Konfiguration mit PRODUCT_NAME gefunden. Ohne ' +
          'Team laesst sich nicht auf ein Geraet bauen, deshalb hier ein Abbruch statt ' +
          'eines stillen No-Ops.'
      );
    }

    console.log(`[withAppleTeam] ${EINSTELLUNG}=${team} gesetzt (aus ${VARIABLE}).`);
    return config;
  });
};
