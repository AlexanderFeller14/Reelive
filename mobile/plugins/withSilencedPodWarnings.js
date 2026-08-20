const { withPodfile, withXcodeProject } = require('expo/config-plugins');

// Silence compiler warnings coming from third-party code.
//
// The Xcode build reported around 530 warnings. Not a single one came from this
// project: `mobile/src`, `mobile/modules` and `ios/Reelive` are clean. They all
// came from dependencies, above all
//
//   ~176  expo-sqlite/ios/sqlite3.c   (the SQLite amalgamation: 110x
//                                      -Wshorten-64-to-32, 61x -Wambiguous-macro)
//    ~63  Sentry                      (@_implementationOnly without library evolution)
//    ~43  react-native-maps
//    ~31  expo-image-picker
//
// Fixing that code is not an option: it lives in node_modules and in Pods, and
// the next `npm install` or `pod install` undoes every change. What remains is
// switching the warnings off where they appear, otherwise our own warnings drown
// among the foreign ones, and that is exactly what they are there for.
//
// The change belongs in the Podfile and not on the Xcode invocation: CocoaPods
// regenerates the Pods project file on every `pod install`, and only the
// post_install hook runs afterwards. And it belongs in this plugin rather than
// being written into the Podfile by hand, because `expo prebuild` rewrites the
// ios/ directory completely.
//
// What is deliberately NOT silenced:
//   - our own native modules from modules/. They are built as Pods, but they are
//     our own code; their warnings are meant to stand out.
//   - Swift warnings in the Reelive app target. AppDelegate.swift is our own
//     code and lives there.
//   - linker messages (ld: duplicate libraries, -undefined dynamic_lookup) and
//     the hints about script phases without output files. They do not come from
//     the compiler and have no warning flag; they remain.

const MARKER = '# @reelive warnings from third-party code';

const BLOCK = `
    ${MARKER}, see plugins/withSilencedPodWarnings.js.
    # Our own native modules from modules/ stay exempt: they are built as Pods,
    # but they are our own code. The list comes from the podspecs and not from a
    # fixed enumeration, so that a new module is not silenced by accident.
    own_modules = Dir.glob(File.join(__dir__, '..', 'modules', '*', 'ios', '*.podspec'))
                     .map { |path| File.basename(path, '.podspec') }

    foreign_projects = [installer.pods_project]
    foreign_projects += installer.generated_projects if installer.respond_to?(:generated_projects)
    foreign_projects.compact.uniq.each do |project|
      project.targets.each do |target|
        next if own_modules.include?(target.name)
        target.build_configurations.each do |configuration|
          configuration.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'
          configuration.build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
          # Around 40 messages of the form "libtool: 'X.o' has no symbols". They
          # appear while packing the static libraries, not while compiling, and
          # therefore slip past the warning flags.
          configuration.build_settings['OTHER_LIBTOOLFLAGS'] =
            '$(inherited) -no_warning_for_no_symbols'
        end
      end
    end
`;

const ANCHOR = 'react_native_post_install(';

// Warnings from third-party Objective-C headers. Through the bridging header the
// app target pulls in the headers of ExpoModulesCore, Expo and React-Core and
// reports around 47 warnings from code that is not ours:
//
//   ~43  -Wnullability-completeness   (pointers without _Nonnull/_Nullable)
//     2  -Wdeprecated-declarations    ('RCTRootView' is deprecated)
//     2  -Wprotocol                   (RCTHostDelegate without protocol definition)
//
// All of them appear in the `PrecompileSwiftBridgingHeader` step, that is in the
// Clang importer of the Swift compiler, while it translates
// ios/Reelive-Bridging-Header.h. That header consists exclusively of imports of
// third-party headers.
//
// Why a blanket -w and not three targeted -Wno switches: "cannot find protocol
// definition" is a warning without a diagnostic group in Clang
// (warn_undef_protocolref). The build log shows no [-W...] flag for it, and
// consequently there is no -Wno- for it either. It can only be turned off with
// -w.
//
// Two detours that were tried here first and do not work: OTHER_CFLAGS and
// GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS do not reach the importer, it only reads
// -Xcc. After a clean build the warnings stood there unchanged.
//
// -Xcc affects this import only. Our own Swift code stays untouched, including
// its deprecation hints, because those come from the Swift compiler itself and
// not from the importer. Should our own Objective-C code ever be added, it would
// keep being warned about as well: it is translated regularly and never goes
// through -Xcc. Errors remain errors in any case; -w only turns off warnings.
const APP_SETTINGS = {};

