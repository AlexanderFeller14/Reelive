import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { KartenNadelMarker } from '@/components/KartenNadel';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { meldeFehler } from '@/lib/fehlermelder';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { RecapMoment, RecapTag } from '@/features/recap/types';
import { zeitInZone } from '@/features/recap/uhrzeit';
import { holeVorrat, type MedienUrl } from '@/features/recap/urlVorrat';
import { fetchTrip } from '@/features/trips/tripsApi';
import { ausschnittFuer } from '@/features/karte/ausschnitt';
import { aufEinemFleck, gruppiere } from '@/features/karte/gruppierung';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import type { Ausschnitt, Gruppe, KartenPunkt } from '@/features/karte/typen';

// Eine feste leere Map statt `new Map()` bei jedem Zurücksetzen: der Wert geht
// als Abhängigkeit in die Nadeln, und eine jedes Mal neue Map liesse sie ohne
// Grund neu rechnen.
const KEINE_URLS: ReadonlyMap<string, MedienUrl> = new Map();

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms» — die Zeilen der Gruppenliste
// erscheinen nacheinander, nicht als Block.
const STAGGER_MS = 40;
// §5: «prefers-reduced-motion: alles wird zu 200-ms-Fades». Derselbe Wert wie
// in Sheet.tsx (dort modulprivat).
const REDUZIERTE_DAUER_MS = 200;

// Eine URL, mit der sich tatsächlich ein Bild laden lässt — oder `null`.
//
// `MedienUrl.medium_url` ist als `string` typisiert, wird in urlVorrat.ts aber
// ungeprüft aus der Antwort der Function übernommen. Fehlt das Feld dort (App
// und Function werden getrennt ausgerollt — derselbe Grund, aus dem `ausgelassen`
// weich gelesen wird), lügt der Typ, und ohne diese Prüfung ginge ein
// `undefined` als Bildquelle an die Nadel.
function brauchbareUrl(wert: string | null | undefined): string | null {
  return typeof wert === 'string' && wert.length > 0 ? wert : null;
}

// Das Bild der Nadel. `thumb_url` fehlt, wenn `media-urls` für den Moment
// keinen `thumb_key` hatte (siehe supabase/functions/media-urls/index.ts) —
// dann trägt das mittlere Bild die Nadel, genau wie in uebersicht.tsx. Ohne
// diesen Ausweg bliebe für solche Momente für immer der Skeleton stehen.
function nadelBild(urls: ReadonlyMap<string, MedienUrl>, momentId: string): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return brauchbareUrl(url.thumb_url) ?? brauchbareUrl(url.medium_url);
}

// Das Bild IM SHEET ist gross (3:2, Spec §5.7) — dafür ist das mittlere Bild
// gedacht, nicht das 44 Punkte breite Nadel-Thumbnail. Die Reihenfolge ist
// deshalb genau umgekehrt zu `nadelBild`; der Ausweg auf die jeweils andere
// URL bleibt aus demselben Grund wie dort: `media-urls` lässt je nach Moment
// die eine oder die andere weg.
function sheetBild(urls: ReadonlyMap<string, MedienUrl>, momentId: string): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return brauchbareUrl(url.medium_url) ?? brauchbareUrl(url.thumb_url);
}

// Wie viel Fensterhöhe der scrollende Teil eines Sheets höchstens einnimmt.
//
// Ohne eine Obergrenze wäre die ScrollView wirkungslos: sie wüchse mit ihrem
// Inhalt, und `Sheet` schnitte den Überhang hart ab (Sheet.tsx: `maxHeight`
// 85 % plus `overflow: 'hidden'`). Genau so verschwänden ab dem siebten
// Moment auf einem Fleck die letzten Einträge — und die sind auf keinem
// anderen Weg erreichbar, denn Zoomen hilft dort per Definition nicht. Der
// Ausweg aus der Sackgasse wäre selbst eine.
//
// Die Hälfte lässt unter der 85-%-Grenze des Sheets genug für Griff, Titel,
// den angehefteten Knopf und das Fusspolster — auch auf dem kleinsten Gerät
// (667 pt: 334 + 44 + 16 + 52 + 32 = 478 von 567 möglichen). Exportiert,
// damit karte.test.tsx denselben Anteil prüft, statt eine zweite Zahl zu
// raten (gleiches Vorgehen wie MAX_HOEHE_ANTEIL in Sheet.tsx).
export const SHEET_SCROLL_ANTEIL = 0.5;

// Der scrollende Bereich eines Sheets. Beide Sheets dieses Screens benutzen
// ihn: die Liste einer Gruppe, weil sie beliebig lang werden kann, und der
// einzelne Moment, weil Bild (3:2), Ort und Caption bei grosser Systemschrift
// zusammen höher werden als das Sheet — dort bliebe sonst ausgerechnet der
// Primär-Button unerreichbar. Er steht deshalb AUSSERHALB dieses Bereichs
// und bleibt stehen, während der Inhalt darüber scrollt.
function SheetScroll({ testID, children }: { testID: string; children: ReactNode }) {
  const { height: fensterHoehe } = useWindowDimensions();
  return (
    <ScrollView
      testID={testID}
      style={{ maxHeight: fensterHoehe * SHEET_SCROLL_ANTEIL }}
      // Den Abstand zwischen den Kindern hielt vorher `Sheet` selbst
      // (styles.inhalt, `gap`) — innerhalb der ScrollView gilt er nicht mehr,
      // also steht er hier, mit demselben Wert.
      contentContainerStyle={styles.scrollInhalt}
    >
      {children}
    </ScrollView>
  );
}

// «Mira · 14:32» (Spec §5.7). Die Uhrzeit läuft über dieselbe Formatierung wie
// im Player und an der Nadel (features/recap/uhrzeit.ts): sie zeigt die Zeit
// in `captured_tz` — die Uhrzeit von damals vor Ort, nicht die auf die
// Gerätezeit umgerechnete. Eine zweite eigene Formatierung liefe hier
// unweigerlich irgendwann auseinander.
function autorUndZeit(moment: RecapMoment): string {
  return `${moment.autor_name} · ${zeitInZone(moment.captured_at, moment.captured_tz)}`;
}

