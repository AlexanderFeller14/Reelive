const { withXcodeProject } = require('expo/config-plugins');

// Turn the Sentry upload off as long as there is no Sentry account.
//
// The Sentry plugin hangs two build phases into the Xcode project that upload
// source maps and debug symbols via sentry-cli. Both abort the build when
// organization and project are missing ("An organization ID or slug is
// required"). That is exactly the state without a Sentry account: the plugin
// then writes an `ios/sentry.properties` containing "# no org found, falling
// back to SENTRY_ORG environment variable", and that one does not exist either.
//
// @sentry/react-native has no plugin option against this (it only knows
// organization, project, authToken, url; plugin/build/withSentry.js). Both
// scripts do check SENTRY_DISABLE_AUTO_UPLOAD (scripts/sentry-xcode.sh:52,
// scripts/sentry-xcode-debug-files.sh:63), and Xcode passes build settings on to
// run-script phases as environment variables. That is why the switch lives here
// in the project and not in a file under ios/: everything there is regenerated
// by `prebuild` on every run.
//
// The plugin steps aside on its own: as soon as organization and project are
// configured, either as options on the "@sentry/react-native" entry in app.json
// or via SENTRY_ORG/SENTRY_PROJECT in the environment, it leaves the build
// phases alone and the uploads run again.

const SWITCH = 'SENTRY_DISABLE_AUTO_UPLOAD';
const SENTRY_PLUGIN = '@sentry/react-native';

function sentryAccountConfigured(config) {
  const entry = (config.plugins ?? []).find((p) =>
    Array.isArray(p) ? p[0] === SENTRY_PLUGIN : p === SENTRY_PLUGIN
  );
  const options = Array.isArray(entry) ? entry[1] : undefined;
  const organization = options?.organization ?? process.env.SENTRY_ORG;
  const project = options?.project ?? process.env.SENTRY_PROJECT;
  return Boolean(organization && project);
}

module.exports = (config) => {
  if (sentryAccountConfigured(config)) return config;

  return withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();
    let matched = 0;

    for (const entry of Object.values(configurations)) {
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      // Only the app target, not the Pods (same delimitation as in
      // withSceneLifecycle.js): the Sentry build phases hang there.
      if (!entry.buildSettings.PRODUCT_NAME) continue;
      entry.buildSettings[SWITCH] = 'true';
      matched += 1;
    }

    if (matched === 0) {
      throw new Error(
        '[withSentryWithoutUpload] No build configuration with PRODUCT_NAME found. ' +
          'Without the switch every build aborts in the Sentry phase, hence an abort ' +
          'here instead of a silent no-op.'
      );
    }

    console.log(
      `[withSentryWithoutUpload] No Sentry account configured, set ${SWITCH}=true. ` +
        'This build uploads neither source maps nor debug symbols.'
    );
    return config;
  });
};
