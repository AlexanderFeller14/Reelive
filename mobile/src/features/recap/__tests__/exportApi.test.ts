// Gleiches Mock-Grundmuster wie moments/__tests__/medien.test.ts: ein
// winziges Dateisystem im Speicher (`mockVorhanden`), damit die Tests
// tatsächliches Anlegen/Löschen prüfen können — nicht bloss, dass eine
// Methode irgendwann aufgerufen wurde. Phase-5-Lehre: ein Mock, der genau
// den Mechanismus ersetzt, den der Test prüfen soll (hier: ob eine
// Zwischendatei WIRKLICH verschwindet), prüfte nichts — deshalb ein echtes,
// zustandsbehaftetes Fake statt eines reinen jest.fn()-Stubs.
const mockVorhanden = new Set<string>();
// Pro URL steuerbares Verhalten: 'ok' legt die Zieldatei an und löst auf,
// 'fehler' wirft (simuliert einen Netzwerk-/HTTP-Fehlschlag OHNE Zieldatei —
// der Normalfall laut expo-file-system-Doku für einen Non-2xx-Status),
// 'fehler-mit-datei' wirft, legt die Zieldatei aber TROTZDEM an (Android-Fall
// aus der Doku: "a partially written file may remain"), 'haenge' löst NIE
// von selbst auf und reagiert nur auf ein AbortSignal — für Tests, die einen
// Abbruch MITTEN in einem laufenden Download simulieren.
type DownloadPlan = 'ok' | 'fehler' | 'fehler-mit-datei' | 'haenge';
const mockDownloadPlan: Record<string, DownloadPlan> = {};
const mockDownloadFileAsync = jest.fn(
  (url: string, destination: { uri: string }, options?: { signal?: AbortSignal }) => {
    const plan = mockDownloadPlan[url] ?? 'ok';
    return new Promise((resolve, reject) => {
      const abortFehler = () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (options?.signal) {
        if (options.signal.aborted) return abortFehler();
        options.signal.addEventListener('abort', abortFehler);
      }
      if (plan === 'haenge') return; // löst nur über das AbortSignal auf
      if (plan === 'fehler') return reject(new Error('UnableToDownload: 500'));
      if (plan === 'fehler-mit-datei') {
        mockVorhanden.add(destination.uri);
        return reject(new Error('UnableToDownload: connection dropped'));
      }
      mockVorhanden.add(destination.uri);
      resolve(destination);
    });
  }
);

jest.mock('expo-file-system', () => {
  const verbinden = (teile: unknown[]): string =>
    teile
      .map((t) => (typeof t === 'string' ? t : (t as { uri: string }).uri))
      .map((t, i) => (i === 0 ? t.replace(/\/+$/, '') : t.replace(/^\/+|\/+$/g, '')))
      .join('/');

  class MockDirectory {
    uri: string;
    constructor(...teile: unknown[]) {
      this.uri = verbinden(teile);
    }
    // Ein reales Dateisystem kennt kein "die Datei existiert, aber ihr
    // Elternordner nicht" — ein Ordner mit Inhalt EXISTIERT damit zwangsläufig
    // mit, auch ohne einen expliziten eigenen .create()-Aufruf (z.B. ein
    // verwaister Rest aus einem vorherigen, abgestürzten Lauf, der nie über
    // DIESES Mock-Objekt angelegt wurde). Ohne diese zweite Bedingung wäre
    // `ordner.exists` hier strenger als das echte Verhalten, gegen das
    // raeumeExportOrdnerAufNeu() sich verteidigen soll.
    get exists(): boolean {
      return mockVorhanden.has(this.uri) || [...mockVorhanden].some((p) => p.startsWith(`${this.uri}/`));
    }
    create() {
      mockVorhanden.add(this.uri);
    }
    delete() {
      for (const pfad of [...mockVorhanden]) {
        if (pfad === this.uri || pfad.startsWith(`${this.uri}/`)) mockVorhanden.delete(pfad);
      }
    }
  }

  class MockFile {
    uri: string;
    constructor(...teile: unknown[]) {
      this.uri = verbinden(teile);
    }
    get exists(): boolean {
      return mockVorhanden.has(this.uri);
    }
    delete() {
      if (!mockVorhanden.has(this.uri)) throw new Error('gibt es nicht');
      mockVorhanden.delete(this.uri);
    }
    static downloadFileAsync = (...args: Parameters<typeof mockDownloadFileAsync>) =>
      mockDownloadFileAsync(...args);
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: { uri: 'file:///cache' } },
  };
});

// expo-media-library/legacy (Kommentar in exportApi.ts erklärt, warum LEGACY
// statt des modernen Asset.create()-Einstiegs: nur der Legacy-Pfad hat einen
// echten Web-Shim, der 'expo export --platform web' nicht zerbricht).
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockAssetCreate = jest.fn(async (uri: string) => ({ id: `asset-${uri}` }));
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  createAssetAsync: (...args: [string]) => mockAssetCreate(...args),
}));

