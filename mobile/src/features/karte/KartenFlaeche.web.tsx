import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type * as Leaflet from 'leaflet';
// Leaflets eigenes Stylesheet MUSS ins Bundle: es positioniert die Kachel-,
// Overlay- und Marker-Ebenen absolut zueinander. Ohne es liegen die Kacheln
// als ungeordneter Bilderstapel übereinander und keine Nadel sitzt auf ihrer
// Koordinate.
//
// Im Testlauf tritt jest.leafletCss.js an seine Stelle (Jest hat keinen
// Transformer für CSS). Der Stub ist nicht bloss leer: er hinterlässt eine
// Spur, an der KartenFlaeche.web.test.tsx festhält, DASS diese Zeile hier
// steht, ohne sie wäre die einzige verbindliche Vorgabe des Briefs, die man
// spurlos löschen kann.
import 'leaflet/dist/leaflet.css';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type ColorTokens } from '@/theme/tokens';
import { aufEinemFleck } from '@/features/karte/gruppierung';
import { nadelAbbild, nadelBeschriftung } from '@/features/karte/nadel';
import type { RecapMoment } from '@/features/recap/types';
import type {
  Ausschnitt,
  Gruppe,
  KartenFlaecheHandle,
  KartenFlaecheProps,
} from '@/features/karte/typen';

// Die Kartenfläche im Browser, derselbe Vertrag wie KartenFlaeche.tsx
// (features/karte/typen.ts), andere Technik: Leaflet auf OpenStreetMap statt
// react-native-maps auf Apple Maps, DOM-Nadeln statt Marker-Views. Metro wählt
// diese Fassung im Web-Bundle und die native sonst; kein Aufrufer weiss davon.
//
// Anders ist wirklich nur die Technik. Gleich bleibt alles Sichtbare: dieselbe
// runde Thumbnail-Nadel mit 2 px weissem Ring (DESIGN-LANGUAGE §4), dieselbe
// `accent`-Linie in Breite 3, dieselbe Zähler-Pille, dasselbe Verhalten beim
// Tippen. Die Kartenkacheln bringen ihre eigenen Farben mit, sie sind Inhalt
// wie ein Foto, nicht Interface (Spec-Entscheid R2); bindend bleibt, was
// DARAUF liegt.
//
// Leaflet ist eine imperative Bibliothek: sie baut ihr eigenes DOM und lässt
// sich nicht deklarativ rendern. React hält deshalb nur die Hülle, alles
// andere hängt an Effekten, die die Karte auf den Stand der Props bringen.

export const KACHEL_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

// Spec K14 und die Lizenz der Kacheln: die Namensnennung ist Pflicht.
//
// Und zwar GENAU diese. Die Attributionsrichtlinie der OpenStreetMap
// Foundation verlangt den Wortlaut «© OpenStreetMap contributors» MIT Link auf
// openstreetmap.org/copyright, «© OpenStreetMap» allein erfüllt sie nicht,
// weder der fehlende Zusatz noch der fehlende Link. Leaflet nimmt HTML und
// blendet den Hinweis NUR ein, wenn `attribution` gesetzt ist; wer ihn
// wegoptimiert oder kürzt, verletzt die Bedingungen, unter denen die Kacheln
// ausgeliefert werden. Festgenagelt in KartenFlaeche.web.test.tsx, samt Link.
export const KACHEL_NAMENSNENNUNG =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// OpenStreetMap liefert Kacheln bis Zoomstufe 19; Leaflets Vorgabe für einen
// TileLayer ist 18. Ohne diese Zeile bliebe die letzte Stufe ungenutzt,
// ausgerechnet die, in der eine Gruppe auf einem Häuserblock auseinanderfällt.
const MAX_ZOOM = 19;

// Die Masse der Nadel, wortgleich zur nativen Fassung (components/KartenNadel.tsx):
// 44 px inklusive Ring wie der grösste Avatar (DESIGN-LANGUAGE §4), Ring 2 px,
// Zähler- und Video-Pille je 20 px.
const GROESSE = 44;
const RING = 2;
const VIDEO_PILLE = 20;
const ZAEHLER = 20;
// Dasselbe Polster wie nativ. Dort ist es Platz für die überstehende
// Zähler-Pille, weil Android ein Marker-View an seinen Rändern abschneidet;
// hier schneidet nichts ab, geblieben ist es, weil es die Trefferfläche der
// Nadel auf 60 px bringt und die Nadel damit auf beiden Plattformen gleich
// leicht zu treffen ist.
const POLSTER = spacing.s;
const KACHEL_MASS = GROESSE + 2 * POLSTER;

