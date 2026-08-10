/**
 * @jest-environment jsdom
 */
import { act, createRef, useLayoutEffect, type Ref, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import L from 'leaflet';
import { motion, palette } from '@/theme/tokens';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Ausschnitt,
  Gruppe,
  KartenFlaecheHandle,
  KartenFlaecheProps,
  KartenPunkt,
} from '@/features/karte/typen';
import { KACHEL_NAMENSNENNUNG, KACHEL_URL, KartenFlaeche } from '../KartenFlaeche.web';

// Die Browser-Fassung, gegen ECHTES Leaflet in jsdom, nicht gegen einen Mock.
// Der Grund steht am ersten Test: dass aus einer Option ein sichtbarer
// Lizenzhinweis wird, entscheidet Leaflet. Ein Mock beglaubigte den Aufruf und
// liesse trotzdem eine Karte ohne Namensnennung durchgehen.
//
// Gerendert wird mit `react-dom` statt mit @testing-library/react-native: diese
// Fassung baut echtes DOM (das darf sie, im Browser rendert React Native Web
// ohnehin dorthin), und Leaflet braucht einen Container, an den es sich hängen
// kann. Die native Fassung und der Vertrag, den beide erfüllen, stehen in
// KartenFlaeche.test.tsx.

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'p1', trip_id: 't1', author_id: 'u1', type: 'photo', duration_s: null, caption: null,
    captured_at: '2026-08-10T09:00:00.000Z', captured_tz: 'Europe/Lisbon', place_name: 'Lissabon',
    lat: 38.71, lng: -9.14, upload_status: 'uploaded', autor_name: 'Lea',
    ...overrides,
  };
}

function punkt(id: string, lat: number, lng: number, index: number): KartenPunkt {
  return { moment: moment({ id, lat, lng }), lat, lng, index };
}

const pA = punkt('p1', 38.71, -9.14, 0);
const pB = punkt('p2', 38.72, -9.13, 1);
const gruppeA: Gruppe = { anker: pA, punkte: [pA] };
const gruppeB: Gruppe = { anker: pB, punkte: [pB] };
const auseinander: Gruppe = { anker: pA, punkte: [pA, pB] };

const AUSSCHNITT: Ausschnitt = {
  latitude: 38.715, longitude: -9.135, latitudeDelta: 0.02, longitudeDelta: 0.02,
};
const ZIEL: Ausschnitt = {
  latitude: 38.71, longitude: -9.14, latitudeDelta: 0.004, longitudeDelta: 0.004,
};

const basis: KartenFlaecheProps = {
  initialerAusschnitt: AUSSCHNITT,
  gruppen: [],
  linie: [],
  thumbFuer: () => null,
  aufGruppe: () => {},
  // Die Flaeche rechnet nicht mehr selbst, ob ein Tipp das Sheet oeffnet, sie
  // fragt (features/karte/typen.ts). `false` ist der Normalfall: eine Gruppe,
  // in die man noch hineinfahren kann.
  oeffnetSheet: () => false,
  aufAusschnitt: () => {},
  reducedMotion: false,
};

const BREITE = 800;
const HOEHE = 600;

beforeAll(() => {
  // jsdom misst jedes Element mit 0 × 0. Leaflet liest die Grösse seines
  // Containers über `clientWidth`/`clientHeight`, ohne diese beiden Zeilen
  // wäre jeder Ausschnitt leer und `getBoundsZoom` liefe gegen unendlich.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: BREITE });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: HOEHE });
  // jsdom kennt `SVGSVGElement.createSVGRect` nicht, und genau daran erkennt
  // Leaflet beim Laden, ob SVG zur Verfügung steht (`Browser.svg`). Ohne diese
  // Zeile fiele es auf einen Renderer zurück, den es in einem echten Browser
  // nie nähme, und die Linie wäre gar kein Element mehr, sondern ein Strich
  // auf einem Canvas. Der Schalter stellt her, was jeder Browser mitbringt.
  (L.Browser as { svg: boolean }).svg = true;
});