import {
  sichergestellteBerechtigung,
  sichereMomentInGalerie,
  sichereAlleInGalerie,
  KEIN_ZUGRIFF_TEXT,
  type AlleFortschritt,
} from '../exportApi';
import type { RecapMoment } from '../types';
import type { MedienUrl } from '../urlVorrat';

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Zurich', place_name: null,
    lat: null, lng: null,
    upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}
function bild(id: string, overrides: Partial<MedienUrl> = {}): MedienUrl {
  return { post_id: id, medium_url: `https://cdn.example/${id}-medium.jpg`, thumb_url: `https://cdn.example/${id}-thumb.jpg`, ...overrides };
}

const GRANTED = { granted: true, canAskAgain: true };
const DENIED_CAN_ASK = { granted: false, canAskAgain: true };
const DENIED_CANT_ASK = { granted: false, canAskAgain: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockVorhanden.clear();
  for (const key of Object.keys(mockDownloadPlan)) delete mockDownloadPlan[key];
  mockGetPermissionsAsync.mockResolvedValue(GRANTED);
});

describe('sichergestellteBerechtigung', () => {
  test('bereits erlaubt: kein zusätzlicher Request-Aufruf', async () => {
    mockGetPermissionsAsync.mockResolvedValue(GRANTED);
    const ergebnis = await sichergestellteBerechtigung();
    expect(ergebnis).toEqual({ erlaubt: true });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  // writeOnly=true (Kommentar im Code): die App liest nie vorhandene Fotos.
  test('fragt writeOnly (nur "hinzufügen"), nicht vollen Lesezugriff', async () => {
    mockGetPermissionsAsync.mockResolvedValue(GRANTED);
    await sichergestellteBerechtigung();
    expect(mockGetPermissionsAsync).toHaveBeenCalledWith(true);
  });

  test('noch nicht erlaubt, aber erneut fragbar: fragt nach und meldet Erfolg', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    mockRequestPermissionsAsync.mockResolvedValue(GRANTED);
    const ergebnis = await sichergestellteBerechtigung();
    expect(ergebnis).toEqual({ erlaubt: true });
    expect(mockRequestPermissionsAsync).toHaveBeenCalledWith(true);
  });

  test('erneut gefragt, aber wieder abgelehnt: KEIN_ZUGRIFF_TEXT', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    mockRequestPermissionsAsync.mockResolvedValue(DENIED_CAN_ASK);
    const ergebnis = await sichergestellteBerechtigung();
    expect(ergebnis).toEqual({ erlaubt: false, text: KEIN_ZUGRIFF_TEXT });
  });

  // canAskAgain:false (Person hat "Nicht erlauben" dauerhaft gewählt) — ein
  // erneuter Request-Aufruf wäre auf iOS/Android ein No-Op, der nur den
  // alten Wert zurückgibt. Kein stiller Fehlschlag: der Text erklärt trotzdem
  // den Weg über die Einstellungen.
  test('dauerhaft abgelehnt (canAskAgain=false): fragt gar nicht erst erneut, meldet trotzdem den Weg in die Einstellungen', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const ergebnis = await sichergestellteBerechtigung();
    expect(ergebnis).toEqual({ erlaubt: false, text: KEIN_ZUGRIFF_TEXT });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('ein Fehler bei der Prüfung selbst ist kein stiller Fehlschlag, sondern eine eigene Meldung', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    const ergebnis = await sichergestellteBerechtigung();
    expect(ergebnis.erlaubt).toBe(false);
    expect((ergebnis as { text: string }).text).toMatch(/nicht geprüft werden/);
  });
});