// Der Tagesfilter — und zwar auf den FERTIGEN Kartenpunkten, nie auf den
// Momenten davor.
//
// Das ist die eine Stelle, an der dieser Filter still falsch werden könnte:
// `punkt.index` zählt in die ungefilterte Spielliste und geht als `start` an
// den Player (siehe typen.ts und `zumPlayer` unten). Würde erst die
// Momente-Liste auf einen Tag eingedampft und `zuKartenPunkten` dann auf dem
// Rest gerufen, zählte der Index plötzlich INNERHALB des Tages statt in die
// Reise. Die Nadeln sässen weiterhin auf ihren Koordinaten, alles sähe richtig
// aus — und der Sprung landete beim falschen Moment.
function punkteAmTag(punkte: KartenPunkt[], tag: RecapTag | null): KartenPunkt[] {
  if (!tag) return punkte;
  const ids = new Set(tag.momente.map((m) => m.id));
  return punkte.filter((p) => ids.has(p.moment.id));
}

// Die Tage, zwischen denen sich auf dieser Karte überhaupt wählen lässt.
//
// Gruppiert wird über die GANZE Spielliste, nicht nur über die Momente mit
// Ort: `gruppiereNachTagen` schreibt die höchste bisher vergebene Tagesnummer
// monoton fort (tage.ts, Important 1), ein weggelassener Moment kann die
// Nummern dahinter also verschieben. uebersicht.tsx und player.tsx rechnen
// mit genau dieser Liste — und dieselbe Reise, die an zwei Stellen
// verschiedene Tagesnummern zeigt, wäre ein Fehler, den von aussen niemand
// erklären könnte.
//
// Angeboten wird davon nur, was auf der Karte auch etwas bewirkt: ein Tag,
// dessen Momente alle ohne Ort sind, führte auf eine leere Karte ohne jede
// Erklärung — eine Sackgasse im Filter, aus der nur der Rückweg auf «Alle
// Tage» hilft.
//
// Ohne `startDate` (die Reise-Abfrage ist ausgefallen) gibt es keine
// Tagesnummern und folglich keinen Filter — die Karte selbst bleibt davon
// unberührt.
function waehlbareTage(
  spielliste: RecapMoment[],
  startDate: string | null,
  punkte: KartenPunkt[]
): RecapTag[] {
  if (startDate === null) return [];
  const mitOrt = new Set(punkte.map((p) => p.moment.id));
  return gruppiereNachTagen(spielliste, startDate).filter((tag) =>
    tag.momente.some((m) => mitOrt.has(m.id))
  );
}