const APP_SWIFT_FLAGS = ['-Xcc', '-w'];

function failure(what) {
  return new Error(
    `[withSilencedPodWarnings] ${what}\n` +
      'The Podfile produced by expo prebuild has changed. Move the anchor in ' +
      'plugins/withSilencedPodWarnings.js along or remove the plugin: a plugin that no ' +
      'longer finds its anchor had better fail loudly than let 530 warnings quietly ' +
      'come back.'
  );
}

// Find the end of the call through the parenthesis balance rather than through
// its last line: its arguments (mac_catalyst_enabled, ccache_enabled ...) change
// between Expo versions, the parentheses do not.
function endOfCall(contents, start) {
  let depth = 0;
  for (let i = start; i < contents.length; i += 1) {
    if (contents[i] === '(') depth += 1;
    else if (contents[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Exported as standalone functions and not only used inside the mods, so that
// the same can be applied to an existing ios/ without running `expo prebuild`
// for it (that one deletes Pods and the team selection).
function podfileWithSilencedWarnings(contents) {
  // Catch a repeated run: prebuild may invoke mods more than once.
  if (contents.includes(MARKER)) return contents;

  const start = contents.indexOf(ANCHOR);
  if (start === -1) {
    throw failure(`The call "${ANCHOR}" is missing from the post_install block.`);
  }

  const end = endOfCall(contents, start);
  if (end === -1) {
    throw failure(`The closing parenthesis of "${ANCHOR}" is missing.`);
  }

  // After react_native_post_install and not before it: the call sets build
  // settings itself and would otherwise overwrite the silencing.
  return contents.slice(0, end) + '\n' + BLOCK + contents.slice(end);
}

// OTHER_SWIFT_FLAGS appears in the project file sometimes as a list, sometimes
// as a single string and sometimes not at all. Append instead of set, so that
// nothing `prebuild` or another plugin already put there gets lost.
function appendSwiftFlags(buildSettings, flags) {
  const existing = buildSettings.OTHER_SWIFT_FLAGS;
  const current = Array.isArray(existing)
    ? [...existing]
    : typeof existing === 'string'
      ? [existing]
      : ['"$(inherited)"'];

  // Check against the joined line and not against single elements: "-Xcc"
  // appears several times in it, and a pair only says something as a pair.
  const line = current.join(' ');
  for (let i = 0; i < flags.length; i += 2) {
    const pair = [flags[i], flags[i + 1]];
    if (line.includes(pair[1])) continue;
    current.push(...pair);
  }

  buildSettings.OTHER_SWIFT_FLAGS = current;
}

function setAppTargetSetting(project) {
  const configurations = project.pbxXCBuildConfigurationSection();
  let matched = 0;

  for (const entry of Object.values(configurations)) {
    if (typeof entry !== 'object' || !entry.buildSettings) continue;
    // Only the app target, not the Pods (same delimitation as in
    // withSceneLifecycle.js and withSentryWithoutUpload.js).
    if (!entry.buildSettings.PRODUCT_NAME) continue;
    Object.assign(entry.buildSettings, APP_SETTINGS);
    appendSwiftFlags(entry.buildSettings, APP_SWIFT_FLAGS);
    matched += 1;
  }

  if (matched === 0) {
    throw failure('No build configuration with PRODUCT_NAME found.');
  }
  return matched;
}

const withSilencedPodfile = (config) =>
  withPodfile(config, (config) => {
    config.modResults.contents = podfileWithSilencedWarnings(config.modResults.contents);
    return config;
  });

const withSilencedAppTarget = (config) =>
  withXcodeProject(config, (config) => {
    setAppTargetSetting(config.modResults);
    return config;
  });

module.exports = (config) => withSilencedAppTarget(withSilencedPodfile(config));

module.exports.podfileWithSilencedWarnings = podfileWithSilencedWarnings;
module.exports.setAppTargetSetting = setAppTargetSetting;