describe('sichereMomentInGalerie', () => {
  test('ohne Berechtigung: kein Download, kein Asset.create, KEIN_ZUGRIFF_TEXT', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const ergebnis = await sichereMomentInGalerie(moment(), bild('p1'));
    expect(ergebnis).toEqual({ ok: false, grund: 'keine_berechtigung', text: KEIN_ZUGRIFF_TEXT });
    expect(mockDownloadFileAsync).not.toHaveBeenCalled();
    expect(mockAssetCreate).not.toHaveBeenCalled();
  });

  test('lädt medium_url (volle Auflösung), NIE thumb_url', async () => {
    const url = bild('p1');
    await sichereMomentInGalerie(moment({ id: 'p1' }), url);
    expect(mockDownloadFileAsync).toHaveBeenCalledWith(url.medium_url, expect.anything(), expect.anything());
    const geladeneUrls = mockDownloadFileAsync.mock.calls.map((c) => c[0]);
    expect(geladeneUrls).not.toContain(url.thumb_url);
  });

  test('übergibt die heruntergeladene Datei an MediaLibrary.Asset.create und meldet Erfolg', async () => {
    const ergebnis = await sichereMomentInGalerie(moment({ id: 'p1', type: 'photo' }), bild('p1'));
    expect(ergebnis).toEqual({ ok: true });
    expect(mockAssetCreate).toHaveBeenCalledTimes(1);
    expect(mockAssetCreate.mock.calls[0][0]).toContain('p1.jpg');
  });

  test('die Zwischendatei ist NACH einem erfolgreichen Sichern wieder weg', async () => {
    await sichereMomentInGalerie(moment({ id: 'p1' }), bild('p1'));
    const uebrig = [...mockVorhanden].filter((p) => p.includes('p1.jpg'));
    expect(uebrig).toEqual([]);
  });

  test('ein fehlgeschlagener Download meldet einen Fehler, OHNE Asset.create aufzurufen', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'fehler';
    const ergebnis = await sichereMomentInGalerie(moment({ id: 'p1' }), bild('p1'));
    expect(ergebnis.ok).toBe(false);
    expect(mockAssetCreate).not.toHaveBeenCalled();
  });

  // Kernfall (Auftrag: "wie du bei Abbruch UND Fehlschlag aufräumst"): auf
  // Android kann laut expo-file-system-Doku bei einem fehlgeschlagenen
  // Download trotzdem eine TEILWEISE geschriebene Datei zurückbleiben — die
  // muss genauso verschwinden wie im Erfolgsfall.
  test('eine bei einem Fehlschlag teilweise geschriebene Datei (Android-Fall) wird trotzdem aufgeräumt', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'fehler-mit-datei';
    await sichereMomentInGalerie(moment({ id: 'p1' }), bild('p1'));
    const uebrig = [...mockVorhanden].filter((p) => p.includes('p1.jpg'));
    expect(uebrig).toEqual([]);
  });

  // Kernfall: der Download gelingt, ABER Asset.create (der zweite Schritt)
  // scheitert — die Zwischendatei muss AUCH DANN weg sein. Ein `finally` nur
  // um den Download-Aufruf herum würde das nicht abdecken.
  test('schlägt Asset.create fehl, wird die bereits heruntergeladene Zwischendatei trotzdem gelöscht', async () => {
    mockAssetCreate.mockRejectedValueOnce(new Error('Galerie-Fehler'));
    const ergebnis = await sichereMomentInGalerie(moment({ id: 'p1' }), bild('p1'));
    expect(ergebnis.ok).toBe(false);
    const uebrig = [...mockVorhanden].filter((p) => p.includes('p1.jpg'));
    expect(uebrig).toEqual([]);
  });

  // Phase-4-Lehre (Auftragstext, wörtlich): ein verwaister Rest aus einem
  // ABGESTÜRZTEN vorherigen Lauf darf nicht liegen bleiben, bis er selbst zum
  // Speicherproblem wird — ein neuer Export-Versuch räumt den GESAMTEN
  // Export-Ordner zuerst leer, bevor er selbst etwas anlegt.
  test('ein verwaister Rest aus einem früheren (z.B. abgestürzten) Lauf wird vor dem nächsten Export geräumt', async () => {
    mockVorhanden.add('file:///cache/export/uralt-verwaist.jpg');
    await sichereMomentInGalerie(moment({ id: 'p1' }), bild('p1'));
    expect(mockVorhanden.has('file:///cache/export/uralt-verwaist.jpg')).toBe(false);
  });
});

