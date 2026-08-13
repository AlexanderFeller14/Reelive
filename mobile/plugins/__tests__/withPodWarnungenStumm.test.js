const {
  podfileMitStummschaltung,
  setzeAppTargetEinstellung,
} = require('../withPodWarnungenStumm');

// Ein Podfile in der Form, die `expo prebuild` erzeugt — gekuerzt auf das, was
// das Plugin sucht.
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

test('schaltet Warnungen fuer die Pod-Targets stumm', () => {
  const ergebnis = podfileMitStummschaltung(PODFILE);
  expect(ergebnis).toContain("build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'");
  expect(ergebnis).toContain("build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'");
});

test('der Block steht hinter react_native_post_install, nicht davor', () => {
  // Davor waere er wirkungslos: der Aufruf setzt selbst Build-Settings und
  // wuerde die Stummschaltung ueberschreiben.
  const ergebnis = podfileMitStummschaltung(PODFILE);
  expect(ergebnis.indexOf('GCC_WARN_INHIBIT_ALL_WARNINGS')).toBeGreaterThan(
    ergebnis.indexOf('react_native_post_install(')
  );
});

test('der Block landet innerhalb des post_install-Blocks', () => {
  const ergebnis = podfileMitStummschaltung(PODFILE);
  const zeilen = ergebnis.split('\n');
  const stelle = zeilen.findIndex((z) => z.includes('GCC_WARN_INHIBIT_ALL_WARNINGS'));
  const postInstall = zeilen.findIndex((z) => z.includes('post_install do |installer|'));
  // Nach post_install und vor dem `end`, das die target-Definition schliesst.
  expect(stelle).toBeGreaterThan(postInstall);
  expect(zeilen.slice(stelle).some((z) => z.trim() === 'end')).toBe(true);
});

test('ein zweiter Durchlauf aendert nichts', () => {
  // prebuild ruft Mods unter Umstaenden erneut auf; zwei Bloecke waeren zwar
  // harmlos, aber das Podfile soll sauber bleiben.
  const einmal = podfileMitStummschaltung(PODFILE);
  expect(podfileMitStummschaltung(einmal)).toBe(einmal);
});

test('ohne Ankerstelle bricht es ab, statt still nichts zu tun', () => {
  // Wenn Expo den post_install-Block umbaut, muss das auffallen — sonst kehren
  // die Warnungen unbemerkt zurueck.
  expect(() => podfileMitStummschaltung("target 'Reelive' do\nend\n")).toThrow(
    /react_native_post_install/
  );
});

test('eine offene Klammer bricht ab', () => {
  expect(() => podfileMitStummschaltung('  react_native_post_install(\n    installer,\n')).toThrow(
    /schliessende Klammer/
  );
});

test('die eigenen Native-Module aus modules/ bleiben ausgenommen', () => {
  // Sie werden als Pods gebaut, sind aber eigener Code — ihre Warnungen sollen
  // auffallen. Die Liste kommt aus den Podspecs, damit ein neues Modul nicht
  // versehentlich mitverstummt.
  const ergebnis = podfileMitStummschaltung(PODFILE);
  expect(ergebnis).toContain("'modules', '*', 'ios', '*.podspec'");
  expect(ergebnis).toContain('next if eigene_module.include?(ziel.name)');
});

test('libtool bekommt -no_warning_for_no_symbols', () => {
  // Rund 40 Meldungen entstehen beim Zusammenpacken der Bibliotheken und gehen
  // an den Warnungs-Flags vorbei.
  const ergebnis = podfileMitStummschaltung(PODFILE);
  expect(ergebnis).toContain('-no_warning_for_no_symbols');
  // $(inherited), damit vorhandene Flags nicht verlorengehen.
  expect(ergebnis).toContain("'$(inherited) -no_warning_for_no_symbols'");
});

function appProjekt(appEinstellungen = {}) {
  // Ein Xcode-Projekt in der Form, die das xcode-Paket liefert: das App-Target
  // hat PRODUCT_NAME, die Pod-Konfiguration nicht.
  const abschnitt = {
    APP: { buildSettings: { PRODUCT_NAME: 'Reelive', ...appEinstellungen } },
    POD: { buildSettings: { PRODUCT_MODULE_NAME: 'Irgendein_Pod' } },
  };
  return { abschnitt, projekt: { pbxXCBuildConfigurationSection: () => abschnitt } };
}

