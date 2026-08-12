const { withXcodeProject } = require('expo/config-plugins');

// Sentry-Upload abschalten, solange es kein Sentry-Konto gibt.
//
// Das Sentry-Plugin haengt zwei Build-Phasen ins Xcode-Projekt, die per
// sentry-cli Source Maps und Debug-Symbole hochladen. Beide brechen den Build
// ab, wenn Organisation und Projekt fehlen ("An organization ID or slug is
// required"). Genau das ist der Zustand ohne Sentry-Konto: das Plugin schreibt
// dann ein `ios/sentry.properties` mit "# no org found, falling back to
// SENTRY_ORG environment variable", und die gibt es auch nicht.
//
// Eine Plugin-Option dagegen hat @sentry/react-native nicht (es kennt nur
// organization, project, authToken, url — plugin/build/withSentry.js). Beide
// Skripte pruefen aber SENTRY_DISABLE_AUTO_UPLOAD (scripts/sentry-xcode.sh:52,
// scripts/sentry-xcode-debug-files.sh:63), und Xcode reicht Build-Settings als
// Umgebungsvariablen an Run-Script-Phasen weiter. Darum steht der Schalter hier
// im Projekt und nicht in einer Datei unter ios/: alles dort erzeugt `prebuild`
// bei jedem Durchlauf neu.
//
// Das Plugin regelt sich selbst ab: sobald Organisation und Projekt konfiguriert
// sind — als Optionen am "@sentry/react-native"-Eintrag in app.json oder ueber
// SENTRY_ORG/SENTRY_PROJECT in der Umgebung — laesst es die Build-Phasen in
// Ruhe und die Uploads laufen wieder.

const SCHALTER = 'SENTRY_DISABLE_AUTO_UPLOAD';
const SENTRY_PLUGIN = '@sentry/react-native';

function sentryKontoKonfiguriert(config) {
  const eintrag = (config.plugins ?? []).find((p) =>
    Array.isArray(p) ? p[0] === SENTRY_PLUGIN : p === SENTRY_PLUGIN
  );
  const optionen = Array.isArray(eintrag) ? eintrag[1] : undefined;
  const organisation = optionen?.organization ?? process.env.SENTRY_ORG;
  const projekt = optionen?.project ?? process.env.SENTRY_PROJECT;
  return Boolean(organisation && projekt);
}

module.exports = (config) => {
  if (sentryKontoKonfiguriert(config)) return config;

  return withXcodeProject(config, (config) => {
    const konfigurationen = config.modResults.pbxXCBuildConfigurationSection();
    let getroffen = 0;

    for (const eintrag of Object.values(konfigurationen)) {
      if (typeof eintrag !== 'object' || !eintrag.buildSettings) continue;
      // Nur das App-Target, nicht die Pods (gleiche Abgrenzung wie in
      // withSceneLifecycle.js): die Build-Phasen von Sentry haengen dort.
      if (!eintrag.buildSettings.PRODUCT_NAME) continue;
      eintrag.buildSettings[SCHALTER] = 'true';
      getroffen += 1;
    }

    if (getroffen === 0) {
      throw new Error(
        '[withSentryOhneUpload] Keine Build-Konfiguration mit PRODUCT_NAME gefunden. ' +
          'Ohne den Schalter bricht jeder Build in der Sentry-Phase ab, deshalb hier ' +
          'ein Abbruch statt eines stillen No-Ops.'
      );
    }

    console.log(
      `[withSentryOhneUpload] Kein Sentry-Konto konfiguriert, ${SCHALTER}=true gesetzt. ` +
        'Dieser Build laedt weder Source Maps noch Debug-Symbole hoch.'
    );
    return config;
  });
};
