const fs = require('fs');
const plist = require('@expo/plist').default;
const { withFinalizedMod, IOSConfig } = require('expo/config-plugins');

// Make the push entitlement switchable.
//
// `expo-notifications` writes `aps-environment` into the entitlements on every
// prebuild (node_modules/expo-notifications/plugin/build/withNotificationsIOS.js).
// A free Apple account ("Personal Team") is not allowed to carry the push
// capability: Xcode then finds no provisioning profile and aborts the build
// before anything is even compiled ("Personal development teams ... do not
// support the Push Notifications capability").
//
// Whoever builds onto a real device without a paid developer program therefore
// sets REELIVE_NO_PUSH=1 (in .env, which is local and gitignored). This plugin
// then takes the entitlement back out.
//
// WHY through `finalized` and the finished file, not through
// withEntitlementsPlist: the position in app.json does not help here.
// `expo-notifications` is listed in `versionedExpoSDKPackages`
// (@expo/prebuild-config/build/plugins/withDefaultPlugins.js), and Expo appends
// those plugins AFTER all plugins from app.json. A withEntitlementsPlist mod
// from here would still see the entitlements empty and be overwritten afterwards
// (measured, not assumed). The `finalized` mod on the other hand has precedence
// 1 and is the only one guaranteed to run after all other iOS mods
// (@expo/config-plugins/build/plugins/mod-compiler.js, `precedences`). By then
// the file is already on disk.
//
// Without the entitlement the device receives no remote pushes. The app keeps
// running normally: registerPushToken() catches that and returns 'fehler'
// (src/features/push/pushApi.ts), where that path is documented as a normal
// case. EAS builds are not affected, they do not read the local .env.

const SWITCH = 'REELIVE_NO_PUSH';
const ENTITLEMENT = 'aps-environment';

module.exports = (config) =>
  withFinalizedMod(config, [
    'ios',
    (config) => {
      if (process.env[SWITCH] !== '1') return config;

      const path = IOSConfig.Paths.getEntitlementsPath(config.modRequest.projectRoot);
      // No path means there is no entitlements file at all. Then there is
      // nothing to remove either, and that is the desired state.
      if (!path) return config;

      const entries = plist.parse(fs.readFileSync(path, 'utf8'));
      if (!(ENTITLEMENT in entries)) return config;

      delete entries[ENTITLEMENT];
      // The remaining entries stay: over time associated domains and the like
      // end up here too, and those have nothing to do with push.
      fs.writeFileSync(path, plist.build(entries));

      // Loudly, not quietly: a dropped entitlement later answers exactly the
      // question "why does this build receive no pushes".
      console.log(
        `[withPushEntitlement] ${SWITCH}=1 set, removed «${ENTITLEMENT}». ` +
          'This build receives no remote pushes.'
      );
      return config;
    },
  ]);