// `shadow.s2` aus den Tokens, in CSS übersetzt: Versatz 0/6, Radius 16,
// Schwarz mit 12 % (theme/tokens.ts). Die RN-Form (shadowOffset, shadowOpacity,
// elevation) gibt es im DOM nicht, der Wert ist derselbe.
const SCHATTEN_S2 = '0 6px 16px rgba(0,0,0,0.12)';

// Lucides `Play`, wie ihn die native Nadel trägt: Outline, Stroke 1.75, runde
// Kappen (DESIGN-LANGUAGE §2, Icons NIE gefüllt). Fester Text ohne jede
// Einsetzung; nichts hiervon stammt aus Daten.
const PLAY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${cinema['text-1']}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;

// Stile setzen, aber getippt.
//
// `Object.assign(el.style, { … })` prüft die Namen NICHT: `borderRadus`
// übersetzt sauber und tut nichts. Bei einem Dutzend Stilblöcken wäre das die
// einzige Stelle dieser Datei, an der «strict» nichts abfängt. Ein Parameter
// vom Typ `Partial<CSSStyleDeclaration>` bringt für ein Objektliteral die
// Prüfung auf überzählige Eigenschaften mit, der Tippfehler wird ein
// Übersetzungsfehler.
function stile(element: HTMLElement, werte: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, werte);
}

// Leaflet wird erst beim Aufbau der Karte geladen, nicht beim Laden dieses
// Moduls, und das ist keine Sparmassnahme, sondern die Bedingung dafür, dass
// die App überhaupt fürs Web baut.
//
// `app.json` setzt `web.output: "static"`: expo-router rendert jede Route beim
// Export in NODE vor. Leaflet 1.9 greift auf Modulebene auf `document`,
// `navigator` und `window` zu (dist/leaflet-src.js: `var style =
// document.documentElement.style`, `parseInt(/WebKit\/([0-9]+)|$/.exec(
// navigator.userAgent)…`, zuletzt `window.L = exports`), in beiden Builds,
// UMD wie ESM. Ein Modulebene-Import liess `npx expo export -p web` mit
// «ReferenceError: window is not defined» abbrechen; nachgemessen, nicht
// vermutet.
//
// `require` in einer Funktion statt `await import(…)`: Metros Modulsystem ist
// CommonJS, der Aufruf ist synchron. Ein dynamischer Import machte den
// Aufbau-Effekt asynchron, und damit bräuchte es einen Zustand, der die
// Nadel- und Linien-Effekte danach noch einmal anstösst, plus einen Wächter
// für den Fall, dass der Screen vor dem Auflösen wieder verlassen wird.
// Effekte laufen im Browser, nie in Node: hier zu laden reicht vollkommen.
// Gleiches Muster und gleicher Grund wie `ladeSentry()` in lib/fehlermelder.ts.
//
// Leaflets Stylesheet bleibt oben auf Modulebene: es ist reiner Text, den
// Metro einsammelt, und muss in den <head> der exportierten Seite.
type LeafletModul = typeof import('leaflet');
function ladeLeaflet(): LeafletModul {
  // Genau hier ist `require` die Absicht, nicht die Bequemlichkeit: ein
  // `import` oben lüde das Modul beim Laden dieser Datei, siehe oben.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('leaflet');
}

// Ausschnitt → Leaflet-Grenzen. `Ausschnitt` beschreibt Mitte und Spanne,
// Leaflet rechnet mit Süd-West- und Nord-Ost-Ecke.
function grenzenFuer(L: LeafletModul, a: Ausschnitt): Leaflet.LatLngBounds {
  return L.latLngBounds(
    [a.latitude - a.latitudeDelta / 2, a.longitude - a.longitudeDelta / 2],
    [a.latitude + a.latitudeDelta / 2, a.longitude + a.longitudeDelta / 2]
  );
}

// Und zurück: was die Karte GERADE zeigt.
//
// Leaflet normiert die Längengrade seiner Grenzen nicht auf [-180, 180), wer
// über den 180. Längengrad schiebt, bekommt hier z.B. 190 heraus. Genau
// richtig so: die Differenz Ost minus West bleibt dadurch die wahre Spanne
// (statt 350 statt 10 zu ergeben), und `gruppierung.aufBildschirm` rechnet den
// Versatz ohnehin modulo 360.
function ausschnittVon(karte: Leaflet.Map): Ausschnitt {
  const grenzen = karte.getBounds();
  const mitte = grenzen.getCenter();
  return {
    latitude: mitte.lat,
    longitude: mitte.lng,
    latitudeDelta: grenzen.getNorth() - grenzen.getSouth(),
    longitudeDelta: grenzen.getEast() - grenzen.getWest(),
  };
}

