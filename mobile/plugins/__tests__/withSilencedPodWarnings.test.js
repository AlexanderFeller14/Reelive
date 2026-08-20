const {
  podfileWithSilencedWarnings,
  setAppTargetSetting,
} = require('../withSilencedPodWarnings');

// A Podfile in the shape `expo prebuild` produces, trimmed down to what the
// plugin looks for.
const PODFILE = `target 'Reelive' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

test('silences the warnings for the Pod targets', () => {
  const result = podfileWithSilencedWarnings(PODFILE);
  expect(result).toContain("build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'");
  expect(result).toContain("build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'");
});

test('the block sits after react_native_post_install, not before it', () => {
  // Before it, it would have no effect: the call sets build settings itself and
  // would overwrite the silencing.
  const result = podfileWithSilencedWarnings(PODFILE);
  expect(result.indexOf('GCC_WARN_INHIBIT_ALL_WARNINGS')).toBeGreaterThan(
    result.indexOf('react_native_post_install(')
  );
});

test('the block lands inside the post_install block', () => {
  const result = podfileWithSilencedWarnings(PODFILE);
  const lines = result.split('\n');
  const position = lines.findIndex((l) => l.includes('GCC_WARN_INHIBIT_ALL_WARNINGS'));
  const postInstall = lines.findIndex((l) => l.includes('post_install do |installer|'));
  // After post_install and before the `end` that closes the target definition.
  expect(position).toBeGreaterThan(postInstall);
  expect(lines.slice(position).some((l) => l.trim() === 'end')).toBe(true);
});

test('a second run changes nothing', () => {
  // prebuild may invoke mods more than once; two blocks would be harmless, but
  // the Podfile is meant to stay clean.
  const once = podfileWithSilencedWarnings(PODFILE);
  expect(podfileWithSilencedWarnings(once)).toBe(once);
});

test('without its anchor it aborts instead of quietly doing nothing', () => {
  // If Expo rearranges the post_install block, that has to stand out, otherwise
  // the warnings come back unnoticed.
  expect(() => podfileWithSilencedWarnings("target 'Reelive' do\nend\n")).toThrow(
    /react_native_post_install/
  );
});

test('an unclosed parenthesis aborts', () => {
  expect(() =>
    podfileWithSilencedWarnings('  react_native_post_install(\n    installer,\n')
  ).toThrow(/closing parenthesis/);
});

test('our own native modules from modules/ stay exempt', () => {
  // They are built as Pods, but they are our own code, and their warnings are
  // meant to stand out. The list comes from the podspecs so that a new module is
  // not silenced by accident.
  const result = podfileWithSilencedWarnings(PODFILE);
  expect(result).toContain("'modules', '*', 'ios', '*.podspec'");
  expect(result).toContain('next if own_modules.include?(target.name)');
});

test('libtool gets -no_warning_for_no_symbols', () => {
  // Around 40 messages appear while packing the libraries and slip past the
  // warning flags.
  const result = podfileWithSilencedWarnings(PODFILE);
  expect(result).toContain('-no_warning_for_no_symbols');
  // $(inherited), so that existing flags do not get lost.
  expect(result).toContain("'$(inherited) -no_warning_for_no_symbols'");
});

function appProject(appSettings = {}) {
  // An Xcode project in the shape the xcode package delivers: the app target has
  // PRODUCT_NAME, the Pod configuration does not.
  const section = {
    APP: { buildSettings: { PRODUCT_NAME: 'Reelive', ...appSettings } },
    POD: { buildSettings: { PRODUCT_MODULE_NAME: 'Some_Pod' } },
  };
  return { section, project: { pbxXCBuildConfigurationSection: () => section } };
}

test('in the app target only the warnings from third-party headers are turned off', () => {
  const { section, project } = appProject();
  expect(setAppTargetSetting(project)).toBe(1);

  const app = section.APP.buildSettings;
  // The Clang importer of the Swift compiler reads only -Xcc, neither
  // OTHER_CFLAGS nor GCC_WARN_*.
  expect(app.OTHER_SWIFT_FLAGS.join(' ')).toContain('-Xcc -w');

  // Our own Swift code stays sharp.
  expect(app.SWIFT_SUPPRESS_WARNINGS).toBeUndefined();
  expect(app.GCC_WARN_INHIBIT_ALL_WARNINGS).toBeUndefined();
  // And our own Objective-C code too, should any ever be added: -Xcc affects
  // only the header import, OTHER_CFLAGS is deliberately left alone.
  expect(app.OTHER_CFLAGS).toBeUndefined();
  expect(app.GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS).toBeUndefined();

  // The Pods stay untouched by this mod, the Podfile handles those.
  expect(section.POD.buildSettings.CLANG_WARN_NULLABILITY_COMPLETENESS).toBeUndefined();
  expect(section.POD.buildSettings.OTHER_SWIFT_FLAGS).toBeUndefined();
});

test('without existing OTHER_SWIFT_FLAGS, $(inherited) is written along', () => {
  // Otherwise whatever is set at project level falls away.
  const { section, project } = appProject();
  setAppTargetSetting(project);
  expect(section.APP.buildSettings.OTHER_SWIFT_FLAGS[0]).toBe('"$(inherited)"');
});

test('existing OTHER_SWIFT_FLAGS survive, as a list', () => {
  const { section, project } = appProject({
    OTHER_SWIFT_FLAGS: ['"$(inherited)"', '-D', 'FOO'],
  });
  setAppTargetSetting(project);
  const flags = section.APP.buildSettings.OTHER_SWIFT_FLAGS;
  expect(flags.slice(0, 3)).toEqual(['"$(inherited)"', '-D', 'FOO']);
  expect(flags.join(' ')).toContain('-Xcc -w');
});

test('existing OTHER_SWIFT_FLAGS survive, as a string', () => {
  const { section, project } = appProject({ OTHER_SWIFT_FLAGS: '"$(inherited)"' });
  setAppTargetSetting(project);
  expect(section.APP.buildSettings.OTHER_SWIFT_FLAGS[0]).toBe('"$(inherited)"');
  expect(section.APP.buildSettings.OTHER_SWIFT_FLAGS.join(' ')).toContain('-Xcc -w');
});

test('a second run does not append the flags twice', () => {
  const { section, project } = appProject();
  setAppTargetSetting(project);
  setAppTargetSetting(project);
  const flags = section.APP.buildSettings.OTHER_SWIFT_FLAGS;
  expect(flags.filter((f) => f === '-w')).toHaveLength(1);
});

test('without an app target it aborts', () => {
  const project = {
    pbxXCBuildConfigurationSection: () => ({ POD: { buildSettings: {} } }),
  };
  expect(() => setAppTargetSetting(project)).toThrow(/PRODUCT_NAME/);
});

test('multi-line arguments are skipped completely', () => {
  // The parenthesis balance has to count nested calls too, otherwise the block
  // lands in the middle of the argument list and the Podfile is Ruby garbage.
  const result = podfileWithSilencedWarnings(PODFILE);
  expect(result).toContain(':ccache_enabled => ccache_enabled?(podfile_properties),\n    )');
});