let wurzel: Root | null = null;
let behaelter: HTMLDivElement | null = null;
let kartenSpion: jest.SpyInstance<L.Map, Parameters<typeof L.map>>;

// Die Leaflet-Instanz, die die Komponente erzeugt hat. Sie gibt sie nach aussen
// nicht heraus (sie ist ein Detail ihrer Technik), für den Test ist sie der
// einzige Weg, eine echte Kartenbewegung auszulösen statt eine nachzuspielen.
function karteInstanz(): L.Map {
  const ergebnis = kartenSpion.mock.results[0];
  if (!ergebnis || ergebnis.type !== 'return') throw new Error('keine Karte erzeugt');
  return ergebnis.value;
}

async function zeichne(
  props: Partial<KartenFlaecheProps> = {},
  ref?: Ref<KartenFlaecheHandle>
): Promise<HTMLDivElement> {
  behaelter = document.createElement('div');
  document.body.appendChild(behaelter);
  wurzel = createRoot(behaelter);
  await act(async () => {
    wurzel?.render(<KartenFlaeche ref={ref} {...basis} {...props} />);
  });
  return behaelter;
}

async function neuZeichnen(props: Partial<KartenFlaecheProps>, ref?: Ref<KartenFlaecheHandle>) {
  await act(async () => {
    wurzel?.render(<KartenFlaeche ref={ref} {...basis} {...props} />);
  });
}

async function abbauen() {
  const alte = wurzel;
  wurzel = null;
  await act(async () => {
    alte?.unmount();
  });
}

function nadeln(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.leaflet-marker-icon'));
}

function linienPfad(host: HTMLElement): SVGPathElement | null {
  return host.querySelector<SVGPathElement>('.leaflet-overlay-pane path');
}

// Das Bild AUS DER NADEL, nicht das erste `img` im Container: Leaflets
// Kacheln sind ebenfalls `img`, und die stehen im Baum vor den Nadeln.
function nadelBild(host: HTMLElement, stelle = 0): HTMLImageElement | null {
  return nadeln(host)[stelle]?.querySelector('img') ?? null;
}

beforeEach(() => {
  // Ohne mockImplementation: der Spion ruft die echte Fabrik und merkt sich
  // nur, was sie zurückgegeben hat.
  kartenSpion = jest.spyOn(L, 'map');
});