test('im App-Target werden nur die Warnungen aus fremden Headern abgeschaltet', () => {
  const { abschnitt, projekt } = appProjekt();
  expect(setzeAppTargetEinstellung(projekt)).toBe(1);

  const app = abschnitt.APP.buildSettings;
  // Der Clang-Importer des Swift-Compilers liest nur -Xcc, weder OTHER_CFLAGS
  // noch GCC_WARN_*.
  expect(app.OTHER_SWIFT_FLAGS.join(' ')).toContain('-Xcc -w');

  // Eigener Swift-Code bleibt scharf.
  expect(app.SWIFT_SUPPRESS_WARNINGS).toBeUndefined();
  expect(app.GCC_WARN_INHIBIT_ALL_WARNINGS).toBeUndefined();
  // Und eigener Objective-C-Code auch, falls je welcher dazukommt: -Xcc wirkt
  // nur auf den Header-Import, OTHER_CFLAGS wird bewusst nicht angefasst.
  expect(app.OTHER_CFLAGS).toBeUndefined();
  expect(app.GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS).toBeUndefined();

  // Die Pods bleiben von diesem Mod unberuehrt — die regelt das Podfile.
  expect(abschnitt.POD.buildSettings.CLANG_WARN_NULLABILITY_COMPLETENESS).toBeUndefined();
  expect(abschnitt.POD.buildSettings.OTHER_SWIFT_FLAGS).toBeUndefined();
});

test('ohne vorhandene OTHER_SWIFT_FLAGS wird $(inherited) mitgeschrieben', () => {
  // Sonst faellt weg, was auf Projektebene gesetzt ist.
  const { abschnitt, projekt } = appProjekt();
  setzeAppTargetEinstellung(projekt);
  expect(abschnitt.APP.buildSettings.OTHER_SWIFT_FLAGS[0]).toBe('"$(inherited)"');
});

test('vorhandene OTHER_SWIFT_FLAGS bleiben erhalten — als Liste', () => {
  const { abschnitt, projekt } = appProjekt({
    OTHER_SWIFT_FLAGS: ['"$(inherited)"', '-D', 'FOO'],
  });
  setzeAppTargetEinstellung(projekt);
  const flags = abschnitt.APP.buildSettings.OTHER_SWIFT_FLAGS;
  expect(flags.slice(0, 3)).toEqual(['"$(inherited)"', '-D', 'FOO']);
  expect(flags.join(' ')).toContain('-Xcc -w');
});

test('vorhandene OTHER_SWIFT_FLAGS bleiben erhalten — als String', () => {
  const { abschnitt, projekt } = appProjekt({ OTHER_SWIFT_FLAGS: '"$(inherited)"' });
  setzeAppTargetEinstellung(projekt);
  expect(abschnitt.APP.buildSettings.OTHER_SWIFT_FLAGS[0]).toBe('"$(inherited)"');
  expect(abschnitt.APP.buildSettings.OTHER_SWIFT_FLAGS.join(' ')).toContain('-Xcc -w');
});

test('ein zweiter Durchlauf haengt die Flags nicht doppelt an', () => {
  const { abschnitt, projekt } = appProjekt();
  setzeAppTargetEinstellung(projekt);
  setzeAppTargetEinstellung(projekt);
  const flags = abschnitt.APP.buildSettings.OTHER_SWIFT_FLAGS;
  expect(flags.filter((f) => f === '-w')).toHaveLength(1);
});

test('ohne App-Target bricht es ab', () => {
  const projekt = {
    pbxXCBuildConfigurationSection: () => ({ POD: { buildSettings: {} } }),
  };
  expect(() => setzeAppTargetEinstellung(projekt)).toThrow(/PRODUCT_NAME/);
});

test('mehrzeilige Argumente werden vollstaendig uebersprungen', () => {
  // Die Klammerbilanz muss auch verschachtelte Aufrufe mitzaehlen, sonst landet
  // der Block mitten in der Argumentliste und das Podfile ist Ruby-Schrott.
  const ergebnis = podfileMitStummschaltung(PODFILE);
  expect(ergebnis).toContain(':ccache_enabled => ccache_enabled?(podfile_properties),\n    )');
});