// Eine Kamerafahrt. DESIGN-LANGUAGE §5: mit Reduced Motion wird gesprungen
// statt gefahren, dieselbe Weiche wie nativ (animateToRegion/setRegion).
//
// Über Mitte und Zoom statt über `fitBounds`: `flyTo` fährt so, und beide
// Zweige sollen nachweislich dasselbe Ziel treffen.
function fahre(L: LeafletModul, karte: Leaflet.Map, ziel: Ausschnitt, reduziert: boolean): void {
  const grenzen = grenzenFuer(L, ziel);
  const zoom = karte.getBoundsZoom(grenzen);
  const mitte = grenzen.getCenter();
  if (reduziert) karte.setView(mitte, zoom, { animate: false });
  // Leaflet rechnet Dauern in Sekunden, die Tokens in Millisekunden.
  else karte.flyTo(mitte, zoom, { duration: motion.duration.base / 1000 });
}

// Die Nadel als DOM-Baum statt als HTML-Text.
//
// `L.divIcon` nimmt beides, aber ein Text hiesse, die Bild-URL in ein
// `src="…"` zu kleben. Signierte URLs kommen vom Server, und ein
// Anführungszeichen darin bräche aus dem Attribut aus. Mit `createElement` und
// `setAttribute` stellt sich die Frage gar nicht erst.
function nadelElement(
  moment: RecapMoment,
  thumbUrl: string | null,
  anzahl: number,
  farben: ColorTokens
): HTMLElement {
  const aussen = document.createElement('div');
  stile(aussen, {
    width: `${KACHEL_MASS}px`,
    height: `${KACHEL_MASS}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const rahmen = document.createElement('div');
  stile(rahmen, {
    position: 'relative',
    boxSizing: 'border-box',
    width: `${GROESSE}px`,
    height: `${GROESSE}px`,
    borderRadius: `${radius.pill}px`,
    border: `${RING}px solid ${farben['bg-0']}`,
    // Ohne brauchbare URL bleibt diese ruhige bg-1-Fläche stehen, wie bei
    // einem Avatar ohne Bild. Kein Puls: im Browser lädt das Bild ohne den
    // Umweg über eine Brücke, und ein Skelett für zwei Frames wäre Unruhe
    // ohne Auskunft.
    background: farben['bg-1'],
    boxShadow: SCHATTEN_S2,
  });
  aussen.appendChild(rahmen);

  const beschnitt = document.createElement('div');
  stile(beschnitt, {
    position: 'absolute',
    inset: '0',
    borderRadius: `${radius.pill}px`,
    overflow: 'hidden',
  });
  rahmen.appendChild(beschnitt);

  if (thumbUrl !== null) {
    const bild = document.createElement('img');
    bild.setAttribute('src', thumbUrl);
    // Die Nadel trägt ihre Beschriftung aussen (siehe unten am Element), ein
    // zweiter Text am Bild läse sich per Screenreader doppelt vor.
    bild.setAttribute('alt', '');
    stile(bild, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
    beschnitt.appendChild(bild);
  }

  if (moment.type === 'video') {
    const mitte = document.createElement('div');
    stile(mitte, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    const pille = document.createElement('div');
    stile(pille, {
      width: `${VIDEO_PILLE}px`,
      height: `${VIDEO_PILLE}px`,
      borderRadius: `${radius.pill}px`,
      // Translucente Pille wie nativ (DESIGN-LANGUAGE §1: UI auf einer
      // Fremdfläche liegt ausschliesslich als Pille).
      background: cinema['overlay-pill'],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    pille.innerHTML = PLAY_SVG;
    mitte.appendChild(pille);
    beschnitt.appendChild(mitte);
  }

  // Zähler-Pille der Gruppe (Spec §5.5). Eine Gruppe von einem ist keine
  // Gruppe, sie trägt keine «1».
  if (anzahl > 1) {
    const zaehler = document.createElement('div');
    stile(zaehler, {
      position: 'absolute',
      top: '0',
      right: '0',
      boxSizing: 'border-box',
      minWidth: `${ZAEHLER}px`,
      height: `${ZAEHLER}px`,
      padding: `0 ${spacing.xs}px`,
      borderRadius: `${radius.pill}px`,
      background: farben.accent,
      color: farben['on-accent'],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Figtree_500Medium',
      fontSize: '12px',
      letterSpacing: '0.24px',
      // §2: Zahlen immer tabular-nums, eine «11» soll nicht schmaler sein als
      // eine «44», sonst wackelt die Pille zwischen zwei Zoomstufen.
      fontVariantNumeric: 'tabular-nums',
    });
    zaehler.textContent = String(anzahl);
    rahmen.appendChild(zaehler);
  }

  return aussen;
}

function nadelIcon(
  L: LeafletModul,
  moment: RecapMoment,
  thumbUrl: string | null,
  anzahl: number,
  farben: ColorTokens
): Leaflet.DivIcon {
  return L.divIcon({
    html: nadelElement(moment, thumbUrl, anzahl, farben),
    // Leaflets eigene Klasse bringt einen weissen Kasten mit Rand mit, die
    // Nadel bringt ihr Aussehen selbst mit.
    className: '',
    iconSize: [KACHEL_MASS, KACHEL_MASS],
    // Der Mittelpunkt sitzt auf der Koordinate, nicht die Unterkante: die
    // Nadel ist ein rundes Thumbnail, keine Stecknadel mit Spitze.
    iconAnchor: [KACHEL_MASS / 2, KACHEL_MASS / 2],
  });
}

// Was von einer gesetzten Nadel gemerkt wird: ihr Marker, das Abbild, für das
// ihr Icon gebaut wurde, und die Gruppe, die sie GERADE darstellt.
type Nadel = { marker: Leaflet.Marker; abbild: string; gruppe: Gruppe };

export const KartenFlaeche = forwardRef<KartenFlaecheHandle, KartenFlaecheProps>(
  function KartenFlaeche(
    { initialerAusschnitt, gruppen, linie, thumbFuer, aufGruppe, aufAusschnitt, reducedMotion },
    ref
  ) {
    const { colors } = useTheme();
    const huelle = useRef<HTMLDivElement | null>(null);
    // Das Leaflet-Modul selbst, geladen im Aufbau unten (siehe `ladeLeaflet`).
    // Es steht damit ab demselben Augenblick zur Verfügung wie `karte`, die
    // Effekte darunter prüfen beides gemeinsam.
    const leaflet = useRef<LeafletModul | null>(null);
    const karte = useRef<Leaflet.Map | null>(null);
    const nadeln = useRef(new Map<string, Nadel>());
    const weg = useRef<Leaflet.Polyline | null>(null);

    // Was die Fläche zur Laufzeit vom Aufrufer wissen muss, an EINER Stelle.
    //
    // In einem Ref, weil die Empfänger EINMAL an Leaflet gebunden werden
    // (`map.on`, `marker.on`) und dort dann stehen bleiben. Ohne das meldete
    // ein Klick an die Funktion aus dem Rendern, in dem die Nadel gesetzt
    // wurde, beim Kartenscreen wäre das ein `aufGruppe` mit der Reise-id von
    // damals.
    //
    // Nachgeführt im Effekt und nicht beim Rendern: ein Ref beim Rendern zu
    // beschreiben ist derselbe Verstoss wie es dort zu lesen
    // (react-hooks/refs). Ein Klick kommt frühestens nach dem Commit, der
    // Effekt ist also immer früher dran.
    const jetzt = useRef({ aufAusschnitt, aufGruppe, reducedMotion });
    useEffect(() => {
      jetzt.current = { aufAusschnitt, aufGruppe, reducedMotion };
    }, [aufAusschnitt, aufGruppe, reducedMotion]);

    // Der Ausschnitt, mit dem die Karte ÖFFNET, festgehalten beim ersten
    // Rendern. Der Prop heisst nicht umsonst `initialerAusschnitt`: eine
    // Karte, die ihm bei jeder Änderung nachzöge, führe ihrer eigenen Meldung
    // hinterher.
    const erster = useRef(initialerAusschnitt);

    // Ein `zeige`, das VOR dem Aufbau kam.
    //
    // `useImperativeHandle` ist ein Layout-Effekt, der Aufbau unten ein
    // passiver, dazwischen liegt ein Fenster, in dem das Handle steht, die
    // Karte aber noch nicht. Ein Aufrufer, der aus seinem eigenen
    // `useLayoutEffect` direkt nach dem Mounten fährt (der geteilte Player
    // springt auf den Moment aus dem Link), fiele genau hinein, und der Befehl
    // wäre still verschluckt. Nativ gibt es dieses Fenster nicht: dort steht
    // das MapView-Ref bereits im Commit. Also gemerkt und nachgeholt.
    const offenesZiel = useRef<Ausschnitt | null>(null);

    // Karte aufbauen, genau einmal.
    useEffect(() => {
      const behaelter = huelle.current;
      if (!behaelter) return;
      // Die Sammlung der gesetzten Nadeln, festgehalten für das Aufräumen
      // unten: das Ref selbst erst im Cleanup zu lesen wäre ein Griff auf
      // einen Stand, der bis dahin ein anderer sein kann
      // (react-hooks/exhaustive-deps). Die Map wird nie ausgetauscht, nur
      // gefüllt und geleert, die Variable zeigt also auf dieselbe.
      const gesetzte = nadeln.current;

      const L = ladeLeaflet();
      leaflet.current = L;

      const instanz = L.map(behaelter, {
        // Keine +/−-Knöpfe: sie sind Leaflets eigenes Chrome (weisser Kasten
        // mit Rand) und lägen auf der Kartenfläche, wo DESIGN-LANGUAGE §1 nur
        // translucente Pillen zulässt, ausgerechnet oben links, wo der
        // Rückweg des Screens sitzt. Die native Fassung zeigt dort ebenfalls
        // keine. Gezoomt wird mit Rad, Geste, Doppelklick und Tastatur.
        zoomControl: false,
      });

      // Der Listener hängt VOR der ersten Fahrt, und das ist keine Kosmetik.
      //
      // Leaflet feuert `moveend` synchron aus `_resetView`, auch beim
      // allerersten `setView`. Genau diese Meldung ist die wichtigste von
      // allen: `fitBounds` rastet auf eine GANZE Zoomstufe und zeigt damit
      // regelmässig spürbar mehr als angefordert. Ginge sie verloren,
      // gruppierte der Screen bis zur ersten Bewegung von Hand mit dem
      // ANGEFORDERTEN statt dem SICHTBAREN Delta: `aufBildschirm` rechnete zu
      // viele Bildschirmpunkte pro Grad, und Nadeln, die einander auf dem
      // Schirm verdecken, bekämen keine gemeinsame Gruppe. Nativ korrigiert
      // `onRegionChangeComplete` denselben Unterschied nach dem Layout.
      instanz.on('moveend', () => jetzt.current.aufAusschnitt(ausschnittVon(instanz)));

      instanz.fitBounds(grenzenFuer(L, erster.current), { animate: false });

      L.tileLayer(KACHEL_URL, {
        attribution: KACHEL_NAMENSNENNUNG,
        maxZoom: MAX_ZOOM,
      }).addTo(instanz);

      karte.current = instanz;

      // Nachgeholt, was im Fenster zwischen Handle und Aufbau angefordert
      // wurde (siehe `offenesZiel`). Über denselben Weg wie jede andere Fahrt,
      // damit auch hier die Reduced-Motion-Weiche gilt.
      const nachzuholen = offenesZiel.current;
      offenesZiel.current = null;
      if (nachzuholen) fahre(L, instanz, nachzuholen, jetzt.current.reducedMotion);

      return () => {
        // Ohne `remove()` bleiben Kachel-Anfragen, Resize- und
        // Fenster-Listener hängen, die Karte wäre aus dem Baum, ihre
        // Bildstrecke liefe weiter.
        instanz.remove();
        karte.current = null;
        leaflet.current = null;
        // Die Marker sind mit der Karte weg, die Buchführung darüber muss
        // mit, sonst hielte ein zweiter Aufbau Nadeln für gesetzt, die es
        // nicht mehr gibt.
        gesetzte.clear();
        weg.current = null;
      };
    }, []);

    // Kamerafahrten. Deps leer, das Handle also unveränderlich: was `zeige`
    // gerade tun soll, steht im Ref oben, ein Handle, das bei jeder Änderung
    // von `reducedMotion` neu entsteht, zwänge jeden Aufrufer, es erneut
    // abzugreifen.
    useImperativeHandle(
      ref,
      () => ({
        zeige: (ziel: Ausschnitt) => {
          const instanz = karte.current;
          const L = leaflet.current;
          if (!instanz || !L) {
            offenesZiel.current = ziel;
            return;
          }
          fahre(L, instanz, ziel, jetzt.current.reducedMotion);
        },
      }),
      []
    );

    // Nadeln auf den Stand bringen: was neu ist, kommt dazu, was fehlt, geht
    // weg, und was bleibt, bleibt AUCH ALS DOM stehen.
    //
    // Das ist die Web-Antwort auf `tracksViewChanges` (KartenNadel.tsx): ein
    // bei jeder Kartenbewegung neu gebautes `divIcon` hinge ein neues <img> in
    // den Baum, und die Nadel flackerte beim Schieben, weil das Bild jedes Mal
    // von vorn lädt. Neu gebaut wird deshalb nur, wenn sich das ABBILD
    // geändert hat, Momenttyp, Anzahl, Bild-URL (features/karte/nadel.ts,
    // dieselbe Formel wie nativ).
    useEffect(() => {
      const instanz = karte.current;
      const L = leaflet.current;
      if (!instanz || !L) return;
      const vorhanden = nadeln.current;
      const gesehen = new Set<string>();

      for (const gruppe of gruppen) {
        const anker = gruppe.anker;
        const id = anker.moment.id;
        gesehen.add(id);
        const thumbUrl = thumbFuer(id);
        const anzahl = gruppe.punkte.length;
        const abbild = nadelAbbild(anker.moment, thumbUrl, anzahl);
        const beschriftung = nadelBeschriftung(anker.moment, anzahl, aufEinemFleck(gruppe));

        let nadel = vorhanden.get(id);
        if (!nadel) {
          const marker = L.marker([anker.lat, anker.lng], {
            icon: nadelIcon(L, anker.moment, thumbUrl, anzahl, colors),
            // Nach dem Zusammenfassen ist die Nadel EIN Element, sie muss
            // auch ohne Maus erreichbar sein. Leaflet setzt dafür `tabindex`
            // und löst bei Enter dasselbe `click` aus.
            keyboard: true,
          });
          nadel = { marker, abbild, gruppe };
          const eintrag = nadel;
          // Über den Eintrag, nicht über `gruppe`: der Marker bleibt beim
          // Zoomen stehen, seine Gruppe wechselt darunter laufend. Eine
          // Closure auf die Gruppe von damals meldete später eine, die es
          // nicht mehr gibt.
          marker.on('click', () => jetzt.current.aufGruppe(eintrag.gruppe));
          marker.addTo(instanz);
          vorhanden.set(id, nadel);
        } else {
          nadel.gruppe = gruppe;
          if (nadel.abbild !== abbild) {
            nadel.marker.setIcon(nadelIcon(L, anker.moment, thumbUrl, anzahl, colors));
            nadel.abbild = abbild;
          }
        }

        // Die Beschriftung hängt am Element, nicht am Icon: sie kann sich
        // ändern, ohne dass sich das Abbild ändert (eine Gruppe gleicher
        // Grösse, die plötzlich auf einem Fleck liegt, sagt «ansehen» statt
        // «heranzoomen»). Am Icon festgemacht bliebe sie in genau dem Fall
        // stehen, und das Label verspräche etwas, was der Klick nicht tut.
        const element = nadel.marker.getElement();
        if (element) {
          element.setAttribute('role', 'button');
          element.setAttribute('aria-label', beschriftung);
        }
      }

      for (const [id, nadel] of vorhanden) {
        if (gesehen.has(id)) continue;
        nadel.marker.remove();
        vorhanden.delete(id);
      }
    }, [gruppen, thumbFuer, colors]);

    // Die Reise als Linie (Spec K3/§5.6). Sie liegt in Leaflets `overlayPane`
    // und damit von selbst UNTER den Nadeln (`markerPane`), die native
    // Fassung erreicht dasselbe über die Reihenfolge im Baum. Unter zwei
    // Punkten gibt es nichts zu verbinden.
    useEffect(() => {
      const instanz = karte.current;
      const L = leaflet.current;
      if (!instanz || !L) return;
      const punkte: Leaflet.LatLngExpression[] = linie.map((p) => [p.latitude, p.longitude]);

      if (punkte.length < 2) {
        weg.current?.remove();
        weg.current = null;
        return;
      }
      if (weg.current) {
        weg.current.setLatLngs(punkte);
        weg.current.setStyle({ color: colors.accent });
        return;
      }
      weg.current = L.polyline(punkte, { color: colors.accent, weight: 3 }).addTo(instanz);
    }, [linie, colors]);

    // Die Hülle füllt den Screen, wie `StyleSheet.absoluteFill` nativ. Leaflet
    // schreibt sein eigenes DOM hinein, React fasst sie nach dem Mounten
    // nicht mehr an.
    return (
      <div
        ref={huelle}
        data-testid="karte-flaeche"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
    );
  }
);
