const { withXcodeProject } = require('expo/config-plugins');

// Write the Apple team ID from the environment into the Xcode project.
//
// `DEVELOPMENT_TEAM` is otherwise entered by Xcode as soon as a team is picked
// under Signing & Capabilities, and `expo prebuild` regenerates the pbxproj on
// every run, `ios/` is gitignored (mobile/.gitignore:44). Without this plugin
// the selection is gone after every prebuild and the device build fails on
// missing signing. Going through app.json does not work: `@expo/prebuild-config`
// has no field for the team ID.
//
// The value lives in .env (local, gitignored) and not in app.json, because the
// team ID belongs to the person and the machine, not to the project. Without the
// variable the plugin does nothing: EAS builds get their team from the EAS
// credentials, where a hard-coded team would even get in the way.

const VARIABLE = 'REELIVE_APPLE_TEAM_ID';
const SETTING = 'DEVELOPMENT_TEAM';

module.exports = (config) => {
  const team = process.env[VARIABLE]?.trim();
  if (!team) return config;

  // A team ID is exactly ten alphanumeric characters. A plain name ("Alexander
  // Feller") is the obvious slip, and it otherwise quietly produces a project
  // that only shows up in Xcode with an incomprehensible signing message.
  if (!/^[A-Z0-9]{10}$/i.test(team)) {
    throw new Error(
      `[withAppleTeam] ${VARIABLE}="${team}" is not a team ID. Expected are ten ` +
        'alphanumeric characters (Xcode: Signing & Capabilities, or ' +
        'developer.apple.com/account under Membership details).'
    );
  }

  return withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();
    let matched = 0;

    for (const entry of Object.values(configurations)) {
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      // Only the app target, same delimitation as in withSceneLifecycle.js.
      if (!entry.buildSettings.PRODUCT_NAME) continue;
      entry.buildSettings[SETTING] = team;
      matched += 1;
    }

    if (matched === 0) {
      throw new Error(
        '[withAppleTeam] No build configuration with PRODUCT_NAME found. Without a ' +
          'team there is no building onto a device, hence an abort here instead of a ' +
          'silent no-op.'
      );
    }

    console.log(`[withAppleTeam] set ${SETTING}=${team} (from ${VARIABLE}).`);
    return config;
  });
};