afterEach(async () => {
  if (wurzel) await abbauen();
  behaelter?.remove();
  behaelter = null;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Die Namensnennung, Spec K14 und die Lizenz der Kacheln
// ---------------------------------------------------------------------------

// DER Test dieser Datei. Die Kacheln von OpenStreetMap dürfen nur mit
// Namensnennung benutzt werden, und Leaflet blendet den Hinweis NUR ein, wenn
// `attribution` gesetzt ist. Wer den Wert wegoptimiert, bricht nichts, was
// auffiele, die Karte sähe genau gleich aus, nur ohne Lizenzhinweis, und der
// Bruch stünde erst in einer Abmahnung.
//
// Geprüft am gerenderten DOM, nicht am übergebenen Wert: dass aus der Option
// ein sichtbarer Hinweis wird, entscheidet Leaflet.
test('die Karte nennt OpenStreetMap sichtbar', async () => {
  const host = await zeichne();
  expect(host.querySelector('.leaflet-control-attribution')?.textContent).toContain(
    'OpenStreetMap'
  );
});

// Und zwar so, wie die Attributionsrichtlinie der OpenStreetMap Foundation es
// verlangt: der Wortlaut «© OpenStreetMap contributors» MIT Link auf
// openstreetmap.org/copyright. «© OpenStreetMap» allein erfüllt sie nicht,
// weder der fehlende Zusatz noch der fehlende Link. K14 verspricht die
// Lizenzerfüllung, nicht einen Zeichenstring.
test('die Namensnennung erfuellt die Bedingungen der Lizenz', async () => {
  const host = await zeichne();
  const hinweis = host.querySelector('.leaflet-control-attribution');
  expect(hinweis?.textContent).toContain('© OpenStreetMap contributors');
  const link = hinweis?.querySelector<HTMLAnchorElement>(
    'a[href="https://www.openstreetmap.org/copyright"]'
  );
  expect(link).not.toBeNull();
  expect(link?.textContent).toBe('OpenStreetMap');
});

test('die Kacheln kommen von OpenStreetMap', async () => {
  const kacheln = jest.spyOn(L, 'tileLayer');
  await zeichne();
  expect(kacheln).toHaveBeenCalledTimes(1);
  expect(kacheln.mock.calls[0][0]).toBe(KACHEL_URL);
  expect(KACHEL_URL).toContain('tile.openstreetmap.org');
  expect(kacheln.mock.calls[0][1]?.attribution).toBe(KACHEL_NAMENSNENNUNG);
});

// Leaflets eigenes Stylesheet MUSS ins Bundle, ohne es liegen die Kacheln als
// ungeordneter Bilderstapel übereinander und keine Nadel sitzt auf ihrer
// Koordinate. Das ist die einzige verbindliche Vorgabe dieser Fassung, deren
// Ausfall sich in keinem Test zeigt: `moduleNameMapper` ersetzt die Datei, und
// ein leerer Ersatz macht das Fehlen des Imports unsichtbar.
//
// Der Ersatz (jest.leafletCss.js) hinterlässt deshalb eine Spur. Sie steht
// genau dann, wenn `import 'leaflet/dist/leaflet.css'` in der Fassung steht,
// diese Testdatei importiert die Fassung oben und sonst nichts, was das
// Stylesheet zöge.
test('Leaflets Stylesheet ist im Bundle', () => {
  const spur = (globalThis as { __leafletCssImportiert?: boolean }).__leafletCssImportiert;
  expect(spur).toBe(true);
});

// ---------------------------------------------------------------------------
// Der Ausschnitt, mit dem sie öffnet, und der, den sie meldet
// ---------------------------------------------------------------------------

test('oeffnet mit dem uebergebenen Ausschnitt', async () => {
  await zeichne({ gruppen: [gruppeA] });
  const karte = karteInstanz();
  expect(karte.getCenter().lat).toBeCloseTo(AUSSCHNITT.latitude, 3);
  expect(karte.getCenter().lng).toBeCloseTo(AUSSCHNITT.longitude, 3);
  // Der ganze verlangte Ausschnitt muss zu sehen sein, sonst läge ein Moment
  // ausserhalb des Bildes, obwohl die Karte für ihn geöffnet wurde.
  expect(
    karte.getBounds().contains(
      L.latLngBounds(
        [AUSSCHNITT.latitude - AUSSCHNITT.latitudeDelta / 2, AUSSCHNITT.longitude - AUSSCHNITT.longitudeDelta / 2],
        [AUSSCHNITT.latitude + AUSSCHNITT.latitudeDelta / 2, AUSSCHNITT.longitude + AUSSCHNITT.longitudeDelta / 2]
      )
    )
  ).toBe(true);
});

// Der ERSTE Ausschnitt muss auch gemeldet werden, nicht erst der zweite.
//
// `fitBounds` rastet auf eine ganze Zoomstufe und zeigt damit regelmässig
// spürbar mehr als angefordert. Bleibt diese eine Meldung aus, gruppiert der
// Screen bis zur ersten Bewegung von Hand mit dem ANGEFORDERTEN statt dem
// SICHTBAREN Delta, `aufBildschirm` rechnet zu viele Bildschirmpunkte pro
// Grad, und Nadeln, die einander auf dem Schirm verdecken, bekommen keine
// gemeinsame Gruppe. Nativ korrigiert `onRegionChangeComplete` denselben
// Unterschied nach dem Layout.
//
// Leaflet feuert `moveend` synchron aus dem ersten `setView`, die Meldung
// geht nur dann verloren, wenn der Listener erst NACH `fitBounds` hängt. Genau
// deshalb steht hier kein `mockClear()` vor der Zusicherung.
test('meldet schon den Ausschnitt, mit dem sie oeffnet', async () => {
  const aufAusschnitt = jest.fn<void, [Ausschnitt]>();
  await zeichne({ gruppen: [gruppeA], aufAusschnitt });

  expect(aufAusschnitt).toHaveBeenCalled();
  const gemeldet = aufAusschnitt.mock.calls[0][0];
  const grenzen = karteInstanz().getBounds();
  expect(gemeldet.latitudeDelta).toBeCloseTo(grenzen.getNorth() - grenzen.getSouth(), 9);
  expect(gemeldet.longitudeDelta).toBeCloseTo(grenzen.getEast() - grenzen.getWest(), 9);
});

// Und die Gegenprobe, die zeigt, warum die Meldung oben nötig ist: `fitBounds`
// zeigt tatsächlich mehr als angefordert. Ohne diesen Unterschied wäre der
// Test darüber eine Behauptung ohne Gegenstand.
test('der sichtbare Ausschnitt ist weiter als der angeforderte', async () => {
  await zeichne({ gruppen: [gruppeA] });
  const grenzen = karteInstanz().getBounds();
  expect(grenzen.getNorth() - grenzen.getSouth()).toBeGreaterThan(AUSSCHNITT.latitudeDelta);
});

// `moveend` ist Leaflets `onRegionChangeComplete`: die Karte steht still und
// zeigt DAS hier. Ohne diese Meldung gruppierte der Screen für immer nach dem
// Zoom, mit dem die Karte geöffnet wurde, eine Gruppe fiele durch kein
// Hineinzoomen mehr auseinander.
test('meldet den Ausschnitt, sobald die Karte stillsteht', async () => {
  const aufAusschnitt = jest.fn<void, [Ausschnitt]>();
  await zeichne({ gruppen: [gruppeA], aufAusschnitt });
  const bisher = aufAusschnitt.mock.calls.length;

  const karte = karteInstanz();
  await act(async () => {
    karte.setZoom(karte.getZoom() + 2, { animate: false });
  });

  expect(aufAusschnitt.mock.calls.length).toBeGreaterThan(bisher);
});

// Und die Meldung beschreibt, was WIRKLICH zu sehen ist: Mitte und Spannen
// kommen aus der Karte selbst. Der Screen misst damit Abstände in
// Bildschirmpunkten, eine Spanne, die nicht stimmt, gruppiert falsch.
test('die Meldung beschreibt genau den Ausschnitt der Karte', async () => {
  const aufAusschnitt = jest.fn<void, [Ausschnitt]>();
  await zeichne({ gruppen: [gruppeA], aufAusschnitt });
  const karte = karteInstanz();
  await act(async () => {
    karte.setZoom(karte.getZoom() + 2, { animate: false });
  });

  const gemeldet = aufAusschnitt.mock.calls.at(-1)?.[0];
  const grenzen = karte.getBounds();
  expect(gemeldet?.latitude).toBeCloseTo(grenzen.getCenter().lat, 9);
  expect(gemeldet?.longitude).toBeCloseTo(grenzen.getCenter().lng, 9);
  expect(gemeldet?.latitudeDelta).toBeCloseTo(grenzen.getNorth() - grenzen.getSouth(), 9);
  expect(gemeldet?.longitudeDelta).toBeCloseTo(grenzen.getEast() - grenzen.getWest(), 9);
});

// ---------------------------------------------------------------------------
// Nadeln
// ---------------------------------------------------------------------------

test('setzt eine Nadel je Gruppe', async () => {
  const host = await zeichne({ gruppen: [gruppeA, gruppeB] });
  expect(nadeln(host)).toHaveLength(2);
});

test('eine weggefallene Gruppe nimmt ihre Nadel mit', async () => {
  const host = await zeichne({ gruppen: [gruppeA, gruppeB] });
  await neuZeichnen({ gruppen: [gruppeA] });
  expect(nadeln(host)).toHaveLength(1);
});

test('die Nadel traegt das Bild ihres Ankers', async () => {
  const host = await zeichne({
    gruppen: [auseinander],
    thumbFuer: (postId) => `https://cdn.example/${postId}.jpg`,
  });
  expect(nadelBild(host)?.getAttribute('src')).toBe('https://cdn.example/p1.jpg');
});

test('die Nadel einer Gruppe zeigt deren Anzahl', async () => {
  const host = await zeichne({ gruppen: [auseinander] });
  expect(nadeln(host)[0].textContent).toContain('2');
});

// Eine Gruppe von einem ist keine Gruppe, sie trägt keine «1».
test('eine einzelne Nadel zeigt keine Zahl', async () => {
  const host = await zeichne({ gruppen: [gruppeA] });
  expect(nadeln(host)[0].textContent).toBe('');
});

// Nach dem Zusammenfassen ist die Nadel EIN Element. Was ein Klick auslöst,
// steht nur im Label, und zwar in derselben Formulierung wie nativ
// (features/karte/nadel.ts), damit beide Plattformen dasselbe versprechen.
test('die Nadel sagt, was ein Klick auf sie tut', async () => {
  const host = await zeichne({ gruppen: [auseinander] });
  expect(nadeln(host)[0].getAttribute('aria-label')).toBe('Auf 2 Momente heranzoomen');
  expect(nadeln(host)[0].getAttribute('role')).toBe('button');
});

// Wie nativ: die Fläche rechnet die Weiche nicht selbst, sie fragt den Screen.
// Sie kannte bis zur Zusammenführung nur den halben Grund (`aufEinemFleck`)
// und versprach an einer festgefahrenen Gruppe weiter einen Zoom, den kein
// Klick mehr einlöst. Die Gruppe hier hat ausdrücklich zwei verschiedene
// Koordinaten: was zählt, ist allein die Antwort.
test('die Flaeche rechnet die Antwort nicht selbst, sie fragt', async () => {
  const host = await zeichne({ gruppen: [auseinander], oeffnetSheet: () => true });
  expect(nadeln(host)[0].getAttribute('aria-label')).toBe('2 Momente an diesem Ort ansehen');
});

test('gefragt wird mit der GANZEN Gruppe, nicht mit ihrem Anker', async () => {
  const oeffnetSheet = jest.fn(() => false);
  await zeichne({ gruppen: [auseinander], oeffnetSheet });
  expect(oeffnetSheet).toHaveBeenCalledWith(auseinander);
});

test('meldet den Klick auf eine Gruppe nach oben', async () => {
  const aufGruppe = jest.fn();
  const host = await zeichne({ gruppen: [gruppeA, gruppeB], aufGruppe });
  await act(async () => {
    nadeln(host)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(aufGruppe).toHaveBeenCalledTimes(1);
  expect(aufGruppe).toHaveBeenCalledWith(gruppeB);
});

// Der Klick meldet die Gruppe von JETZT, nicht die von damals: die Nadel bleibt
// beim Zoomen stehen, ihre Gruppe wechselt darunter laufend. Eine Closure auf
// die Gruppe aus dem Rendern, in dem die Nadel gesetzt wurde, meldete später
// eine, die es nicht mehr gibt, und das Sheet zeigte Momente, die längst eine
// eigene Nadel haben.
test('der Klick meldet die aktuelle Gruppe, nicht die von damals', async () => {
  const aufGruppe = jest.fn();
  const host = await zeichne({ gruppen: [auseinander], aufGruppe });
  await neuZeichnen({ gruppen: [gruppeA], aufGruppe });

  await act(async () => {
    nadeln(host)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(aufGruppe).toHaveBeenCalledWith(gruppeA);
});

// Das Gegenstück zu `tracksViewChanges` nativ: eine Nadel, deren Aussehen
// unverändert ist, bleibt als DOM stehen. Neu gebaut lüde ihr Bild bei jeder
// Kartenbewegung erneut, und die Nadel flackerte beim Schieben.
test('unveraenderte Nadeln werden beim Neuzeichnen nicht neu gebaut', async () => {
  const thumbFuer = (postId: string) => `https://cdn.example/${postId}.jpg`;
  const host = await zeichne({ gruppen: [gruppeA], thumbFuer });
  const vorher = nadelBild(host);
  expect(vorher).not.toBeNull();

  // Ein neues Array mit demselben Inhalt: genau das, was jede Kartenbewegung
  // erzeugt (der Screen gruppiert bei jedem gemeldeten Ausschnitt neu).
  await neuZeichnen({ gruppen: [{ ...gruppeA }], thumbFuer });
  expect(nadelBild(host)).toBe(vorher);
});

// Und die Gegenprobe, ohne die das Stehenlassen oben zur Falle würde: ändert
// sich das Aussehen, MUSS die Nadel neu gebaut werden, sonst bliebe eine
// Gruppe mit ihrer alten Zahl stehen, nachdem sie gewachsen ist.
test('ein geaendertes Aussehen baut die Nadel neu', async () => {
  const host = await zeichne({ gruppen: [gruppeA] });
  const vorher = nadeln(host)[0].firstElementChild;
  await neuZeichnen({ gruppen: [auseinander] });

  expect(nadeln(host)[0].firstElementChild).not.toBe(vorher);
  expect(nadeln(host)[0].textContent).toContain('2');
});

// ---------------------------------------------------------------------------
// Die Kamera
// ---------------------------------------------------------------------------

test('zeige() faehrt die Karte auf das Ziel', async () => {
  const flug = jest.spyOn(L.Map.prototype, 'flyTo');
  const handle = createRef<KartenFlaecheHandle>();
  await zeichne({ gruppen: [gruppeA] }, handle);

  await act(async () => {
    handle.current?.zeige(ZIEL);
  });

  expect(flug).toHaveBeenCalledTimes(1);
  const [mitte, , optionen] = flug.mock.calls[0];
  expect(L.latLng(mitte).lat).toBeCloseTo(ZIEL.latitude, 6);
  expect(L.latLng(mitte).lng).toBeCloseTo(ZIEL.longitude, 6);
  // Leaflet rechnet Dauern in Sekunden, die Tokens in Millisekunden.
  expect(optionen?.duration).toBe(motion.duration.base / 1000);
});

// Die Fahrt geht HINEIN: das Ziel ist enger als der Ausschnitt, aus dem heraus
// getippt wurde, also muss die Zoomstufe steigen. Eine Fahrt, die dabei
// hinauszoomt, wäre das Gegenteil dessen, was ein Tipp auf eine Gruppe soll.
test('zeige() zoomt auf ein engeres Ziel hinein', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await zeichne({ gruppen: [gruppeA], reducedMotion: true }, handle);
  const karte = karteInstanz();
  const vorher = karte.getZoom();

  await act(async () => {
    handle.current?.zeige(ZIEL);
  });
  expect(karte.getZoom()).toBeGreaterThan(vorher);
});

// DESIGN-LANGUAGE §5 / Spec K12: mit Reduced Motion wird gesprungen statt
// gefahren, dieselbe Weiche wie in der nativen Fassung.
test('mit Reduced Motion springt zeige(), statt zu fahren', async () => {
  const flug = jest.spyOn(L.Map.prototype, 'flyTo');
  const sprung = jest.spyOn(L.Map.prototype, 'setView');
  const handle = createRef<KartenFlaecheHandle>();
  await zeichne({ gruppen: [gruppeA], reducedMotion: true }, handle);
  sprung.mockClear();

  await act(async () => {
    handle.current?.zeige(ZIEL);
  });

  expect(flug).not.toHaveBeenCalled();
  expect(sprung).toHaveBeenCalledTimes(1);
  expect(sprung.mock.calls[0][2]?.animate).toBe(false);
});

// Ein `zeige` aus dem Layout-Effekt des Aufrufers, unmittelbar nach dem
// Mounten. Genau so wird der geteilte Player (Task 15) die Fläche benutzen: er
// springt beim Öffnen auf den Moment aus dem Link, ohne auf eine Nutzeraktion
// zu warten.
//
// `useImperativeHandle` ist ein Layout-Effekt, der Kartenaufbau hier ein
// passiver, dazwischen steht das Handle, aber noch keine Karte. Ohne
// Vorkehrung wäre der Befehl STILL verschluckt, und zwar nur im Browser: nativ
// ist das MapView-Ref bereits im Commit gesetzt. Dieselbe Zusicherung steht
// deshalb wortgleich in KartenFlaeche.test.tsx.
function FruehesZiel({ handle }: { handle: RefObject<KartenFlaecheHandle | null> }) {
  useLayoutEffect(() => {
    handle.current?.zeige(ZIEL);
  }, [handle]);
  return null;
}

test('ein zeige() aus dem Layout-Effekt des Aufrufers geht nicht verloren', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  behaelter = document.createElement('div');
  document.body.appendChild(behaelter);
  wurzel = createRoot(behaelter);
  await act(async () => {
    wurzel?.render(
      <>
        <KartenFlaeche {...basis} gruppen={[gruppeA]} reducedMotion ref={handle} />
        <FruehesZiel handle={handle} />
      </>
    );
  });

  const mitte = karteInstanz().getCenter();
  expect(mitte.lat).toBeCloseTo(ZIEL.latitude, 6);
  expect(mitte.lng).toBeCloseTo(ZIEL.longitude, 6);
});

// «Springt» allein ist keine Zusicherung: ein Sprung auf 0/0 wäre auch einer.
test('der Sprung trifft dasselbe Ziel wie die Fahrt', async () => {
  const handle = createRef<KartenFlaecheHandle>();
  await zeichne({ gruppen: [gruppeA], reducedMotion: true }, handle);

  await act(async () => {
    handle.current?.zeige(ZIEL);
  });
  const mitte = karteInstanz().getCenter();
  expect(mitte.lat).toBeCloseTo(ZIEL.latitude, 6);
  expect(mitte.lng).toBeCloseTo(ZIEL.longitude, 6);
});

// ---------------------------------------------------------------------------
// Die Linie
// ---------------------------------------------------------------------------

const LINIE = [
  { latitude: 38.71, longitude: -9.14 },
  { latitude: 38.72, longitude: -9.13 },
];

test('die Linie ist der Akzent in Breite 3', async () => {
  const host = await zeichne({ linie: LINIE });
  expect(linienPfad(host)?.getAttribute('stroke')).toBe(palette.accent);
  expect(linienPfad(host)?.getAttribute('stroke-width')).toBe('3');
});

// Eine Linie braucht zwei Punkte, sonst stünde ein Overlay auf der Karte, das
// nichts verbindet.
test('ein einzelner Punkt ergibt keine Linie', async () => {
  const host = await zeichne({ linie: [LINIE[0]] });
  expect(linienPfad(host)).toBeNull();
});

// Der Tagesfilter kann die Linie auf einen einzigen Punkt zusammenschrumpfen
// lassen, dann muss sie verschwinden, nicht als Rest stehen bleiben.
test('schrumpft die Linie auf einen Punkt, verschwindet sie', async () => {
  const host = await zeichne({ linie: LINIE });
  expect(linienPfad(host)).not.toBeNull();
  await neuZeichnen({ linie: [LINIE[0]] });
  expect(linienPfad(host)).toBeNull();
});

// Und sie bekommt kein zweites Element, wenn sie sich ändert, aus demselben
// Grund wie die Nadeln oben.
test('eine geaenderte Linie bekommt kein zweites Element', async () => {
  const host = await zeichne({ linie: LINIE });
  const vorher = linienPfad(host);

  await neuZeichnen({ linie: [...LINIE, { latitude: 38.75, longitude: -9.1 }] });
  expect(linienPfad(host)).toBe(vorher);
  expect(host.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Aufräumen
// ---------------------------------------------------------------------------

// Ohne `map.remove()` bleiben Kachel-Anfragen und Fenster-Listener hängen: die
// Karte wäre aus dem Baum, ihre Bildstrecke liefe weiter. Auf einem Screen, den
// man betritt und verlässt, sammelt sich das an.
test('beim Abbauen raeumt die Karte sich auf', async () => {
  const aufraeumen = jest.spyOn(L.Map.prototype, 'remove');
  const host = await zeichne({ gruppen: [gruppeA] });
  expect(nadeln(host)).toHaveLength(1);

  await abbauen();
  expect(aufraeumen).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.leaflet-marker-icon')).toBeNull();
});