// Der einzelne Moment im Sheet (Spec §5.7): Bild 3:2 mit Radius 24
// (DESIGN-LANGUAGE §3), darunter Autor/Uhrzeit, Ort und Caption — und EIN
// Primär-Button (§4: genau einer pro Screen; die Liste unten hat deshalb
// keinen).
function MomentSheetInhalt({
  punkt, bildUrl, onAnsehen,
}: {
  punkt: KartenPunkt;
  bildUrl: string | null;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  const { colors } = useTheme();
  const { moment } = punkt;
  return (
    <>
      {/* Bild und Text scrollen, der Knopf bleibt: bei grosser Systemschrift
          reichen Bild (3:2), Ort und Caption sonst über die Unterkante des
          Sheets hinaus, und «Im Recap ansehen» wäre nicht mehr zu erreichen. */}
      <SheetScroll testID="moment-inhalt">
        <View style={[styles.sheetBild, { backgroundColor: colors['bg-1'] }]}>
          {/* Ohne brauchbare URL bleibt die ruhige bg-1-Fläche stehen — kein
              Puls: es kommt nichts mehr (gleiche Unterscheidung wie im
              Nadel-Skelett, KartenNadel.tsx). */}
          {bildUrl !== null && (
            <Image
              testID="sheet-bild"
              source={{ uri: bildUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={motion.duration.fast}
            />
          )}
        </View>
        <View style={styles.sheetText}>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{autorUndZeit(moment)}</Text>
          {moment.place_name ? (
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{moment.place_name}</Text>
          ) : null}
          {moment.caption ? (
            <Text style={[type.body, { color: colors['text-1'] }]}>{moment.caption}</Text>
          ) : null}
        </View>
      </SheetScroll>
      <Button variant="primary" label="Im Recap ansehen" onPress={() => onAnsehen(punkt)} />
    </>
  );
}

// Die Momente einer Gruppe, die sich nicht auseinanderzoomen lässt (Task-8-
// Brief, Schritt 2b). Jeder Eintrag führt über denselben Weg in den Player wie
// ein einzelner Moment — und keiner davon ist ein Primär-Button: es gibt genau
// einen pro Screen, und den trägt das Moment-Sheet.
function GruppenSheetInhalt({
  punkte, urls, onAnsehen,
}: {
  punkte: KartenPunkt[];
  urls: ReadonlyMap<string, MedienUrl>;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  return (
    // Die Liste scrollt (siehe SheetScroll): auf einem Fleck können beliebig
    // viele Momente liegen — `ortBestimmen` fragt ohne Optionen nach der
    // Position (features/moments/ortUndZeit.ts), und zwei Aufnahmen kurz
    // nacheinander bekommen regelmässig denselben Fix bitgleich zurück.
    <SheetScroll testID="gruppe-liste">
      {punkte.map((p, stelle) => (
        <GruppenEintrag
          key={p.moment.id}
          punkt={p}
          thumbUrl={nadelBild(urls, p.moment.id)}
          stelle={stelle}
          onAnsehen={onAnsehen}
        />
      ))}
    </SheetScroll>
  );
}

// Eine Zeile, die sich einblendet. Eigene Komponente, weil jede Zeile ihren
// eigenen Animated.Value braucht: DESIGN-LANGUAGE §5 verlangt für Listen einen
// Stagger von 40 ms, und der ist pro Zeile eine eigene Verzögerung. Beide
// Listen dieses Screens (die Momente einer Gruppe und die Reisetage) benutzen
// sie — zwei Kopien liefen irgendwann in verschiedenen Rhythmen.
function Einblendung({ stelle, children }: { stelle: number; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  // `useState` mit Initialisierer statt `useRef(...).current` wie in den
  // Nachbardateien: beides erzeugt den Wert genau einmal, aber das Lesen eines
  // Refs beim Rendern ist ein Lint-Fehler (react-hooks/refs) — hier neu
  // geschriebener Code, also gleich in der Form, die stehen bleiben kann.
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // §5: mit Reduced Motion wird alles zu einem 200-ms-Fade — die Zeilen
    // erscheinen dann gemeinsam, ohne Staffelung. Nur `opacity` wird bewegt,
    // also läuft die Animation auf dem UI-Thread.
    Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? REDUZIERTE_DAUER_MS : motion.duration.base,
      delay: reducedMotion ? 0 : stelle * STAGGER_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
  }, [opacity, reducedMotion, stelle]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

// Eine Zeile der Gruppenliste.
function GruppenEintrag({
  punkt, thumbUrl, stelle, onAnsehen,
}: {
  punkt: KartenPunkt;
  thumbUrl: string | null;
  stelle: number;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  const { colors } = useTheme();
  const { moment } = punkt;

  return (
    <Einblendung stelle={stelle}>
      <PressScale
        scaleTo={0.98}
        accessibilityRole="button"
        // Wortgleich zur Beschriftung der einzelnen Nadel
        // (KartenNadel.tsx): derselbe Moment, derselbe Weg.
        accessibilityLabel={`Moment von ${moment.autor_name} um ${zeitInZone(moment.captured_at, moment.captured_tz)} öffnen`}
        testID={`gruppe-eintrag-${moment.id}`}
        onPress={() => onAnsehen(punkt)}
      >
        <View style={styles.eintrag}>
          {/* Klein und quadratisch: Radius 12 ist der Thumbnail-Wert
              (DESIGN-LANGUAGE §3), 24 gehört dem grossen Bild oben. */}
          <View style={[styles.eintragBild, { backgroundColor: colors['bg-1'] }]}>
            {thumbUrl !== null && (
              <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
          </View>
          <View style={styles.eintragText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{autorUndZeit(moment)}</Text>
            {moment.caption ? (
              <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
                {moment.caption}
              </Text>
            ) : null}
          </View>
        </View>
      </PressScale>
    </Einblendung>
  );
}

// Eine Zeile der Tagesliste (Task-9-Brief): «Alle Tage» oder ein einzelner
// Reisetag. Kein Primär-Button — DESIGN-LANGUAGE §4 lässt genau einen pro
// Screen zu, und den trägt das Moment-Sheet («Im Recap ansehen»).
//
// Der Haken markiert den Stand, den die Pille oben zeigt: in einer Liste, die
// länger ist als das Sheet, ist er die einzige Stelle, an der beim Scrollen
// noch zu sehen ist, was gerade gilt. `accessibilityState.selected` sagt
// VoiceOver dasselbe, was der Haken zeigt.
function TagEintrag({
  beschriftung, ort, aktiv, stelle, testID, onWaehlen,
}: {
  beschriftung: string;
  ort?: string | null;
  aktiv: boolean;
  stelle: number;
  testID: string;
  onWaehlen: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Einblendung stelle={stelle}>
      <PressScale
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityState={{ selected: aktiv }}
        testID={testID}
        onPress={onWaehlen}
      >
        <View style={styles.eintrag}>
          <View style={styles.eintragText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{beschriftung}</Text>
            {/* Der Ort des Tages steht nur da, wenn es einen gibt
                (tage.ortDesTages liefert sonst null) — kein erfundener
                Platzhalter. Er ist auf einer KARTE die eigentlich nützliche
                Auskunft: «Tag 3» sagt wenig, «Lissabon» sehr viel. */}
            {ort ? (
              <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
                {ort}
              </Text>
            ) : null}
          </View>
          {aktiv && <Check size={20} color={colors.accent} strokeWidth={1.75} />}
        </View>
      </PressScale>
    </Einblendung>
  );
}

// Die Karte als zweite Lesart desselben Recaps (Spec §5.2): dieselbe Ebene
// wie uebersicht.tsx und player.tsx, damit `[id]` geteilt bleibt.
//
// Der Screen ist HELL, nicht Kino (Spec §5.3): er zeigt keine Medien im
// Vollbild, sondern ist ein Werkzeug zum Finden. Erst der Sprung in den
// Player wechselt ins Kino. Die Kartenkacheln selbst bringen ihre eigenen
// Farben mit — sie sind Inhalt wie ein Foto, nicht Interface (Entscheid R2);
// bindend bleibt, was DARAUF liegt.
export default function RecapKarte() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Screen-Rand 24 (DESIGN-LANGUAGE §3) als Basis, damit die Zurück-Pille
  // oben denselben Abstand hält wie links — auf Geräten mit Dynamic Island
  // schiebt useOberkante sie ohnehin darunter.
  const oben = useOberkante(spacing.screen);
  const reducedMotion = useReducedMotion();
  const karte = useRef<MapView>(null);
  // Die Fläche, auf der gruppiert wird. Die Karte liegt als absoluteFill über
  // dem ganzen Screen, das Fenster ist also ihr Mass. In der Höhe fehlt die
  // Tab-Bar; das verschiebt die 40-Punkte-Schwelle um wenige Prozent und
  // entscheidet nur über Nadeln, die ohnehin genau auf der Grenze liegen.
  // Nachzumessen wäre genauer, brächte aber einen ersten Durchlauf mit 0 × 0
  // mit sich — und der projizierte JEDEN Moment auf dieselbe Stelle.
  const { width: breite, height: hoehe } = useWindowDimensions();

  const [punkte, setPunkte] = useState<KartenPunkt[]>([]);
  const [ausschnitt, setAusschnitt] = useState<Ausschnitt | null>(null);
  // Die Bild-URLs bleiben liegen, weil jede Nadel ihr eigenes Thumbnail
  // trägt (Spec §5.4) — nicht nur, um damit zu filtern.
  const [urls, setUrls] = useState<ReadonlyMap<string, MedienUrl>>(KEINE_URLS);
  // Was das Sheet gerade zeigt, oder `null` für «keines offen». EIN Zustand
  // für beide Fälle, weil sie dieselbe Frage beantworten («welche Momente
  // stecken hinter dieser Nadel») und sich gegenseitig ausschliessen: ein Punkt
  // ist der einzelne Moment (Spec §5.7), mehrere sind die Liste einer Gruppe,
  // die sich nicht auseinanderzoomen lässt (Task-8-Brief, Schritt 2b).
  //
  // Mit der Reise, aus der es geöffnet wurde: der Screen bleibt bei einem
  // Wechsel der id gemountet (derselbe Grund, aus dem der Ladeweg unten seine
  // Zustände leert), und ein stehen gebliebenes Sheet zeigte danach einen
  // Moment der VORHERIGEN Reise — sein Knopf schickte den Player mit deren
  // Index in die neue, wo dieselbe Zahl auf einen ganz anderen Moment zeigt.
  const [sheet, setSheet] = useState<{ tripId: string; punkte: KartenPunkt[] } | null>(null);
  // Die wählbaren Reisetage (siehe `waehlbareTage`) — einmal beim Laden
  // gerechnet, nicht bei jedem Rendern: sie hängen nur an den geladenen Daten,
  // und dieser Screen rendert bei JEDER Kartenbewegung neu.
  const [tage, setTage] = useState<RecapTag[]>([]);
  // Der gewählte Tag, mit der Reise, in der er gewählt wurde — aus demselben
  // Grund wie beim Sheet oben: der Screen bleibt bei einem Wechsel der id
  // gemountet, und ein stehen gebliebener Filterstand öffnete die NÄCHSTE
  // Reise vorgefiltert auf einen Tag, den niemand gewählt hat.
  const [tagWahl, setTagWahl] = useState<{ tripId: string; nummer: number } | null>(null);
  const [tageOffen, setTageOffen] = useState(false);

  // Zurückgesetzt BEIM RENDERN — das dokumentierte React-Muster für «Zustand
  // beim Wechsel einer Prop verwerfen». React verwirft die Ausgabe dieses
  // Durchlaufs und rendert sofort neu, es wird also nie ein fremdes Sheet
  // sichtbar.
  //
  // Ein `setState` im Effektkörper wäre ein Lint-Verstoss
  // (react-hooks/set-state-in-effect) und eines im `.then()` käme zu spät.
  // Und bloss zu VERSTECKEN (den Zustand stehen lassen und beim Ableiten
  // vergleichen) reicht nicht: bei t1 → t2 → t1 auf derselben Instanz passte
  // die Reise-id wieder, und ein Sheet öffnete sich mitsamt seiner
  // Eintrittsanimation, das niemand angetippt hat — mit einem Index aus dem
  // früheren Ladevorgang, der inzwischen auf einen anderen Moment zeigen kann.
  //
  // Kein zusätzlicher Vergleich beim Ableiten: er wäre nie zu beobachten, weil
  // die Ausgabe dieses Durchlaufs ohnehin verworfen wird.
  if (sheet !== null && sheet.tripId !== id) setSheet(null);
  // Aus demselben Grund und auf demselben Weg: eine Tageswahl der vorherigen
  // Reise ist in der neuen keine Wahl mehr, sondern ein Filter, den niemand
  // gesetzt hat — und weil die Tagesnummer in der neuen Reise oft schlicht
  // existiert, sähe das nicht nach einem Fehler aus, sondern nach einer Reise
  // mit auffällig wenigen Momenten.
  if (tagWahl !== null && tagWahl.tripId !== id) setTagWahl(null);
  const sheetPunkte = sheet?.punkte ?? null;

  useEffect(() => {
    let aktiv = true;
    // `fetchTrip` kommt allein wegen `start_date` mit: die Tagesnummern zählen
    // ab dem Startdatum DER REISE (tage.ts), nicht ab dem ersten Moment —
    // uebersicht.tsx und player.tsx lesen es an derselben Stelle. Ohne diese
    // Abfrage müsste dieser Screen die Tage aus den Momenten heraus raten und
    // zeigte für dieselbe Reise andere Nummern als die Übersicht.
    void Promise.all([fetchTrip(id), fetchRecapMomente(id), holeVorrat(id)])
      .then(([{ data: reise }, momente, { vorrat }]) => {
        if (!aktiv) return;
        // DIE Stelle, an der ein Fehler still bliebe: die Karte muss dieselbe
        // Liste zählen wie der Player. `punkt.index` geht später als `start`
        // an ihn, und `parseStartIndex` zählt dort in genau diese gefilterte
        // Liste (player.tsx:503-527); uebersicht.tsx:316-317 baut ihr
        // `indexById` aus derselben Filterung. Gäbe dieser Screen die rohe
        // Momente-Liste herein, verschöbe jeder noch hochladende Moment alles
        // dahinter — die Nadeln sässen weiterhin richtig, aber der Sprung
        // landete beim falschen Moment, und das merkt niemand, ausser er
        // zählt nach.
        //
        // BEIDE Bedingungen sind nötig, keine ist durch die andere gedeckt:
        // dass `media-urls` serverseitig nur für hochgeladene Momente
        // signiert (und `urls.has` deshalb heute dasselbe aussortiert), ist
        // eine Eigenschaft einer ANDEREN Datei, die dieser Screen nicht
        // kennt und auf die er sich nicht verlassen darf.
        const vorratUrls = vorrat?.urls ?? KEINE_URLS;
        const uploaded = momente.data.filter((m) => m.upload_status === 'uploaded');
        const mitBild = uploaded.filter((m) => vorratUrls.has(m.id));
        const { punkte: p } = zuKartenPunkten(mitBild);
        setUrls(vorratUrls);
        setPunkte(p);
        setAusschnitt(ausschnittFuer(p));
        // Fällt allein die Reise-Abfrage aus (oder gibt es die Reise nicht
        // mehr), bleibt die Karte stehen und nur der Filter fehlt: er ist
        // Beiwerk, die Nadeln sind der Screen. Dieselbe Abwägung wie bei
        // `loadCounts` in tripsApi.ts.
        setTage(waehlbareTage(mitBild, reise?.start_date ?? null, p));
      })
      // fetchRecapMomente und holeVorrat geben Fehler als WERT zurück statt
      // zu werfen — aber "wirft normalerweise nicht" ist keine Zusicherung,
      // die diese Kette tragen kann. Wirft eine der beiden doch, wäre die
      // Ablehnung ohne dieses .catch() unbehandelt, und das vorangestellte
      // `void` unterdrückte auch noch die Warnung davor (Fixrunde 1).
      //
      // Der Screen landet dann im selben Zustand wie nach einem Ladefehler:
      // keine Punkte, kein Ausschnitt. Beim ERSTEN Laden ist das derselbe
      // Zustand wie der Anfangszustand — bei einem Wechsel der Reise-id aber
      // nicht: dort müssen die Nadeln der vorherigen Reise verschwinden,
      // statt über einer Karte stehen zu bleiben, zu der sie nicht gehören.
      //
      // «Leer» sichtbar von «Fehler» zu unterscheiden ist Sache von Task 10,
      // der den Ladeweg ohnehin umbaut. Bis dahin geht der Fehler wenigstens
      // nicht lautlos verloren, sondern an den Fehlermelder (ohne DSN ein
      // No-Op, siehe lib/fehlermelder.ts).
      .catch((fehler: unknown) => {
        if (!aktiv) return;
        meldeFehler(fehler, { screen: 'recap/karte', tripId: id });
        setUrls(KEINE_URLS);
        setPunkte([]);
        setAusschnitt(null);
        setTage([]);
      });
    return () => {
      aktiv = false;
    };
  }, [id]);

  // Der sichtbare Ausschnitt wandert bei jeder Kartenbewegung in den State:
  // Task 7 gruppiert Nadeln nach ihrem Abstand in BILDSCHIRMpunkten und
  // braucht dafür den aktuellen Zoom, nicht den anfänglichen.
  const merkeAusschnitt = useCallback((region: Region) => setAusschnitt(region), []);

  // Der gewählte Tag als Objekt statt als blosse Nummer — und aus `tage`
  // heraus gesucht, nicht aus `tagWahl` heraus geglaubt: nach einem
  // Neuladen kann der gewählte Tag verschwunden sein (ein Moment ist
  // dazugekommen und hat die Nummerierung verschoben, oder der letzte Moment
  // dieses Tages hat seinen Ort verloren). Wird er nicht mehr gefunden, gilt
  // wieder «Alle Tage» — Pille, Nadeln, Linie und Ausschnitt leiten ALLE aus
  // diesem einen Wert ab und können deshalb gar nicht auseinanderlaufen.
  const gewaehlterTag = useMemo(
    () => tage.find((t) => t.nummer === tagWahl?.nummer) ?? null,
    [tage, tagWahl]
  );

  // Was die Karte zeigt. Gefiltert wird auf den FERTIGEN Punkten — siehe
  // `punkteAmTag`: der Index darin zeigt weiterhin in die ganze Reise.
  const sichtbarePunkte = useMemo(() => punkteAmTag(punkte, gewaehlterTag), [punkte, gewaehlterTag]);

  // Die Linie der Reise (Spec K3/§5.6). `punkte` kommt aus zuKartenPunkten
  // bereits nach `captured_at` sortiert — hier wird bewusst NICHT noch einmal
  // sortiert: die Linie zeigt, in welcher Reihenfolge aufgenommen wurde, nie,
  // in welcher hochgeladen wurde.
  //
  // `useMemo` ist hier nicht Feinschliff: `merkeAusschnitt` lässt den Screen
  // bei jeder Kartenbewegung neu rendern, und ein bei jedem Rendern neues
  // Koordinaten-Array schickte die Polyline jedes Mal erneut über die Brücke.
  // Über `sichtbarePunkte`, nicht über `punkte`: eine Linie, die bei einem
  // gewählten Tag weiter zum nächsten zeichnete, behauptete eine Bewegung, die
  // an diesem Tag nicht stattgefunden hat. An der Sortierung ändert das
  // nichts — `punkteAmTag` filtert nur, es sortiert nicht um.
  const linie = useMemo(
    () => sichtbarePunkte.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [sichtbarePunkte]
  );

  // Nadeln, die einander sonst verdecken, teilen sich eine (Spec §5.5).
  // Gruppiert wird nach dem Abstand auf DEM GERADE SICHTBAREN Ausschnitt —
  // darum steht `ausschnitt` in den Abhängigkeiten und nicht bloss der
  // Anfangswert: beim Hineinzoomen fällt eine Gruppe von selbst auseinander.
  //
  // `useMemo` bindet die Rechnung an genau die vier Werte, die ihr Ergebnis
  // bestimmen. `gruppiere` vergleicht jeden Punkt mit jeder bisherigen Gruppe,
  // und der Screen rendert bei jeder Kartenbewegung neu — dazu bei jedem
  // Zustand, der mit der Karte nichts zu tun hat (die eintreffenden Bild-URLs
  // heute, das Moment-Sheet in Task 8). Ohne die Bindung liefe sie bei jedem
  // dieser Renders mit. Gespart wird die RECHNUNG, nicht ein Neuaufbau der
  // Nadeln: die hängen an ihrem Schlüssel und ihren Props und blieben auch
  // ohne das Memo stehen.
  const gruppen = useMemo(
    () => (ausschnitt ? gruppiere(sichtbarePunkte, ausschnitt, breite, hoehe) : []),
    [sichtbarePunkte, ausschnitt, breite, hoehe]
  );

  // DIE eine Stelle, an der sich die Kamera dieses Screens bewegt (Spec K12):
  // der Gruppen-Zoom heute, der Tagesfilter in Task 9. Zwei Wege liefen
  // garantiert auseinander — und an einem von beiden fehlte irgendwann die
  // Reduced-Motion-Weiche.
  //
  // Der Erststart geht bewusst NICHT hier durch: die Karte wird überhaupt erst
  // gemountet, wenn der Ausschnitt feststeht, und öffnet mit `initialRegion`
  // direkt dort. Es gibt nichts, wovon aus gefahren würde.
  const zeige = useCallback(
    (ziel: Ausschnitt) => {
      // DESIGN-LANGUAGE §5: mit Reduced Motion wird gesprungen statt gefahren.
      // `setRegion` ist der Sprung — es ruft intern `animateToRegion` mit
      // Dauer 0 auf dem Fabric-Handle auf (MapView.tsx:863-867).
      //
      // NICHT `setNativeProps`, obwohl MapView die Methode hat und sie
      // typprüft: sie reicht an `this.map` weiter, und dieses Ref wird in
      // 1.27.2 an KEIN Element gehängt (`ref={this.map}` kommt nirgends vor,
      // nur `ref={this.fabricMap}`). `this.map.current` ist damit immer null,
      // der Aufruf ein stiller No-op. Kein Absturz, der auffiele — eine Kamera,
      // die einfach stehen bleibt, und zwar nur für die, die Reduced Motion
      // eingeschaltet haben.
      if (reducedMotion) karte.current?.setRegion(ziel);
      else karte.current?.animateToRegion(ziel, motion.duration.base);
    },
    [reducedMotion]
  );

  // Was ein Tipp auf eine Nadel wissen muss — in einem Ref statt in den
  // Abhängigkeiten von `aufNadel`. Hinge die Funktion an `gruppen` und
  // `ausschnitt`, bekäme jede Nadel bei JEDER Kartenbewegung ein neues
  // `onPress`; das `memo` am Marker (KartenNadel.tsx) wäre wirkungslos, und
  // jede Nadel schickte ihre Koordinate erneut über die Brücke, obwohl sich an
  // ihr nichts geändert hat.
  //
  // `useLayoutEffect`, nicht `useEffect`: ein passiver Effekt läuft erst NACH
  // dem Commit, und in dem Fenster dazwischen liest ein Tipp noch den alten
  // Stand. Das ist kein theoretischer Fall — die Karte kommt aus einer Fahrt,
  // die Gruppe ist gerade zerfallen, und wer sofort auf die neu erschienene
  // Nadel tippt, wird in den alten Gruppen nicht gefunden (dort war sie
  // Mitglied, kein Anker) — und das Moment-Sheet bliebe aus, ohne dass
  // irgendwo ein Fehler entstünde. Festgenagelt in karte.test.tsx («ein Tipp
  // unmittelbar nach dem Zerfall einer Gruppe wird nicht verschluckt»): dort
  // tippt ein Nachbar aus seinem eigenen Layout-Effekt heraus, also genau in
  // dem Fenster zwischen Commit und passivem Effekt.
  const stand = useRef<{ gruppen: Gruppe[]; ausschnitt: Ausschnitt | null }>({ gruppen, ausschnitt });
  useLayoutEffect(() => {
    stand.current = { gruppen, ausschnitt };
  }, [gruppen, ausschnitt]);

  // Ein Tipp auf eine Gruppe fährt in sie hinein, solange das etwas ausrichtet
  // (Spec §5.5): wer auf der Karte sucht, will die Karte benutzen. Erst wo
  // Zoomen nichts mehr bringt, öffnet sich das Sheet — siehe unten.
  const aufNadel = useCallback(
    (anker: KartenPunkt) => {
      const { gruppen: aktuelle, ausschnitt: sichtbar } = stand.current;
      const gruppe = aktuelle.find((g) => g.anker === anker);
      if (!gruppe) return;

      // Ins Sheet führt EINE Frage: richtet Zoomen hier überhaupt noch etwas
      // aus? Sie deckt beide Fälle ab, in denen die Antwort nein ist —
      //
      // - den häufigen: eine einzelne Nadel. Ein Punkt liegt trivialerweise
      //   auf einem Fleck, und dort steht der Moment selbst (Spec §5.7). Die
      //   Karte bewegt sich dabei NICHT: der Moment soll nicht unter dem Sheet
      //   wegrutschen, während man ihn liest.
      // - den seltenen: eine Gruppe, deren Momente alle auf derselben
      //   Koordinate liegen. Sie fällt durch keine Zoomstufe auseinander
      //   (Begründung in gruppierung.ts); ohne diesen Ausweg tippte man ins
      //   Leere (Task-8-Brief, Schritt 2b), stattdessen listet das Sheet sie
      //   auf.
      //
      // Bewusst nicht zusätzlich `punkte.length === 1` davorgesetzt: die
      // Abfrage wäre vom Rest gedeckt und liesse sich ersatzlos streichen,
      // ohne dass eine Zusicherung fiele — genau die Art Bedingung, die
      // später niemand mehr prüfen kann.
      if (aufEinemFleck(gruppe)) {
        setSheet({ tripId: id, punkte: gruppe.punkte });
        return;
      }

      // Unerreichbar, aber für den Typ nötig: `gruppen` wird nur berechnet,
      // wenn `ausschnitt` steht (siehe useMemo oben), und beide gehen im
      // selben Zug in `stand`. Ohne Ausschnitt gäbe es also gar keine Nadel,
      // die getippt werden könnte.
      if (!sichtbar) return;

      const umfasst = ausschnittFuer(gruppe.punkte);
      if (!umfasst) return;

      // DESIGN-LANGUAGE §5 nennt für «Zoom» selection-Haptik — dieselbe
      // Meldung wie beim Tab-Wechsel. Sie gehört an den Zoom selbst, nicht in
      // `zeige`: der Tagesfilter (Task 9) fährt aus einem anderen Anlass und
      // bringt seine eigene Regel mit. `.catch`, weil ein abgelehntes Promise
      // aus einem nativen Modul sonst als unbehandelte Ablehnung zählt —
      // gleiches Muster wie player.tsx.
      void Haptics.selectionAsync().catch(() => {});

      zeige({
        ...umfasst,
        // Die Fahrt geht immer HINEIN, nie hinaus. `ausschnittFuer` hat eine
        // Mindestspanne von rund 1,1 km — sie ist für den Erststart gedacht,
        // damit ein einzelner Moment nicht maximal herangezoomt wird. Liegen
        // die Momente einer Gruppe enger beieinander, ist ihr Ergebnis WEITER
        // als das, was gerade zu sehen ist, und der Tipp zoomte hinaus. Die
        // halbe sichtbare Spanne ist die Antwort auf beides: nie hinaus, und
        // immer sichtbar hinein — auch bei Momenten auf derselben Koordinate,
        // die keine Zoomstufe trennen kann.
        latitudeDelta: Math.min(umfasst.latitudeDelta, sichtbar.latitudeDelta / 2),
        longitudeDelta: Math.min(umfasst.longitudeDelta, sichtbar.longitudeDelta / 2),
      });
    },
    [zeige, id]
  );

  // Der Weg in den Player (Spec §5.7). `punkt.index` zählt über die
  // SPIELLISTE, die der Ladeweg oben filtert — dieselbe, die der Player
  // aufbaut, und `parseStartIndex` zählt dort in genau sie (player.tsx:503-527).
  // Nie der Index innerhalb von `punkte` (der überspringt die Momente ohne
  // Ort) und nie der innerhalb der Gruppe: beide sässen scheinbar richtig und
  // starteten den Player beim falschen Moment.
  //
  // Das Sheet bleibt dabei bewusst offen: es zu schliessen hiesse, es während
  // des Übergangs in den Player wegblitzen zu lassen — und wer zurückkommt,
  // findet die Stelle wieder, an der er war.
  const zumPlayer = useCallback(
    (punkt: KartenPunkt) => {
      router.push({ pathname: '/recap/[id]/player', params: { id, start: String(punkt.index) } });
    },
    [router, id]
  );

  // Was die Pille zeigt und was VoiceOver ansagt — eine Quelle für beides.
  const filterStand = gewaehlterTag ? `Tag ${gewaehlterTag.nummer}` : 'Alle Tage';

  const oeffneTagesfilter = () => {
    // DESIGN-LANGUAGE §4: genau EIN Primär-Button pro Screen. Den trägt das
    // Moment-Sheet; zwei offene Sheets hätten zwei. Auf dem Gerät fängt der
    // Backdrop des offenen Sheets diesen Tipp ohnehin ab — dass der Zustand
    // hier trotzdem eindeutig gemacht wird, kostet nichts und macht die
    // Zusicherung prüfbar, statt sie der Trefferreihenfolge zu überlassen.
    setSheet(null);
    setTageOffen(true);
  };

  const waehleTag = (tag: RecapTag | null) => {
    setTageOffen(false);
    setTagWahl(tag ? { tripId: id, nummer: tag.nummer } : null);

    // Der gewählte Tag ändert Nadeln UND Linie UND Ausschnitt: ein Tag, dessen
    // Momente ausserhalb des sichtbaren Ausschnitts liegen, wäre sonst eine
    // leere Karte, und die Wahl sähe aus wie ein Fehler.
    //
    // `punkteAmTag` mit dem NEUEN Tag statt mit `sichtbarePunkte`: der State
    // steht in dieser Zeile noch auf dem alten Stand, React rendert erst
    // danach neu.
    const ziel = ausschnittFuer(punkteAmTag(punkte, tag));
    // Unerreichbar, solange die Liste stimmt: `waehlbareTage` bietet nur Tage
    // an, die mindestens eine Nadel haben, und «Alle Tage» gibt es nur, wenn
    // überhaupt Nadeln da sind. Ohne Ziel bleibt die Kamera stehen — ein
    // Sprung nach `null` wäre ein Sprung in den Atlantik.
    if (!ziel) return;

    // DESIGN-LANGUAGE §5 nennt selection-Haptik für Tabs und Zoom. Die Wahl
    // eines Tages ist beides zugleich: eine Auswahl, die die Kamera bewegt.
    // Sie steht hier und nicht in `zeige`, weil der Gruppen-Zoom seine eigene
    // Meldung schon mitbringt (siehe `aufNadel`).
    void Haptics.selectionAsync().catch(() => {});

    zeige(ziel);
  };

  const zurueck = () => {
    if (router.canGoBack()) router.back();
    // Ohne Rückweg (Deep Link direkt auf die Karte) führt der Weg auf die
    // Übersicht DIESER Reise, nicht auf die Recap-Liste: die Karte ist eine
    // Lesart dieses Recaps, kein eigener Bereich der App (Spec §5.1).
    else router.replace({ pathname: '/recap/[id]/uebersicht', params: { id } });
  };

  return (
    <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
      {/* Ohne Ausschnitt gibt es nichts zu zeigen: `ausschnittFuer` liefert
          `null`, wenn kein einziger Moment einen Ort hat — dann steht hier
          bewusst KEINE Karte, statt einer erfundenen Region über dem
          Atlantik (Spec K9). Die Erklärung dazu kommt in Task 10. */}
      {ausschnitt && (
        <MapView
          ref={karte}
          testID="karte-flaeche"
          style={StyleSheet.absoluteFill}
          initialRegion={ausschnitt}
          onRegionChangeComplete={merkeAusschnitt}
        >
          {/* Die Linie steht VOR den Nadeln im Baum, damit sie unter ihnen
              liegt. Unter zwei Punkten gibt es nichts zu verbinden. */}
          {linie.length > 1 && (
            <Polyline
              testID="karte-linie"
              coordinates={linie}
              strokeColor={colors.accent}
              strokeWidth={3}
            />
          )}

          {/* Der Schlüssel hängt am Anker, nicht am Inhalt der Gruppe: beim
              Zoomen ändert sich die Zusammensetzung laufend, und ein Schlüssel
              aus ihr heraus hängte jedes Mal eine neue Nadel an die Karte,
              statt die vorhandene weiterzuzeichnen. */}
          {gruppen.map((g) => (
            <KartenNadelMarker
              key={g.anker.moment.id}
              punkt={g.anker}
              thumbUrl={nadelBild(urls, g.anker.moment.id)}
              anzahl={g.punkte.length}
              // Dieselbe Auskunft, die `aufNadel` benutzt — damit das Label
              // für VoiceOver nennt, was der Tipp WIRKLICH tut: heranzoomen
              // oder das Sheet öffnen. Eine zweite eigene Regel hier liefe
              // irgendwann gegen die dort.
              unteilbar={aufEinemFleck(g)}
              onPress={aufNadel}
            />
          ))}
        </MapView>
      )}

      {/* Die Karte hat keinen eigenen Kopf, sie soll gross sein (Spec §5.3)
          — der einzige Rückweg ist diese translucente Pille über der
          Kartenfläche (DESIGN-LANGUAGE §1: UI auf einer Fremdfläche liegt
          ausschliesslich als Pille mit Blur). Sie steht ausserhalb der
          MapView, damit sie auch im ortlosen Fall erreichbar bleibt. */}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Zurück"
        onPress={zurueck}
        style={[styles.zurueck, { top: oben }]}
      >
        <Pille style={styles.zurueckPille}>
          <ChevronLeft size={24} color={cinema['text-1']} strokeWidth={1.75} />
        </Pille>
      </PressScale>

      {/* Der Tagesfilter, gegenüber dem Rückweg (Task-9-Brief: oben rechts).
          Wie dort eine translucente Pille mit Blur — sie liegt auf der
          Kartenfläche (DESIGN-LANGUAGE §1).

          Erst ab zwei wählbaren Tagen: bei nur einem zeigten «Alle Tage» und
          «Tag 1» dieselben Nadeln, und eine Pille, die nichts unterscheidet,
          ist kein Filter, sondern eine Behauptung. Bei null Tagen (keine
          Nadeln, oder die Reise-Abfrage ist ausgefallen) gibt es ohnehin
          nichts zu wählen. */}
      {tage.length > 1 && (
        <PressScale
          testID="karte-tagesfilter"
          accessibilityRole="button"
          // Sagt beides: was ein Tipp tut und was gerade gilt. Die Pille selbst
          // zeigt nur den Stand — ohne diese Ergänzung wüsste per VoiceOver
          // niemand, dass sich dahinter eine Wahl öffnet.
          accessibilityLabel={`Reisetag wählen, aktuell ${filterStand}`}
          onPress={oeffneTagesfilter}
          style={[styles.tagesfilter, { top: oben }]}
        >
          <Pille style={styles.tagesfilterPille}>
            <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{filterStand}</Text>
            <ChevronDown size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pille>
        </PressScale>
      )}

      {/* Wie beim Moment-Sheet erst gemountet, wenn es offen sein soll: `Sheet`
          bringt seine Eintrittsanimation im Effekt mit. */}
      {tageOffen && (
        <Sheet sichtbar titel="Reisetage" onSchliessen={() => setTageOffen(false)}>
          {/* Scrollt und ist gedeckelt, aus demselben Grund wie die
              Gruppenliste: eine lange Reise hat viele Tage, und `Sheet`
              schnitte den Überhang hart ab (85 % Fensterhöhe, `overflow:
              hidden`) — die letzten Tage wären dann auf keinem Weg mehr
              wählbar. */}
          <SheetScroll testID="tage-liste">
            <TagEintrag
              testID="tag-eintrag-alle"
              beschriftung="Alle Tage"
              aktiv={gewaehlterTag === null}
              stelle={0}
              onWaehlen={() => waehleTag(null)}
            />
            {tage.map((tag, stelle) => (
              <TagEintrag
                key={tag.nummer}
                testID={`tag-eintrag-${tag.nummer}`}
                beschriftung={`Tag ${tag.nummer}`}
                ort={tag.ort}
                aktiv={gewaehlterTag?.nummer === tag.nummer}
                // Um eins versetzt: «Alle Tage» ist die erste Zeile.
                stelle={stelle + 1}
                onWaehlen={() => waehleTag(tag)}
              />
            ))}
          </SheetScroll>
        </Sheet>
      )}

      {/* Erst gemountet, wenn es etwas zu zeigen gibt: `Sheet` bringt seine
          Eintrittsanimation im Effekt mit (spring-ui, DESIGN-LANGUAGE §4), und
          ein frisch gemountetes Sheet öffnet damit jedes Mal von unten. Die
          Kinder werden ohnehin vom Elternteil gebaut — ein dauerhaft
          gemountetes Sheet müsste sie also trotzdem gegen `null` absichern. */}
      {sheetPunkte !== null && (
        <Sheet
          sichtbar
          // Die Liste bekommt eine Überschrift, der einzelne Moment nicht:
          // dort ist das Bild der Kopf (Spec §5.7). Mehr als ein Punkt heisst
          // hier immer «alle auf derselben Koordinate» — «an diesem Ort» ist
          // also wörtlich wahr, anders als bei einer nach Bildschirmpunkten
          // gebildeten Gruppe.
          titel={sheetPunkte.length > 1 ? `${sheetPunkte.length} Momente an diesem Ort` : undefined}
          onSchliessen={() => setSheet(null)}
        >
          {sheetPunkte.length === 1 ? (
            <MomentSheetInhalt
              punkt={sheetPunkte[0]}
              bildUrl={sheetBild(urls, sheetPunkte[0].moment.id)}
              onAnsehen={zumPlayer}
            />
          ) : (
            <GruppenSheetInhalt punkte={sheetPunkte} urls={urls} onAnsehen={zumPlayer} />
          )}
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flaeche: { flex: 1 },
  zurueck: { position: 'absolute', left: spacing.screen },
  zurueckPille: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagesfilter: { position: 'absolute', right: spacing.screen },
  // Dieselbe Höhe wie die Zurück-Pille gegenüber, damit beide auf einer Linie
  // sitzen. Abstände aus dem 4er-Raster (DESIGN-LANGUAGE §3).
  tagesfilterPille: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Spec §5.7: Bild in 3:2, Radius 24 (DESIGN-LANGUAGE §3, der Cover-Wert).
  // `overflow: hidden` beschneidet das Bild auf diesen Radius; einen Schatten
  // trägt es nicht, der gehört dem Sheet darunter.
  sheetBild: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  // Enger als der Abstand, den das Sheet zwischen seinen Kindern hält: die
  // drei Zeilen gehören zusammen (4er-Raster, §3).
  sheetText: { gap: spacing.xs },
  // Derselbe Abstand, den `Sheet` zwischen seinen eigenen Kindern hält — er
  // gilt innerhalb der ScrollView nicht mehr weiter.
  scrollInhalt: { gap: spacing.base },
  eintrag: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  eintragBild: { width: 56, height: 56, borderRadius: radius.control, overflow: 'hidden' },
  // `flex: 1` nimmt den Rest der Zeile — ohne das schöbe eine lange Caption
  // die Zeile über den Rand hinaus, statt in `numberOfLines` abgeschnitten zu
  // werden.
  eintragText: { flex: 1, gap: spacing.xs },
});