describe('sichereAlleInGalerie', () => {
  const eintraege = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      moment: moment({ id: `p${i + 1}` }),
      url: bild(`p${i + 1}`),
    }));

  test('ohne Berechtigung: status "keine_berechtigung", kein einziger Download', async () => {
    mockGetPermissionsAsync.mockResolvedValue(DENIED_CANT_ASK);
    const ergebnis = await sichereAlleInGalerie(eintraege(5), jest.fn());
    expect(ergebnis).toEqual({ status: 'keine_berechtigung', text: KEIN_ZUGRIFF_TEXT });
    expect(mockDownloadFileAsync).not.toHaveBeenCalled();
  });

  test('alle erfolgreich: ehrliche Bilanz und Fortschritt "1 von 3" … "3 von 3"', async () => {
    const fortschritte: AlleFortschritt[] = [];
    const ergebnis = await sichereAlleInGalerie(eintraege(3), (stand) => fortschritte.push(stand));
    expect(ergebnis).toEqual({ status: 'fertig', gesichert: 3, gesamt: 3, fehlgeschlagen: 0, abgebrochen: false });
    expect(fortschritte).toEqual([
      { erledigt: 1, gesamt: 3 },
      { erledigt: 2, gesamt: 3 },
      { erledigt: 3, gesamt: 3 },
    ]);
  });

  // Kernfall aus dem Auftrag: "Nicht «fertig», wenn drei Dateien fehlen" —
  // die Bilanz muss die Fehlschläge EHRLICH zählen, nicht unter den Tisch
  // fallen lassen oder die ganze Aktion als Ganzes scheitern lassen.
  test('ein Fehlschlag mittendrin bricht NICHT die ganze Aktion ab, sondern zählt ehrlich mit', async () => {
    mockDownloadPlan['https://cdn.example/p2-medium.jpg'] = 'fehler';
    const ergebnis = await sichereAlleInGalerie(eintraege(3), jest.fn());
    expect(ergebnis).toEqual({ status: 'fertig', gesichert: 2, gesamt: 3, fehlgeschlagen: 1, abgebrochen: false });
    // p1 und p3 sind trotzdem gesichert worden — kein Fehlschlag stoppt die
    // übrigen Momente.
    expect(mockAssetCreate).toHaveBeenCalledTimes(2);
  });

  test('drei von fünf Fehlschlägen: die Bilanz nennt genau 3, nicht "fertig" ohne Zahl', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'fehler';
    mockDownloadPlan['https://cdn.example/p3-medium.jpg'] = 'fehler';
    mockDownloadPlan['https://cdn.example/p5-medium.jpg'] = 'fehler';
    const ergebnis = await sichereAlleInGalerie(eintraege(5), jest.fn());
    expect(ergebnis).toEqual({ status: 'fertig', gesichert: 2, gesamt: 5, fehlgeschlagen: 3, abgebrochen: false });
  });

  test('Abbruch VOR dem nächsten Element: die verbleibenden Elemente werden gar nicht erst angefasst', async () => {
    const controller = new AbortController();
    const fortschritte: AlleFortschritt[] = [];
    const lauf = sichereAlleInGalerie(eintraege(5), (stand) => {
      fortschritte.push(stand);
      if (stand.erledigt === 2) controller.abort();
    }, controller.signal);
    const ergebnis = await lauf;
    expect(ergebnis).toEqual({ status: 'fertig', gesichert: 2, gesamt: 5, fehlgeschlagen: 0, abgebrochen: true });
    expect(mockDownloadFileAsync).toHaveBeenCalledTimes(2);
  });

  // Kernfall "abbrechbar" (Auftrag, wörtlich): ein Abbruch MITTEN in einem
  // laufenden Download muss diesen Download selbst beenden (nicht nur den
  // NÄCHSTEN verhindern) — geprüft über einen Download, der ohne Abbruch nie
  // von selbst aufgelöst hätte ('haenge').
  test('Abbruch MITTEN in einem laufenden Download beendet ihn sofort, ohne ihn als Fehlschlag zu zählen', async () => {
    mockDownloadPlan['https://cdn.example/p2-medium.jpg'] = 'haenge';
    const controller = new AbortController();
    const lauf = sichereAlleInGalerie(eintraege(3), jest.fn(), controller.signal);
    // p1 läuft synchron-genug durch (Promise-Microtasks), p2 hängt in
    // 'haenge' fest — jetzt mitten im laufenden Download abbrechen.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const ergebnis = await lauf;
    expect(ergebnis).toEqual({ status: 'fertig', gesichert: 1, gesamt: 3, fehlgeschlagen: 0, abgebrochen: true });
    // p3 wurde nie angefasst.
    const geladeneUrls = mockDownloadFileAsync.mock.calls.map((c) => c[0]);
    expect(geladeneUrls).not.toContain('https://cdn.example/p3-medium.jpg');
  });

  // Aufräumen gilt auch bei EINEM abgebrochenen Element mitten im Lauf —
  // nicht nur am Ende der ganzen Aktion.
  test('die Zwischendatei eines mitten im Download abgebrochenen Elements wird ebenfalls aufgeräumt', async () => {
    mockDownloadPlan['https://cdn.example/p1-medium.jpg'] = 'haenge';
    const controller = new AbortController();
    const lauf = sichereAlleInGalerie(eintraege(1), jest.fn(), controller.signal);
    await Promise.resolve();
    controller.abort();
    await lauf;
    const uebrig = [...mockVorhanden].filter((p) => p.includes('p1.jpg'));
    expect(uebrig).toEqual([]);
  });

  test('jede Zwischendatei ist bereits NACH ihrem eigenen Element weg, nicht erst am Ende gesammelt aufgeräumt', async () => {
    const nachElement1: boolean[] = [];
    await sichereAlleInGalerie(eintraege(3), (stand) => {
      if (stand.erledigt === 1) {
        nachElement1.push([...mockVorhanden].some((p) => p.includes('p1.jpg')));
      }
    });
    expect(nachElement1).toEqual([false]);
  });
});
