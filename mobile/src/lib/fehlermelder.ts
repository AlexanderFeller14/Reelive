// Task-10-Brief, Versprechen W10 (Spec §4): «Ohne Sentry-DSN verhält sich die
// App exakt wie heute.» Dasselbe Prinzip wie pushApi.ts in Phase 5, jeder
// Fehlschlag/jedes Fehlen einer Konfiguration ist ein NORMALFALL, kein
// Fehler, und darf nichts auffallen lassen: kein Sentry.init(), kein
// Netzwerkaufruf, keine Konsolen-Warnung.
//
// KEIN `import * as Sentry from '@sentry/react-native'` auf Modulebene,
// bewusst: ein Test hat belegt (siehe Bericht), dass das blosse LADEN des
// Pakets bereits einen internen `setInterval` startet (AsyncExpiringMap in
// dessen Tracing-Integration, unabhängig davon, ob je `Sentry.init()`
// aufgerufen wird). Ein Modulebene-Import würde diesen Timer bei JEDEM
// App-Start anlegen, DSN hin oder her, das wäre "heute" (ohne jeden
// Sentry-Code) nachweisbar NICHT der Fall und verletzte damit W10 wörtlich.
// `require()` innerhalb von initFehlermelder()/meldeFehler() lädt das Paket
// nur dann, wenn `aktiv` tatsächlich auf true steht (siehe dort), ohne DSN
// wird die Datei `@sentry/react-native` nie ausgeführt, der Timer entsteht
// nie.
type SentryModul = typeof import('@sentry/react-native');
function ladeSentry(): SentryModul {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@sentry/react-native');
}

// Einzige Quelle der Wahrheit dafür, ob je initialisiert wurde, sowohl
// initFehlermelder() als auch meldeFehler() lesen sie, statt sich darauf zu
// verlassen, dass @sentry/react-native selbst "leise" bleibt, wenn man es
// ohne vorherigen init() aufruft (ein Implementierungsdetail der fremden
// Bibliothek, das sich mit einer neuen Version ändern könnte, siehe
// "Mock ersetzt den Mechanismus"-Warnung im Plan: würde meldeFehler() blind
// captureException() aufrufen, bewiese kein Test mehr, dass OHNE DSN
// wirklich nichts passiert, nur dass die fremde Bibliothek gerade brav ist).
let aktiv = false;

// Setzt beim allerersten Aufruf mit gesetztem DSN `aktiv = true`, jeder
// weitere Aufruf (egal ob mit oder ohne DSN) ist dann ein No-Op. Das
// Root-Layout ruft diese Funktion beim Modul-Laden genau einmal auf (siehe
// _layout.tsx); die Absicherung hier ist trotzdem nötig, weil der Brief
// (Schritt 4) ausdrücklich verlangt: "mit DSN wird genau einmal
// initialisiert", ein zweiter Aufruf (z.B. durch Fast-Refresh in der
// Entwicklung) darf nicht zu einem zweiten Sentry.init() (und damit auch
// nicht zu einem zweiten require() der ohnehin schon geladenen Datei) führen.
// Final-Review Punkt 3: `init({ dsn })` allein läuft mit ALLEN
// Default-Integrationen, darunter `breadcrumbsIntegration` mit `xhr: true`
// und `console: true` (siehe node_modules/@sentry/react-native/dist/js/
// integrations/breadcrumbs.js). Damit würde Sentry zwei Kategorien
// mitschneiden, die hier nie hingehören:
//   - `xhr: true` protokolliert jede angefragte URL als Breadcrumb,
//     darunter die signierten S3-Lese-URLs aus media-urls (eine Stunde
//     gültige Zugangsdaten auf private Fotos/Videos, siehe media-urls/
//     keys.ts). Ein Sentry-Event würde diese Zugangsdaten dann an ein
//     drittes System weiterreichen, unabhängig davon, ob der Aufrufer daran
//     überhaupt gedacht hat.
//   - `console: true` protokolliert den Inhalt JEDES `console.error`-Aufrufs
//     als Breadcrumb, wörtlich, z.B. queueDb.ts, das (vor diesem Fix) eine
//     ganze Queue-Zeile samt `caption`/`lat`/`lng`/`place_name` loggte.
//     `console.error` ist im ganzen Projekt Diagnose-Kanal, kein Vertrag
//     darüber, was drin stehen darf, ihn ungefiltert an Sentry
//     durchzureichen macht jede künftige `console.error`-Stelle unbeabsichtigt
//     zu einer Sentry-Datenquelle.
//
// Entscheid: BEIDE Kategorien ganz abschalten (`console: false, xhr: false`),
// nicht per `beforeBreadcrumb` nachträglich filtern. Ein Filter müsste jede
// denkbare Form einer signierten URL (S3/R2-Query-Parameter unterscheiden
// sich je nach Provider) und jeden denkbaren `console.error`-Aufruf im
// gesamten (auch künftigen) Code erkennen, ein Abschalten an der Quelle
// verlangt das nicht und kann nicht durch eine neue Call-Site unterlaufen
// werden, die den Filter nicht kennt. Die übrigen Default-Integrationen
// (Absturzerfassung, `captureException` selbst inkl. Stack-Trace) bleiben
// unverändert, es geht ausschliesslich um automatisch mitgeschnittene
// Konsolen-/Netzwerk-Breadcrumbs.
export function initFehlermelder(): void {
  if (aktiv) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  aktiv = true;
  const sentry = ladeSentry();
  sentry.init({
    dsn,
    integrations: (defaults) =>
      defaults.map((integration) =>
        integration.name === 'Breadcrumbs'
          ? sentry.breadcrumbsIntegration({ console: false, xhr: false })
          : integration
      ),
  });
}

// `fehler` bewusst `unknown`, der typische Aufrufort ist ein catch-Block,
// und TypeScript strict typisiert dessen Parameter als `unknown`, nicht
// `Error` (er könnte alles sein, was `throw` wirft). `kontext` optional:
// zusätzliche, für die Fehlersuche hilfreiche Angaben (z.B. welcher Screen,
// welche trip_id) landen als `extra`-Daten im Sentry-Event.
export function meldeFehler(fehler: unknown, kontext?: Record<string, unknown>): void {
  if (!aktiv) return;
  ladeSentry().captureException(fehler, kontext ? { extra: kontext } : undefined);
}
