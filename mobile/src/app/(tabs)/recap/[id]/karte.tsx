import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { reportError } from '@/lib/errorReporter';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchRecapMoments } from '@/features/recap/recapApi';
import { groupByDays, sortMoments } from '@/features/recap/days';
import type { RecapMoment, RecapDay } from '@/features/recap/types';
import { getPool, retryHelps, type MediaUrl } from '@/features/recap/urlPool';
import { fetchTrip } from '@/features/trips/tripsApi';
import { ausschnittFuer } from '@/features/karte/ausschnitt';
import { KartenFlaeche } from '@/features/karte/KartenFlaeche';
import { gruppiere } from '@/features/karte/gruppierung';
import { zoomAussichtslos, zoomZiel, type ZoomVersuch } from '@/features/karte/gruppenTipp';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import { useTripBound } from '@/features/trips/useTripBound';
import { momentLabel } from '@/features/karte/nadel';
import {
  Einblendung,
  GruppenSheetInhalt,
  MomentSheetInhalt,
  SheetScroll,
  nadelBild,
  sheetBild,
  zeilenStile,
  type SheetForm,
} from '@/features/karte/MomentSheet';
import type {
  Ausschnitt,
  Gruppe,
  KartenFlaecheHandle,
  KartenPunkt,
} from '@/features/karte/typen';

// Eine feste leere Map statt `new Map()` bei jedem Zurücksetzen: der Wert geht
// als Abhängigkeit in die Nadeln, und eine jedes Mal neue Map liesse sie ohne
// Grund neu rechnen.
const KEINE_URLS: ReadonlyMap<string, MediaUrl> = new Map();

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms», die Zeilen der Gruppenliste
// erscheinen nacheinander, nicht als Block.
const STAGGER_MS = 40;
// §5: «prefers-reduced-motion: alles wird zu 200-ms-Fades». Derselbe Wert wie
// in Sheet.tsx (dort modulprivat).
const REDUZIERTE_DAUER_MS = 200;

// Wirft eine der beiden Abfragen, statt ihren Fehler als Wert zurückzugeben,
// gibt es keinen Text vom Server. Dann muss dieser hier einspringen, Ursache
// und Lösung, ohne Entschuldigung (DESIGN-LANGUAGE §6), nach demselben Muster
// wie der allgemeine Ladefehler in recapApi.ts («Die Momente konnten nicht
// geladen werden. Probier es gleich nochmal.»).
const WURF_TEXT = 'Die Karte konnte nicht geladen werden. Probier es gleich nochmal.';

// Spec §5.9, wörtlich. Kein leerer Kartenausschnitt über dem Atlantik,
// sondern die Auskunft, warum hier nichts ist.
const LEER_TITEL = 'Diese Reise hat keine Orte';
const LEER_ERKLAERUNG =
  'Momente bekommen ihren Ort beim Einsenden, aber nur, wenn die Ortungsdienste erlaubt sind. Für diese Reise war das nie der Fall.';

// Und der andere leere Fall: es gibt überhaupt keine Momente zu zeigen.
// Wortgleich zu uebersicht.tsx und player.tsx, dieselbe Reise soll auf allen
// drei Screens dasselbe sagen.
const LEER_OHNE_MOMENTE = 'Diese Reise ist leer geblieben.';

// Die eine Zeile, die die Lücke in den Tagesnummern erklärt. `waehlbareTage`
// lässt Tage weg, an denen kein Moment einen Ort hat, die Übersicht zeigt
// sie trotzdem, der Filter springt hier also z.B. von Tag 1 auf Tag 3. Ohne
// diesen Satz sieht das nach einem Fehler aus statt nach einer Regel.
const LUECKEN_HINWEIS = 'Tage, an denen kein Moment einen Ort hat, stehen nicht zur Wahl.';

// Was die Sheets dieses Screens von denen des geteilten Recaps unterscheidet
// (features/karte/MomentSheet.tsx): die Beschriftung des Knopfs, und sonst
// nichts. Der leere testID-Präfix ist Absicht, siehe `SheetForm` dort.
const SHEET_FORM: SheetForm = { knopfLabel: 'Im Recap ansehen', praefix: '' };

// Die Leiste unten UND der Titel ihres Sheets (Spec §5.8), eine Quelle für
// beide. Singular/Plural wie überall im Projekt: die Zahl bleibt auch im
// Singular stehen.
function ohneOrtText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment' : 'Momente'} ohne Ort`;
}

// Was diese Karte NICHT zeigt, in Worten. Wortgleich zu uebersicht.tsx (dort
// modulprivat): dieselbe Reise soll auf beiden Screens dieselben zwei Sätze
// für dieselben zwei Lagen sagen. Singular/Plural wie überall im Projekt,
// die Zahl bleibt auch im Singular stehen.
//
// Sie sind ausdrücklich NICHT dasselbe wie «N Momente ohne Ort»: dort geht es
// um Momente, die auf dieser Karte keine Nadel bekommen können, in Übersicht
// und Recap aber vollständig da sind. Hier geht es um Momente, die diese Reise
// gerade überhaupt nicht hergibt, die eine Gruppe kommt noch, die andere
// liess sich nicht laden.
function unterwegsText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

function ohneBildText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Ein Moment, den keine Nadel tragen kann, mit seinem Platz in der
// Spielliste. Genau dieser Wert geht als `start` an den Player, exakt wie
// `KartenPunkt.index` (typen.ts): nie die Stelle innerhalb dieser Liste hier,
// nie die in der rohen Momente-Liste.
type OhneOrt = { moment: RecapMoment; index: number };

// Wie weit der Ladeweg der Momente gekommen ist.
//
// Ohne diese Unterscheidung sähen DREI verschiedene Lagen identisch aus, denn
// alle drei enden in `punkte = []` und `ausschnitt = null`: «lädt noch»,
// «konnte nicht laden» (Deep Link auf eine fremde Reise, versiegelte Reise,
// Netz weg) und «geladen, aber kein einziger Moment hat einen Ort». Bis Task
// 10 war das dieselbe weisse Fläche mit einer Zurück-Pille.
//
type Phase = 'laedt' | 'fehler' | 'fertig';

// Das Ergebnis EINES Ladevorgangs, mit der Reise, zu der es gehört.
// Begründung für den Stempel steht an der State-Deklaration.
type Ladestand = {
  tripId: string;
  phase: Phase;
  punkte: KartenPunkt[];
  ohneOrt: OhneOrt[];
  // Momente, die diese Karte ueberhaupt nicht zeigt, weder als Nadel noch in
  // der Leiste «N Momente ohne Ort». Sie fallen im Ladeweg unten aus der
  // Spielliste heraus, und ohne diese beiden Zahlen taeten sie das spurlos:
  // eine Reise mit 15 Momenten zeigte 11 Nadeln, sagte «3 Momente ohne Ort»,
  // und der fehlende Rest waere von aussen nicht zu erklaeren.
  //
  // Getrennt gehalten, weil es zwei verschiedene Lagen mit zwei verschiedenen
  // Aussichten sind, genau wie in uebersicht.tsx: `unterwegs` kommt noch,
  // `ohneBild` liess sich gerade nicht laden.
  unterwegs: number;
  ohneBild: number;
  fehlerText: string | null;
  // Ob ein zweiter Versuch etwas ausrichtet. Im Ladestand und nicht daneben:
  // die Antwort gehört zu genau diesem Fehlertext und wird mit ihm gesetzt,
  // getrennt gehalten könnten die beiden auseinanderlaufen und der Knopf
  // verspräche etwas, was der Text bereits ausschliesst.
  //
  // `false` nur bei einer fachlichen Ablehnung des Vorrats (versiegelt, kein
  // Zugriff, features/recap/urlVorrat.ts). Ohne Fehler ist der Wert
  // bedeutungslos und steht auf `true`.
  nochmalHilft: boolean;
};

// Feste leere Listen statt `[]` bei jedem Ableiten, gleicher Grund wie bei
// KEINE_URLS oben: die Werte gehen als Abhängigkeit in `sichtbarePunkte`,
// `linie` und `gruppen`, und ein bei jedem Rendern neues Array liesse sie
// ohne Grund neu rechnen.
const KEINE_PUNKTE: KartenPunkt[] = [];
const KEINE_OHNE_ORT: OhneOrt[] = [];
const KEINE_MOMENTE: RecapMoment[] = [];

// Der Tagesfilter, und zwar auf den FERTIGEN Kartenpunkten, nie auf den
// Momenten davor.
//
// Das ist die eine Stelle, an der dieser Filter still falsch werden könnte:
// `punkt.index` zählt in die ungefilterte Spielliste und geht als `start` an
// den Player (siehe typen.ts und `zumPlayer` unten). Würde erst die
// Momente-Liste auf einen Tag eingedampft und `zuKartenPunkten` dann auf dem
// Rest gerufen, zählte der Index plötzlich INNERHALB des Tages statt in die
// Reise. Die Nadeln sässen weiterhin auf ihren Koordinaten, alles sähe richtig
// aus, und der Sprung landete beim falschen Moment.
function punkteAmTag(punkte: KartenPunkt[], tag: RecapDay | null): KartenPunkt[] {
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
// mit genau dieser Liste, und dieselbe Reise, die an zwei Stellen
// verschiedene Tagesnummern zeigt, wäre ein Fehler, den von aussen niemand
// erklären könnte.
//
// Angeboten wird davon nur, was auf der Karte auch etwas bewirkt: ein Tag,
// dessen Momente alle ohne Ort sind, führte auf eine leere Karte ohne jede
// Erklärung, eine Sackgasse im Filter, aus der nur der Rückweg auf «Alle
// Tage» hilft. Was dabei wegfällt, reisst eine Lücke in die Nummern (Tag 1,
// Tag 3), die erklärt LUECKEN_HINWEIS im Sheet, statt sie stumm zu lassen.
function waehlbareTage(alle: RecapDay[], punkte: KartenPunkt[]): RecapDay[] {
  const mitOrt = new Set(punkte.map((p) => p.moment.id));
  return alle.filter((tag) => tag.momente.some((m) => mitOrt.has(m.id)));
}

// Die Momente ohne Ort mit ihrem Platz in der Spielliste.
//
// Die Reihenfolge kommt aus `sortiereMomente`, DERSELBEN Funktion, mit der
// `zuKartenPunkten` seine Indizes vergibt (kartenPunkte.ts). Sie ist eine
// totale Ordnung (captured_at, id als zweites Kriterium, tage.ts), zweimal
// auf dieselbe Liste angewandt kommt also zwangsläufig dieselbe Reihenfolge
// heraus: die Kachel eines Moments ohne Ort und die Nadel eines Moments mit
// Ort zählen damit nachweislich in dieselbe Liste.
//
// Nicht über die Eingangsreihenfolge: `fetchRecapMomente` sortiert heute
// selbst (recapApi.ts), genau deshalb fiele es nirgends auf, wenn hier die
// Eingangsliste gezählt würde, bis eines Tages jemand diese Sortierung
// verschiebt. WER keinen Ort hat, entscheidet weiterhin allein
// `zuKartenPunkten`; hier wird nur nachgeschlagen, an welcher Stelle er steht.
function ohneOrtMitIndex(spielliste: RecapMoment[], ohneOrt: RecapMoment[]): OhneOrt[] {
  const ids = new Set(ohneOrt.map((m) => m.id));
  return sortMoments(spielliste)
    .map((moment, index) => ({ moment, index }))
    .filter((eintrag) => ids.has(eintrag.moment.id));
}

// Eine Zeile der Tagesliste (Task-9-Brief): «Alle Tage» oder ein einzelner
// Reisetag. Kein Primär-Button, DESIGN-LANGUAGE §4 lässt genau einen pro
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
        <View style={zeilenStile.zeile}>
          <View style={zeilenStile.text}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{beschriftung}</Text>
            {/* Der Ort des Tages steht nur da, wenn es einen gibt
                (tage.ortDesTages liefert sonst null), kein erfundener
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

// Eine Kachel der Momente ohne Ort, dieselbe Kachel-Liste wie in der
// Übersicht (Spec §5.8): quadratisch, Radius 12 (der Thumbnail-Wert aus
// DESIGN-LANGUAGE §3), drei pro Reihe. Kein Primär-Button an der Kachel und
// keiner im Sheet darum herum: es gibt genau einen pro Screen (§4), und den
// trägt das Moment-Sheet.
function OhneOrtKachel({
  eintrag, thumbUrl, stelle, onAnsehen,
}: {
  eintrag: OhneOrt;
  thumbUrl: string | null;
  stelle: number;
  onAnsehen: (eintrag: OhneOrt) => void;
}) {
  const { colors } = useTheme();
  const { moment } = eintrag;
  return (
    <Einblendung stelle={stelle}>
      <PressScale
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={momentLabel(moment)}
        testID={`ohne-ort-kachel-${moment.id}`}
        onPress={() => onAnsehen(eintrag)}
      >
        <View style={[styles.kachel, { backgroundColor: colors['bg-1'] }]}>
          {/* Ohne brauchbare URL bleibt die ruhige bg-1-Fläche stehen, kein
              Puls: es kommt nichts mehr (gleiche Unterscheidung wie im
              Nadel-Skelett und im Moment-Sheet). */}
          {thumbUrl !== null && (
            <Image
              testID={`ohne-ort-bild-${moment.id}`}
              source={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={motion.duration.fast}
            />
          )}
        </View>
      </PressScale>
    </Einblendung>
  );
}

// DESIGN-LANGUAGE §4: «Skeleton: bg-1-Blöcke, Opacity-Puls 0.6 ↔ 1.0 (kein
// Gradient-Shimmer)». Auf diesem Screen ist der Block die GANZE Fläche, die
// Karte füllt sie später ebenso (Spec §5.3), es gibt daneben nichts, was ein
// kleinerer Block andeuten könnte.
//
// MIT Rückweg, anders als SkelettScreen in uebersicht.tsx: die Übersicht ist
// eine Tab-Wurzel, die Karte ein per `push` erreichter Screen. Weder
// `urlVorrat.ts` noch `recapApi.ts` kennen Timeout oder AbortController,
// hängt eine der beiden Abfragen, bliebe hier sonst dauerhaft ein pulsender
// grauer Block stehen, aus dem nur die Tab-Leiste führt (Fixrunde 1,
// Important 2).
function KartenSkelett({ oben, onZurueck }: { oben: number; onZurueck: () => void }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    // §5: mit Reduced Motion pulst nichts, der Block steht still, aber
    // sichtbar (gleiche Entscheidung wie SkelettBlock in uebersicht.tsx).
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const puls = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    puls.start();
    return () => puls.stop();
  }, [opacity, reducedMotion]);

  return (
    <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
      <Animated.View
        testID="karte-skelett"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors['bg-1'], opacity }]}
      />
      {/* Derselbe Pfeil wie im Fehlerzweig, an derselben Stelle wie die
          Zurück-Pille der fertigen Karte, und nicht die Pille selbst: unter
          ihr liegt kein Foto und keine Karte, sondern eine helle bg-1-Fläche
          (DESIGN-LANGUAGE §1). */}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Zurück"
        onPress={onZurueck}
        style={[styles.zurueckHell, { top: oben }]}
      >
        <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
      </PressScale>
    </View>
  );
}

// Die Karte als zweite Lesart desselben Recaps (Spec §5.2): dieselbe Ebene
// wie uebersicht.tsx und player.tsx, damit `[id]` geteilt bleibt.
//
// Der Screen ist HELL, nicht Kino (Spec §5.3): er zeigt keine Medien im
// Vollbild, sondern ist ein Werkzeug zum Finden. Erst der Sprung in den
// Player wechselt ins Kino. Die Kartenkacheln selbst bringen ihre eigenen
// Farben mit, sie sind Inhalt wie ein Foto, nicht Interface (Entscheid R2);
// bindend bleibt, was DARAUF liegt.
export default function RecapKarte() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Screen-Rand 24 (DESIGN-LANGUAGE §3) als Basis, damit die Zurück-Pille
  // oben denselben Abstand hält wie links, auf Geräten mit Dynamic Island
  // schiebt useOberkante sie ohnehin darunter.
  const oben = useTopInset(spacing.screen);
  const reducedMotion = useReducedMotion();
  const karte = useRef<KartenFlaecheHandle>(null);
  // Der letzte Zoom-Versuch auf eine Gruppe, die Grundlage dafür, ob ein
  // weiterer noch etwas ausrichtet (features/karte/gruppenTipp.ts). Ein Ref
  // und kein State: der Wert ändert nichts am Bild, er beantwortet nur die
  // nächste Frage.
  const letzterZoom = useRef<ZoomVersuch | null>(null);
  // Die Fläche, auf der gruppiert wird. Die Karte liegt als absoluteFill über
  // dem ganzen Screen, das Fenster ist also ihr Mass. In der Höhe fehlt die
  // Tab-Bar; das verschiebt die 40-Punkte-Schwelle um wenige Prozent und
  // entscheidet nur über Nadeln, die ohnehin genau auf der Grenze liegen.
  // Nachzumessen wäre genauer, brächte aber einen ersten Durchlauf mit 0 × 0
  // mit sich, und der projizierte JEDEN Moment auf dieselbe Stelle.
  const { width: breite, height: hoehe } = useWindowDimensions();

  // Alles, was aus EINEM Ladevorgang der Momente stammt, in EINEM State und
  // mit der Reise, zu der es gehört (Fixrunde 1, Important 1).
  //
  // Zusammen, weil es zusammen entsteht und zusammen ungültig wird: eine
  // Phase ohne die zugehörigen Punkte (oder umgekehrt) gibt es nie.
  //
  // Mit Stempel, weil der Screen bei einem Wechsel der Reise-id gemountet
  // bleibt, und ohne ihn stand der Ladestand von t1 über t2, nicht einen
  // Frame lang, sondern die volle Ladedauer der neuen Reise: «Diese Reise hat
  // keine Orte» über einer Reise voller Orte, t1s Fehlertext samt «Nochmal
  // versuchen» über t2, t1s Leiste mit t1s Momenten. Und t1s Nadeln: ein
  // Tipp darauf öffnete ein Sheet, das bereits `tripId: t2` trägt, der
  // Wächter unten greift dann nicht mehr, und «Im Recap ansehen» schickte
  // den Player mit t1s Index in t2.
  const [ladestand, setLadestand] = useState<Ladestand>(() => ({
    tripId: id,
    phase: 'laedt',
    punkte: KEINE_PUNKTE,
    ohneOrt: KEINE_OHNE_ORT,
    unterwegs: 0,
    ohneBild: 0,
    fehlerText: null,
    nochmalHilft: true,
  }));
  // Nur für den Knopf im Fehlerzweig. Ein zweiter Anlauf setzt die Phase
  // bewusst NICHT auf 'laedt' zurück: der Fehlertext soll stehen bleiben,
  // solange der neue Versuch läuft, sonst blitzt zwischen zwei Fehlschlägen
  // ein Skelett auf, und niemand kann mehr lesen, was eigentlich los war.
  // Gleiches Muster wie `laedt` in uebersicht.tsx.
  const [nochmalLaeuft, setNochmalLaeuft] = useState(false);
  const [ausschnitt, setAusschnitt] = useState<Ausschnitt | null>(null);
  // Die Bild-URLs bleiben liegen, weil jede Nadel ihr eigenes Thumbnail
  // trägt (Spec §5.4), nicht nur, um damit zu filtern.
  const [urls, setUrls] = useState<ReadonlyMap<string, MediaUrl>>(KEINE_URLS);
  // Was das Sheet gerade zeigt, oder `null` für «keines offen». EIN Zustand
  // für beide Fälle, weil sie dieselbe Frage beantworten («welche Momente
  // stecken hinter dieser Nadel») und sich gegenseitig ausschliessen: ein Punkt
  // ist der einzelne Moment (Spec §5.7), mehrere sind die Liste einer Gruppe,
  // die sich nicht auseinanderzoomen lässt (Task-8-Brief, Schritt 2b).
  //
  // Mit der Reise, aus der es geöffnet wurde: der Screen bleibt bei einem
  // Wechsel der id gemountet (derselbe Grund, aus dem der Ladeweg unten seine
  // Zustände leert), und ein stehen gebliebenes Sheet zeigte danach einen
  // Moment der VORHERIGEN Reise, sein Knopf schickte den Player mit deren
  // Index in die neue, wo dieselbe Zahl auf einen ganz anderen Moment zeigt.
  //
  // `useReiseGebunden` haelt den Stempel und wirft den Wert beim Wechsel weg
  // (features/trips/useReiseGebunden.ts, samt der vollen Begruendung, warum
  // das beim RENDERN passieren muss und nicht in einem Effekt). Vier Zustaende
  // dieses Screens brauchen genau das, und viermal derselbe von Hand
  // geschriebene Vergleich war das Muster, an dem die Phase drei Runden
  // verloren hat.
  const [sheetPunkte, setSheetPunkte] = useTripBound<KartenPunkt[] | null>(id, null);
  // Die beiden Hälften, aus denen die Tagesnummern entstehen, jede mit der
  // Reise, aus der sie stammt. Sie kommen aus ZWEI getrennten Abfragen (siehe
  // die Ladewege unten), und eine Mischung aus zwei Reisen ergäbe Nummern, die
  // es in keiner der beiden gibt: das Startdatum der einen, die Momente der
  // anderen.
  //
  // Die Spielliste liegt hier zusätzlich zu `punkte`, weil sie die Momente
  // OHNE Ort mitträgt, `waehlbareTage` braucht sie für die Nummerierung
  // (Begründung dort).
  const [spielliste, setSpielliste] = useState<{ tripId: string; momente: RecapMoment[] } | null>(null);
  const [reiseStart, setReiseStart] = useState<{ tripId: string; startDate: string } | null>(null);
  // Der gewählte Tag, mit der Reise, in der er gewählt wurde, aus demselben
  // Grund wie beim Sheet oben: der Screen bleibt bei einem Wechsel der id
  // gemountet, und ein stehen gebliebener Filterstand öffnete die NÄCHSTE
  // Reise vorgefiltert auf einen Tag, den niemand gewählt hat.
  const [tagWahl, setTagWahl] = useTripBound<number | null>(id, null);
  // Das offene Tages-Sheet trägt seine Reise aus demselben Grund wie `sheet`,
  // und aus einem eigenen, schärferen: es listet die Tage DER REISE, aus der
  // es geöffnet wurde. Bliebe es bei einem Wechsel stehen, würde ein Tipp auf
  // «Tag 3» die neue Reise auf einen Tag filtern, den niemand in ihr gewählt
  // hat, und `waehleTag` schriebe dabei die NEUE id in die Wahl, der Wächter
  // unten käme also nie zum Zug.
  const [tageOffen, setTageOffen] = useTripBound(id, false);
  // Und das Sheet der Momente ohne Ort, aus genau denselben Gründen: seine
  // Kacheln tragen Indizes der Reise, aus der es geöffnet wurde.
  const [ohneOrtOffen, setOhneOrtOffen] = useTripBound(id, false);


  // Der Ladestand wird ABGELEITET statt beim Rendern zurückgesetzt, anders
  // als die vier Sheets/Filter darüber, und aus einem Grund, der nur für
  // geladene Daten gilt: bei t1 → t2 → t1 ist t1s Stand wieder der richtige.
  // Ein Zurücksetzen verwürfe ihn und zeigte für die Dauer eines erneuten
  // Ladevorgangs ein Skelett über einer Karte, die längst stimmt. Bei einem
  // Sheet ist es umgekehrt, dort öffnete sich sonst von selbst eines, das
  // niemand angetippt hat (Begründung oben).
  //
  // Gehört der Stand zu einer anderen Reise, ist diese hier schlicht noch
  // nicht geladen: 'laedt'. Genau das, was der Screen beim ersten Öffnen
  // auch zeigt.
  // EINE Bedingung für alle vier Werte, nicht vier einzelne. Vier wären zu
  // dritt nicht prüfbar: schon die Phase allein schickt den Screen ins
  // Skelett und kehrt vor jedem anderen Zweig zurück, ein zusätzlicher Test
  // an `punkte` oder `ohneOrt` liesse sich also ersatzlos streichen, ohne
  // dass eine Zusicherung fiele, genau die Art Bedingung, die später niemand
  // mehr prüfen kann (gleiche Überlegung wie bei `aufEinemFleck` in
  // `aufNadel`). So getrennt kann es einen halben Stand aber gar nicht geben:
  // entweder gilt der ganze Ladestand, oder es gilt der eines Screens, der
  // noch nichts geladen hat.
  const sichtbarerStand: Ladestand =
    ladestand.tripId === id
      ? ladestand
      : {
          tripId: id,
          phase: 'laedt',
          punkte: KEINE_PUNKTE,
          ohneOrt: KEINE_OHNE_ORT,
          unterwegs: 0,
          ohneBild: 0,
          fehlerText: null,
          nochmalHilft: true,
        };
  const { phase, punkte, ohneOrt, unterwegs, ohneBild, fehlerText, nochmalHilft } =
    sichtbarerStand;
  // Aus demselben Grund abgeleitet wie oben, und hier zusätzlich für den
  // Unterschied zwischen «kein Moment hat einen Ort» und «es gibt gar keine
  // Momente» gebraucht (siehe die beiden Leer-Zweige unten).
  const spiellisteJetzt =
    spielliste !== null && spielliste.tripId === id ? spielliste.momente : KEINE_MOMENTE;

  // Der Ladeanlauf, dessen Antwort noch zählt.
  //
  // Ein eigenes Objekt je Anlauf und nicht mehr das frühere `aktiv`-Flag:
  // seit «Nochmal versuchen» lässt sich der Ladeweg auch von Hand starten, es
  // können also ZWEI Anläufe gleichzeitig offen sein. Ein gemeinsames Flag
  // könnte nur «alle abbrechen» sagen, nicht «nur der neueste zählt», und
  // die langsamere der beiden Antworten überschriebe sonst die neuere.
  const anlauf = useRef({ gilt: true });

  // Die drei ungestempelten Nebenzustände eines Ladevorgangs, sie gehören
  // nach einem Fehlschlag geräumt. `punkte` und `ohneOrt` stehen bewusst
  // NICHT hier: die trägt der `Ladestand`, und der wird im selben Zug mit dem
  // Fehler gesetzt.
  const leereKarte = useCallback(() => {
    setUrls(KEINE_URLS);
    setAusschnitt(null);
    setSpielliste(null);
  }, []);

  const laden = useCallback(async () => {
    // Synchron, vor dem ersten Warten: der vorherige Anlauf zählt ab hier
    // nicht mehr, und der Effekt unten kann den eigenen direkt danach am Ref
    // abgreifen.
    anlauf.current.gilt = false;
    const meiner = { gilt: true };
    anlauf.current = meiner;
    // Der gemerkte Zoom-Versuch gehoert zu den Nadeln, die gleich ersetzt
    // werden. Eine Post-id kommt zwar in keiner zweiten Reise vor, der
    // Vergleich ginge also ohnehin ins Leere, stehen bleiben soll er
    // trotzdem nicht.
    letzterZoom.current = null;
    try {
      const [momente, vorratErgebnis] = await Promise.all([fetchRecapMoments(id), getPool(id)]);
      if (!meiner.gilt) return;

      // Beide Abfragen geben ihren Fehler als WERT zurück, und beide Texte
      // sind bereits deutsche Copy in Du-Form (recapApi.ts, urlVorrat.ts),
      // inklusive der beiden fachlichen 403 «Diese Reise ist noch versiegelt.»
      // und «Kein Zugriff auf diese Reise.», die `holeVorrat` zusätzlich als
      // `grund` maschinenlesbar macht.
      //
      // Vorrat vor Momenten, wie in uebersicht.tsx und player.tsx: ohne
      // Bild-URLs ist die Spielliste ohnehin leer (sie filtert auf
      // `urls.has`), der Vorrats-Fehler nennt also die Ursache, die weiter
      // oben liegt.
      const fehler = vorratErgebnis.error ?? momente.error;
      if (fehler !== null) {
        leereKarte();
        setLadestand({
          tripId: id,
          phase: 'fehler',
          punkte: KEINE_PUNKTE,
          ohneOrt: KEINE_OHNE_ORT,
          unterwegs: 0,
          ohneBild: 0,
          fehlerText: fehler,
          // Nur der Vorrat kennt einen `grund`, und er zählt nur, wenn SEIN
          // Fehler der angezeigte ist (siehe die Reihenfolge oben). Der
          // Momente-Fehler ist immer eine Momentaufnahme, dort ist ein
          // zweiter Versuch die richtige Handlung.
          nochmalHilft:
            vorratErgebnis.error !== null ? retryHelps(vorratErgebnis.grund) : true,
        });
        return;
      }

      // DIE Stelle, an der ein Fehler still bliebe: die Karte muss dieselbe
      // Liste zählen wie der Player. `punkt.index` geht später als `start`
      // an ihn, und `parseStartIndex` zählt dort in genau diese gefilterte
      // Liste (player.tsx:503-527); uebersicht.tsx:316-317 baut ihr
      // `indexById` aus derselben Filterung. Gäbe dieser Screen die rohe
      // Momente-Liste herein, verschöbe jeder noch hochladende Moment alles
      // dahinter, die Nadeln sässen weiterhin richtig, aber der Sprung
      // landete beim falschen Moment, und das merkt niemand, ausser er
      // zählt nach.
      //
      // BEIDE Bedingungen sind nötig, keine ist durch die andere gedeckt:
      // dass `media-urls` serverseitig nur für hochgeladene Momente
      // signiert (und `urls.has` deshalb heute dasselbe aussortiert), ist
      // eine Eigenschaft einer ANDEREN Datei, die dieser Screen nicht
      // kennt und auf die er sich nicht verlassen darf.
      const vorratUrls = vorratErgebnis.vorrat?.urls ?? KEINE_URLS;
      const uploaded = momente.data.filter((m) => m.upload_status === 'uploaded');
      const mitBild = uploaded.filter((m) => vorratUrls.has(m.id));
      const { punkte: p, ohneOrt: o } = zuKartenPunkten(mitBild);
      setUrls(vorratUrls);
      setAusschnitt(ausschnittFuer(p));
      setSpielliste({ tripId: id, momente: mitBild });
      setLadestand({
        tripId: id,
        phase: 'fertig',
        punkte: p,
        ohneOrt: ohneOrtMitIndex(mitBild, o),
        // Die Filterung darueber bleibt, wie sie ist, `punkt.index` muss zur
        // Spielliste passen, sonst startet der Player am falschen Moment. Was
        // fehlte, ist die Auskunft darueber, WAS dabei herausfaellt.
        unterwegs: momente.data.length - uploaded.length,
        ohneBild: uploaded.length - mitBild.length,
        fehlerText: null,
        nochmalHilft: true,
      });
    } catch (wurf: unknown) {
      // fetchRecapMomente und holeVorrat geben Fehler als WERT zurück statt
      // zu werfen, aber "wirft normalerweise nicht" ist keine Zusicherung,
      // die diese Kette tragen kann. Wirft eine der beiden doch, wäre die
      // Ablehnung ohne dieses `catch` unbehandelt (Fixrunde 1). Es gibt dann
      // keinen Text vom Server, also springt WURF_TEXT ein, und der Fehler
      // geht zusätzlich an den Fehlermelder (ohne DSN ein No-Op, siehe
      // lib/fehlermelder.ts), weil nur er die technische Ursache kennt.
      if (!meiner.gilt) return;
      reportError(wurf, { screen: 'recap/karte', tripId: id, ladeweg: 'momente' });
      leereKarte();
      setLadestand({
        tripId: id,
        phase: 'fehler',
        punkte: KEINE_PUNKTE,
        ohneOrt: KEINE_OHNE_ORT,
        unterwegs: 0,
        ohneBild: 0,
        fehlerText: WURF_TEXT,
        nochmalHilft: true,
      });
    }
  }, [id, leereKarte]);

  useEffect(() => {
    // `laden` setzt seinen Zustand erst NACH dem ersten `await` (die Zeilen
    // davor berühren nur ein Ref), die kaskadierenden Renders, vor denen die
    // Regel warnt, gibt es hier also nicht. Der Ladeweg muss ein
    // `useCallback` sein, damit «Nochmal versuchen» ihn wiederverwenden kann,
    // statt eine zweite Kopie desselben Wegs zu pflegen. Gleiche Stelle und
    // gleicher Grund in player.tsx und uebersicht.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void laden();
    // Den gerade gestarteten Anlauf HIER festhalten, nicht erst im Cleanup:
    // `laden` hängt ihn synchron ein, bevor es zum ersten Mal wartet (siehe
    // dort), der Wert steht in dieser Zeile also fest. Im Cleanup gelesen
    // wäre `anlauf.current` bei einem Wechsel der Reise-id längst ein
    // anderer, react-hooks/exhaustive-deps warnt zu Recht genau davor.
    const meiner = anlauf.current;
    // Ohne das schriebe eine spät eintreffende Antwort der VORHERIGEN Reise
    // ihre Nadeln in die neue.
    return () => {
      meiner.gilt = false;
    };
  }, [laden]);

  const nochmal = useCallback(async () => {
    setNochmalLaeuft(true);
    await laden();
    setNochmalLaeuft(false);
  }, [laden]);

  // Die Reise wird GETRENNT geladen, nicht im `Promise.all` oben.
  //
  // Gebraucht wird von ihr allein `start_date`: die Tagesnummern zählen ab dem
  // Startdatum DER REISE (tage.ts), nicht ab dem ersten Moment, uebersicht.tsx
  // und player.tsx lesen es an derselben Stelle. Ohne diese Abfrage müsste
  // dieser Screen die Tage aus den Momenten heraus raten und zeigte für
  // dieselbe Reise andere Nummern als die Übersicht.
  //
  // Aber: der Filter ist Beiwerk, die Nadeln SIND der Screen, und in einem
  // gemeinsamen `Promise.all` wäre das nur für den Fehlerpfad wahr, nicht für
  // den Zeitpfad. Bis der Ausschnitt steht, wird die Karte gar nicht erst
  // gemountet; die Nadeln hingen also an einer Abfrage, die für sie nichts
  // beiträgt. Und `fetchTrip` ist nicht eine Abfrage, sondern zwei: es wartet
  // intern auf die rpc `my_post_counts` mit (tripsApi.ts), ein hängender
  // Momente-Zähler liesse bei sonst intaktem Netz eine leere Fläche stehen,
  // obwohl Momente und URLs längst da sind.
  useEffect(() => {
    let aktiv = true;
    void fetchTrip(id)
      .then(({ data: reise, error }) => {
        if (!aktiv) return;
        // Kein `start_date` (Ladefehler, oder es gibt die Reise nicht mehr):
        // dann fehlt der Filter, und sonst nichts.
        //
        // Sichtbar wird der Fehler bewusst NICHT. Die Nadeln, die Linie und
        // der Sprung in den Player stehen vollständig, eine Fehlermeldung
        // über einer intakten Karte behauptete, hier sei etwas kaputt, und
        // stritte ausserdem mit der Leiste unten um denselben Platz. Was
        // fehlt, ist eine Pille, die es sonst nur bei mehr als einem
        // wählbaren Tag überhaupt gibt.
        //
        // Spurlos verschwinden darf er trotzdem nicht: bis Task 10 war das
        // der einzige Ladepfad dieses Screens ohne jede Meldung. Der
        // Fehlermelder ist die einzige Stelle, an der «der Filter fehlt, weil
        // die Reise-Abfrage ausgefallen ist» von «diese Reise hat nur einen
        // Tag mit Nadeln» zu unterscheiden ist, von aussen sehen beide
        // gleich aus.
        if (error !== null) {
          reportError(new Error(error), { screen: 'recap/karte', tripId: id, ladeweg: 'reise' });
        }
        setReiseStart(reise ? { tripId: id, startDate: reise.start_date } : null);
      })
      // Gleicher Grund wie beim Ladeweg darüber: `fetchTrip` gibt Fehler als
      // WERT zurück, aber «wirft normalerweise nicht» trägt keine Kette.
      .catch((fehler: unknown) => {
        if (!aktiv) return;
        // Mit `ladeweg` wie der Wert-Pfad darüber: ohne ihn wäre ein
        // werfendes `fetchTrip` im Fehlermelder nicht von einem werfenden
        // `fetchRecapMomente` zu unterscheiden.
        reportError(fehler, { screen: 'recap/karte', tripId: id, ladeweg: 'reise' });
        setReiseStart(null);
      });
    return () => {
      aktiv = false;
    };
  }, [id]);

  // Der sichtbare Ausschnitt wandert bei jeder Kartenbewegung in den State:
  // Task 7 gruppiert Nadeln nach ihrem Abstand in BILDSCHIRMpunkten und
  // braucht dafür den aktuellen Zoom, nicht den anfänglichen.
  const merkeAusschnitt = useCallback((sichtbar: Ausschnitt) => setAusschnitt(sichtbar), []);

  // Die wählbaren Tage, erst, wenn BEIDE Hälften zur gerade angezeigten Reise
  // gehören. Die Ladewege laufen unabhängig, es gibt also ein Fenster, in dem
  // das Startdatum der neuen Reise schon da ist und die Momente noch die der
  // vorherigen sind; die Nummern daraus gäbe es in keiner der beiden Reisen.
  //
  // `useMemo` und nicht ein State im Ladeweg: die Rechnung hängt an genau
  // diesen drei geladenen Werten, und die ändern sich einmal pro Ladevorgang,
  // dieser Screen rendert aber bei jeder Kartenbewegung neu.
  const alleTage = useMemo(() => {
    if (spiellisteJetzt.length === 0) return [];
    if (reiseStart === null || reiseStart.tripId !== id) return [];
    return groupByDays(spiellisteJetzt, reiseStart.startDate);
  }, [spiellisteJetzt, reiseStart, id]);

  const tage = useMemo(() => waehlbareTage(alleTage, punkte), [alleTage, punkte]);

  // Ob die angebotenen Tagesnummern eine Lücke haben, genau dann, wenn
  // `waehlbareTage` etwas weggelassen hat. Nicht an den Nummern selbst
  // abgelesen: die Übersicht zeigt dieselben Nummern, und was hier fehlt,
  // fehlt AUS DIESEM Grund, nicht aus irgendeinem.
  const tageLuecke = alleTage.length > tage.length;

  // Der gewählte Tag als Objekt statt als blosse Nummer, und aus `tage`
  // heraus gesucht, nicht aus `tagWahl` heraus geglaubt: nach einem
  // Neuladen kann der gewählte Tag verschwunden sein (ein Moment ist
  // dazugekommen und hat die Nummerierung verschoben, oder der letzte Moment
  // dieses Tages hat seinen Ort verloren). Wird er nicht mehr gefunden, gilt
  // wieder «Alle Tage», Pille, Nadeln, Linie und Ausschnitt leiten ALLE aus
  // diesem einen Wert ab und können deshalb gar nicht auseinanderlaufen.
  const gewaehlterTag = useMemo(
    () => tage.find((t) => t.nummer === tagWahl) ?? null,
    [tage, tagWahl]
  );

  // Was die Karte zeigt. Gefiltert wird auf den FERTIGEN Punkten, siehe
  // `punkteAmTag`: der Index darin zeigt weiterhin in die ganze Reise.
  const sichtbarePunkte = useMemo(() => punkteAmTag(punkte, gewaehlterTag), [punkte, gewaehlterTag]);

  // Die Linie der Reise (Spec K3/§5.6). `punkte` kommt aus zuKartenPunkten
  // bereits nach `captured_at` sortiert, hier wird bewusst NICHT noch einmal
  // sortiert: die Linie zeigt, in welcher Reihenfolge aufgenommen wurde, nie,
  // in welcher hochgeladen wurde.
  //
  // `useMemo` ist hier nicht Feinschliff: `merkeAusschnitt` lässt den Screen
  // bei jeder Kartenbewegung neu rendern, und ein bei jedem Rendern neues
  // Koordinaten-Array schickte die Polyline jedes Mal erneut über die Brücke.
  // Über `sichtbarePunkte`, nicht über `punkte`: eine Linie, die bei einem
  // gewählten Tag weiter zum nächsten zeichnete, behauptete eine Bewegung, die
  // an diesem Tag nicht stattgefunden hat. An der Sortierung ändert das
  // nichts, `punkteAmTag` filtert nur, es sortiert nicht um.
  const linie = useMemo(
    () => sichtbarePunkte.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [sichtbarePunkte]
  );

  // Nadeln, die einander sonst verdecken, teilen sich eine (Spec §5.5).
  // Gruppiert wird nach dem Abstand auf DEM GERADE SICHTBAREN Ausschnitt,
  // darum steht `ausschnitt` in den Abhängigkeiten und nicht bloss der
  // Anfangswert: beim Hineinzoomen fällt eine Gruppe von selbst auseinander.
  //
  // `useMemo` bindet die Rechnung an genau die vier Werte, die ihr Ergebnis
  // bestimmen. `gruppiere` vergleicht jeden Punkt mit jeder bisherigen Gruppe,
  // und der Screen rendert bei jeder Kartenbewegung neu, dazu bei jedem
  // Zustand, der mit der Karte nichts zu tun hat (die eintreffenden Bild-URLs
  // heute, das Moment-Sheet in Task 8). Ohne die Bindung liefe sie bei jedem
  // dieser Renders mit. Gespart wird die RECHNUNG, nicht ein Neuaufbau der
  // Nadeln: die hängen an ihrem Schlüssel und ihren Props und blieben auch
  // ohne das Memo stehen.
  const gruppen = useMemo(
    () => (ausschnitt ? gruppiere(sichtbarePunkte, ausschnitt, breite, hoehe) : []),
    [sichtbarePunkte, ausschnitt, breite, hoehe]
  );

  // Das Bild einer Nadel, als Nachschlagefunktion statt als fertige Liste:
  // die Fläche fragt für den Anker jeder Gruppe nach, und welche Gruppen es
  // gibt, weiss sie selbst besser als dieser Screen. `useCallback` bindet sie
  // an den Vorrat, nicht an jedes Rendern: der Screen rendert bei jeder
  // Kartenbewegung neu, die URLs ändern sich einmal pro Ladevorgang.
  const thumbFuer = useCallback((postId: string) => nadelBild(urls, postId), [urls]);

  // Die Kamera bewegt DIE FLÄCHE, nicht dieser Screen: `zeige` ist seit Task
  // 14 das imperative Handle von `KartenFlaeche` (features/karte/typen.ts).
  // Dort sitzt auch die Reduced-Motion-Weiche, sie gehört zur Technik der
  // jeweiligen Karte (animateToRegion/setRegion nativ, flyTo/setView im
  // Browser), nicht zum Screen. Für diesen Screen bleibt es DIE eine Stelle,
  // über die jede Kamerabewegung geht (Spec K12): der Gruppen-Zoom und der
  // Tagesfilter rufen beide hierher.
  //
  // Der Erststart geht bewusst NICHT hier durch: die Karte wird überhaupt erst
  // gemountet, wenn der Ausschnitt feststeht, und öffnet direkt dort. Es gibt
  // nichts, wovon aus gefahren würde.
  const zeige = useCallback((ziel: Ausschnitt) => karte.current?.zeige(ziel), []);

  // Was ein Tipp auf eine Gruppe zusätzlich wissen muss, in einem Ref statt in
  // den Abhängigkeiten von `aufGruppe`. Hinge die Funktion an `ausschnitt`,
  // bekäme jede Nadel bei JEDER Kartenbewegung ein neues `onPress` (die Fläche
  // reicht `aufGruppe` an alle Nadeln durch); das `memo` am Marker
  // (KartenNadel.tsx) wäre wirkungslos, und jede Nadel schickte ihre Koordinate
  // erneut über die Brücke, obwohl sich an ihr nichts geändert hat.
  //
  // `useLayoutEffect`, nicht `useEffect`: ein passiver Effekt läuft erst NACH
  // dem Commit, und in dem Fenster dazwischen liest ein Tipp noch den alten
  // Stand. Dieselbe Überlegung steht in KartenFlaeche.tsx an dem Ref, das die
  // GRUPPEN hält, dort ist sie in karte.test.tsx festgenagelt («ein Tipp
  // unmittelbar nach dem Zerfall einer Gruppe wird nicht verschluckt»).
  const stand = useRef<{ ausschnitt: Ausschnitt | null }>({ ausschnitt });
  useLayoutEffect(() => {
    stand.current = { ausschnitt };
  }, [ausschnitt]);

  // Was der Tipp auf diese Gruppe tun WIRD, für die Beschriftung, die
  // VoiceOver vorliest. Dieselbe Frage, dieselbe Antwort, dasselbe
  // `zoomAussichtslos` wie im Tipp darunter, nur ohne die Folgen.
  //
  // Sie steht hier und nicht in der Fläche, obwohl die die Nadeln zeichnet:
  // sie hängt am Verlauf (welche Gruppe zuletzt vergeblich angefahren wurde),
  // und der liegt in `letzterZoom`. Die Fläche kannte bis hierher nur die
  // halbe Regel, bitgleiche Koordinaten, und sagte an einer festgefahrenen
  // Gruppe weiter «heranzoomen», obwohl der Tipp längst das Sheet öffnete.
  //
  // Der Ausschnitt kommt hier aus dem STATE, nicht aus `stand.current` wie im
  // Tipp darunter, und das ist kein Versehen: diese Frage wird beim RENDERN
  // gestellt, und der Layout-Effekt, der das Ref nachzieht, läuft erst danach.
  // Mit dem Ref trug die erste Nadel jeder Reise das Label für «kein
  // Ausschnitt bekannt», also immer «heranzoomen», auch auf einem Fleck. Vom
  // Screen-Test gefunden, nicht hergeleitet. Beim Tipp ist es umgekehrt: er
  // kommt aus einer Closure, die den Stand von damals sähe, deshalb liest er
  // das Ref.
  const oeffnetSheet = useCallback(
    (gruppe: Gruppe) => {
      // Ohne Ausschnitt gibt es keine Nadeln, die beschriftet werden könnten
      // (siehe `gruppen` oben). Für den Typ trotzdem nötig.
      if (!ausschnitt) return false;
      return zoomAussichtslos(gruppe, ausschnitt, letzterZoom.current);
    },
    [ausschnitt]
  );


  // Ein Tipp auf eine Gruppe fährt in sie hinein, solange das etwas ausrichtet
  // (Spec §5.5): wer auf der Karte sucht, will die Karte benutzen. Erst wo
  // Zoomen nichts mehr bringt, öffnet sich das Sheet, siehe unten.
  //
  // WELCHE Gruppe getippt wurde, hat die Fläche bereits beantwortet: der Marker
  // meldet ihr den Anker, sie sucht die Gruppe in ihrem eigenen Stand
  // (KartenFlaeche.tsx). Hier steht nur noch, was daraus folgt.
  const aufGruppe = useCallback(
    (gruppe: Gruppe) => {
      const { ausschnitt: sichtbar } = stand.current;

      // Unerreichbar, aber für den Typ nötig: `gruppen` wird nur berechnet,
      // wenn `ausschnitt` steht (siehe useMemo oben). Ohne Ausschnitt gäbe es
      // also gar keine Nadel, die getippt werden könnte.
      if (!sichtbar) return;

      // Ins Sheet führt EINE Frage: richtet Zoomen hier überhaupt noch etwas
      // aus? Sie deckt alle Fälle ab, in denen die Antwort nein ist,
      //
      // - den häufigen: eine einzelne Nadel. Ein Punkt liegt trivialerweise
      //   auf einem Fleck, und dort steht der Moment selbst (Spec §5.7). Die
      //   Karte bewegt sich dabei NICHT: der Moment soll nicht unter dem Sheet
      //   wegrutschen, während man ihn liest.
      // - den seltenen: eine Gruppe, deren Momente alle auf derselben
      //   Koordinate liegen. Sie fällt durch keine Zoomstufe auseinander.
      // - und den, der bis zur Merge-Fixrunde fehlte: eine Gruppe, die zwar
      //   verschiedene Koordinaten hat, aber so eng beieinander, dass die
      //   letzte Zoomstufe der Karte sie nicht mehr trennt. Bei drei bis acht
      //   Metern GPS-Versatz ist das der Normalfall, nicht der Ausnahmefall.
      //
      // Beantwortet wird sie in features/karte/gruppenTipp.ts, gemeinsam mit
      // dem geteilten Recap (teilen/[token].tsx), samt der vollen Begründung.
      //
      // Bewusst nicht zusätzlich `punkte.length === 1` davorgesetzt: die
      // Abfrage wäre vom Rest gedeckt und liesse sich ersatzlos streichen,
      // ohne dass eine Zusicherung fiele, genau die Art Bedingung, die
      // später niemand mehr prüfen kann.
      if (zoomAussichtslos(gruppe, sichtbar, letzterZoom.current)) {
        // Wie in `oeffneTagesfilter`: es ist immer höchstens EIN Sheet offen
        // (Begründung dort), und deshalb werden BEIDE anderen geräumt, nicht
        // nur das der Momente ohne Ort. Bis zur §9-Durchsicht (Task 12) fehlte
        // `setTageSheet(null)` hier, und die Zusicherung galt nur in eine
        // Richtung: der Tagesfilter machte das Moment-Sheet zu, der Tipp auf
        // eine Nadel liess das Tages-Sheet stehen.
        //
        // Zwei offene Sheets sind nicht bloss unordentlich: jedes bringt einen
        // eigenen Backdrop mit (`backdrop`, tokens.ts, rgba(0,0,0,0.4)), zwei
        // davon übereinander dunkeln auf rund 0.64 ab. Dieser Wert stammt aus
        // keinem Token mehr (DESIGN-LANGUAGE §9), und dazu lägen zwei
        // `shadow-3`-Panels aufeinander, von denen ein Wisch nur das obere
        // schliesst. Dass der Backdrop des Tages-Sheets diesen Tipp auf dem
        // Gerät ohnehin abfängt, ist genau das Argument, das
        // `oeffneTagesfilter` für die Gegenrichtung ausdrücklich NICHT gelten
        // lässt: der Zustand soll eindeutig sein, statt an der
        // Trefferreihenfolge zu hängen.
        setTageOffen(false);
        setOhneOrtOffen(false);
        setSheetPunkte(gruppe.punkte);
        return;
      }

      const ziel = zoomZiel(gruppe, sichtbar);
      // Unerreichbar (eine Gruppe hat mindestens einen Punkt), aber der Typ
      // von `ausschnittFuer` verlangt die Behandlung.
      if (!ziel) return;

      // Was diese Fahrt VERSUCHT hat, die Grundlage der Antwort beim nächsten
      // Tipp auf dieselbe Gruppe. Bleibt der sichtbare Ausschnitt danach
      // derselbe, hat die Karte ihre letzte Zoomstufe erreicht.
      letzterZoom.current = { ankerId: gruppe.anker.moment.id, vorher: sichtbar };

      // DESIGN-LANGUAGE §5 nennt für «Zoom» selection-Haptik, dieselbe
      // Meldung wie beim Tab-Wechsel. Sie gehört an den Zoom selbst, nicht in
      // `zeige`: der Tagesfilter (Task 9) fährt aus einem anderen Anlass und
      // bringt seine eigene Regel mit. `.catch`, weil ein abgelehntes Promise
      // aus einem nativen Modul sonst als unbehandelte Ablehnung zählt,
      // gleiches Muster wie player.tsx.
      void Haptics.selectionAsync().catch(() => {});

      zeige(ziel);
    },
    [zeige, id]
  );

  // Der Weg in den Player (Spec §5.7), für ALLE drei Sheets dieses Screens
  // derselbe. Die Union statt eines blossen `{ index: number }`: sonst passte
  // JEDE Zahl namens `index` hierher, auch eine Stelle innerhalb von
  // `ohneOrt` oder innerhalb einer Gruppe. Der Typ ist an dieser einen Stelle
  // der letzte Hinweis zur Übersetzungszeit darauf, woher der Wert stammen
  // darf. `index` zählt über die SPIELLISTE, die der Ladeweg
  // oben filtert, dieselbe, die der Player aufbaut, und `parseStartIndex`
  // zählt dort in genau sie (player.tsx:503-527). Nie der Index innerhalb von
  // `punkte` (der überspringt die Momente ohne Ort), nie der innerhalb der
  // Gruppe und nie der innerhalb von `ohneOrt`: alle drei sässen scheinbar
  // richtig und starteten den Player beim falschen Moment.
  //
  // Das Sheet bleibt dabei bewusst offen: es zu schliessen hiesse, es während
  // des Übergangs in den Player wegblitzen zu lassen, und wer zurückkommt,
  // findet die Stelle wieder, an der er war.
  const zumPlayer = useCallback(
    (eintrag: KartenPunkt | OhneOrt) => {
      router.push({ pathname: '/recap/[id]/player', params: { id, start: String(eintrag.index) } });
    },
    [router, id]
  );

  // Die Sätze über das, was diese Karte gar nicht hergibt. Als Liste, weil
  // beide Lagen gleichzeitig vorkommen können, und ohne useMemo: zwei Zahlen
  // zu vergleichen kostet weniger als der Vergleich, der das Ergebnis
  // aufheben würde.
  const fehlenGanz: string[] = [];
  if (unterwegs > 0) fehlenGanz.push(unterwegsText(unterwegs));
  if (ohneBild > 0) fehlenGanz.push(ohneBildText(ohneBild));

  // Was die Pille zeigt und was VoiceOver ansagt, eine Quelle für beides.
  const filterStand = gewaehlterTag ? `Tag ${gewaehlterTag.nummer}` : 'Alle Tage';

  const oeffneTagesfilter = () => {
    // KEINE gestapelten Sheets: `Sheet` bringt jeweils einen eigenen Backdrop
    // über den ganzen Screen mit (Sheet.tsx), zwei übereinander ergäben eine
    // doppelt abgedunkelte Karte, und ein Wisch nach unten schlösse nur das
    // obere und liesse ein Panel zurück, das niemand mehr erwartet.
    //
    // (Nicht der Grund: die Zahl der Primär-Buttons. Die Tagesliste hat per
    // Konstruktion keinen, zwei offene Sheets hätten also weiterhin genau
    // einen, DESIGN-LANGUAGE §4 ist hier nicht verletzt und trägt diese
    // Entscheidung nicht.)
    //
    // Auf dem Gerät fängt der Backdrop des offenen Moment-Sheets diesen Tipp
    // ohnehin ab; dass der Zustand hier trotzdem eindeutig gemacht wird,
    // kostet nichts und macht die Zusicherung prüfbar, statt sie der
    // Trefferreihenfolge zu überlassen.
    setSheetPunkte(null);
    setOhneOrtOffen(false);
    setTageOffen(true);
  };

  // Aus demselben Grund und auf demselben Weg.
  const oeffneOhneOrt = () => {
    setSheetPunkte(null);
    setTageOffen(false);
    setOhneOrtOffen(true);
  };

  const waehleTag = (tag: RecapDay | null) => {
    setTageOffen(false);
    setTagWahl(tag?.nummer ?? null);

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
    // überhaupt Nadeln da sind. Ohne Ziel bleibt die Kamera stehen, ein
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

  // ---------------------------------------------------------------------
  // Die drei Zustände ohne Karte. Sie sahen bis Task 10 alle gleich aus,
  // eine weisse Fläche mit Zurück-Pille, weil alle drei in `punkte = []`
  // und `ausschnitt = null` enden.
  // ---------------------------------------------------------------------

  if (phase === 'laedt') return <KartenSkelett oben={oben} onZurueck={zurueck} />;

  if (phase === 'fehler') {
    return (
      <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: oben }]}>
          {/* Der Rückweg auf einem Screen OHNE Karte. Die translucente Pille
              taugt dafür nicht: sie ist für eine Fremdfläche gemacht
              (DESIGN-LANGUAGE §1), ohne Karte läge sie auf reinem Weiss und
              wäre der einzige Kino-Fleck eines hellen Screens. Also dieselbe
              Kopfzeile wie in uebersicht.tsx, mit derselben Beschriftung wie
              die Pille. */}
          <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={zurueck}>
            <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
          {/* Der Text kommt vom Ladeweg und nennt bereits Ursache und Lösung
              in Du-Form (recapApi.ts, urlVorrat.ts), hier wird nichts
              dazuerfunden. */}
          <Text style={[type.body, { color: colors.danger }]}>{fehlerText}</Text>
          {/* Der einzige Primär-Button dieses Zustands (DESIGN-LANGUAGE §4):
              der Rückweg oben ist ein Icon, kein Knopf. Und er steht nur da,
              wo ein zweiter Versuch etwas ausrichten kann
              (features/recap/urlVorrat.ts): unter «Diese Reise ist noch
              versiegelt.» wäre er ein Versprechen ohne Deckung, und der
              Zustand hat dann gar keinen Primär-Button, was §4 ausdrücklich
              zulässt. */}
          {nochmalHilft && (
            <Button
              variant="primary"
              label="Nochmal versuchen"
              onPress={() => void nochmal()}
              loading={nochmalLaeuft}
            />
          )}
        </View>
      </View>
    );
  }

  // «Es gibt gar keine Momente» ist NICHT «kein Moment hat einen Ort»
  // (Fixrunde 1, Important 3). Eine Reise, in der niemand eingesendet hat,
  // oder in der alle Uploads noch unterwegs sind, bekäme sonst den Satz
  // über die Ortungsdienste zu lesen: eine Behauptung über etwas, das nie
  // stattgefunden hat.
  //
  // Wortgleich zu uebersicht.tsx und player.tsx (Phase 'leer'), damit
  // dieselbe Reise auf allen drei Screens dasselbe sagt. Ohne zweite Zeile:
  // ob die Momente noch kommen oder nie kamen, weiss dieser Screen nicht, und
  // eine Vermutung wäre wieder eine Behauptung.
  if (spiellisteJetzt.length === 0) {
    return (
      <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: oben }]}>
          <Text style={[type.h1, { color: colors['text-1'] }]}>{LEER_OHNE_MOMENTE}</Text>
          <Button variant="primary" label="Zurück zur Übersicht" onPress={zurueck} />
        </View>
      </View>
    );
  }

  // Kein leerer Kartenausschnitt über dem Atlantik (Spec K9): `ausschnittFuer`
  // liefert `null`, wenn kein einziger Moment einen Ort hat, statt einer
  // erfundenen Region steht hier die Erklärung aus Spec §5.9.
  //
  // Keine Kopfzeile und kein zweiter Weg hinaus: der eine Knopf IST der
  // Rückweg, ein Pfeil daneben täte dasselbe noch einmal. Er ruft `zurueck`
  // und nicht ein eigenes `replace`, beide Zweige davon landen auf der
  // Übersicht dieser Reise (von woanders kommt man auf die Karte nicht), und
  // `back()` behält dabei den Stapel, statt ihn zu überschreiben.
  //
  // Auch keine Leiste «N Momente ohne Ort», obwohl HIER jeder Moment einen
  // hat: sie ist eine Pille für die Kartenfläche, und was sie sagt, sagt die
  // Erklärung darüber bereits für die ganze Reise. Erreichbar bleiben die
  // Momente über die Übersicht, die zeigt sie alle.
  if (punkte.length === 0) {
    return (
      <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: oben }]}>
          <View style={styles.textBlock}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>{LEER_TITEL}</Text>
            <Text style={[type.body, { color: colors['text-2'] }]}>{LEER_ERKLAERUNG}</Text>
          </View>
          <Button variant="primary" label="Zurück zur Übersicht" onPress={zurueck} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
      {/* `ausschnitt` steht hier immer, er wird aus denselben `punkte`
          berechnet, deren Zahl den Leer-Zustand oben abgefangen hat. Die
          Abfrage bleibt trotzdem stehen, weil der Typ sie verlangt. */}
      {ausschnitt && (
        <KartenFlaeche
          ref={karte}
          initialerAusschnitt={ausschnitt}
          gruppen={gruppen}
          linie={linie}
          thumbFuer={thumbFuer}
          aufGruppe={aufGruppe}
          oeffnetSheet={oeffnetSheet}
          aufAusschnitt={merkeAusschnitt}
          reducedMotion={reducedMotion}
        />
      )}

      {/* Die Karte hat keinen eigenen Kopf, sie soll gross sein (Spec §5.3)
         , der einzige Rückweg ist diese translucente Pille über der
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
          Wie dort eine translucente Pille mit Blur, sie liegt auf der
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
          // zeigt nur den Stand, ohne diese Ergänzung wüsste per VoiceOver
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

      {/* Die Momente, die keine Nadel tragen können (Spec §5.8). Jede echte
          Reise hat sie, ohne Berechtigung, in Innenräumen oder bei
          Zeitüberschreitung liefert `ortBestimmen` bewusst drei `null`
          (features/moments/ortUndZeit.ts), und sie dürfen auf der Karte
          nicht einfach fehlen, ohne dass es jemand merkt.

          Kein Primär-Button, sondern eine translucente Pille wie die beiden
          oben: sie liegt auf der Kartenfläche (DESIGN-LANGUAGE §1), und den
          einen Primär-Button dieses Screens trägt das Moment-Sheet (§4).

          Die Zahl gilt für die GANZE Reise, auch bei gewähltem Tag: ein
          Moment ohne Ort liegt auf keinem Tag DER KARTE, und ein Tag, dessen
          Momente alle ohne Ort sind, steht gar nicht erst zur Wahl (siehe
          `waehlbareTage`). Eine mitgefilterte Leiste liesse genau diese
          Momente auf keinem Weg mehr erreichbar. */}
      {(ohneOrt.length > 0 || fehlenGanz.length > 0) && (
        // Die Zentrierung trägt ein eigener Rahmen, nicht die PressScale
        // selbst: die zöge sich über die volle Breite und finge damit jeden
        // Tipp links und rechts der Pille ab, auf einer Karte wäre das ein
        // 44 Punkte hohes Band, in dem sich nicht mehr schieben liesse.
        // `box-none` lässt Tipps durch den Rahmen hindurch, nur die Pille
        // selbst nimmt sie an.
        <View style={styles.leiste} pointerEvents="box-none">
          {/* Die Momente, die diese Karte gar nicht hergibt (Fixrunde nach dem
              Abschluss-Review). Rein informativ und deshalb `pointerEvents:
              none`: einen Weg zu ihnen gibt es von hier aus nicht, sie stehen
              in keiner Spielliste, also führt auch kein Index zu ihnen. Ohne
              diese Zeile stimmte die Rechnung auf dem Screen nicht mehr:
              Nadeln plus «N Momente ohne Ort» ergäben weniger als die Reise
              hat, und niemand sähe warum. */}
          {fehlenGanz.length > 0 && (
            <Pille testID="karte-fehlen-ganz" style={styles.fehlenPille} pointerEvents="none">
              {fehlenGanz.map((satz) => (
                <Text key={satz} style={[type.secondary, { color: cinema['text-1'] }]}>
                  {satz}
                </Text>
              ))}
            </Pille>
          )}
          {ohneOrt.length > 0 && (
            <PressScale
              testID="karte-ohne-ort"
              accessibilityRole="button"
              // Die Pille zeigt die Zahl, das Label sagt zusätzlich, was ein
              // Tipp tut, wortgleich zur Nadel einer unteilbaren Gruppe.
              accessibilityLabel={`${ohneOrtText(ohneOrt.length)} ansehen`}
              onPress={oeffneOhneOrt}
            >
              <Pille style={styles.ohneOrtPille}>
                <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                  {ohneOrtText(ohneOrt.length)}
                </Text>
              </Pille>
            </PressScale>
          )}
        </View>
      )}

      {/* Wie beim Moment-Sheet erst gemountet, wenn es offen sein soll: `Sheet`
          bringt seine Eintrittsanimation im Effekt mit. */}
      {tageOffen && (
        <Sheet sichtbar titel="Reisetage" onSchliessen={() => setTageOffen(false)}>
          {/* Scrollt und ist gedeckelt, aus demselben Grund wie die
              Gruppenliste: eine lange Reise hat viele Tage, und `Sheet`
              schnitte den Überhang hart ab (85 % Fensterhöhe, `overflow:
              hidden`), die letzten Tage wären dann auf keinem Weg mehr
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
          {/* AUSSERHALB der Scroll-Fläche: der Satz erklärt die Liste, und
              eine Erklärung, die man erst ganz nach unten scrollen muss, um
              sie zu finden, erklärt nichts. Nur bei einer echten Lücke, eine
              lückenlose Liste wirft die Frage gar nicht auf. */}
          {tageLuecke && (
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{LUECKEN_HINWEIS}</Text>
          )}
        </Sheet>
      )}

      {ohneOrtOffen && (
        <Sheet sichtbar titel={ohneOrtText(ohneOrt.length)} onSchliessen={() => setOhneOrtOffen(false)}>
          {/* Scrollt und ist gedeckelt, aus demselben Grund wie Gruppen- und
              Tagesliste: `Sheet` schnitte den Überhang hart ab (85 %
              Fensterhöhe, `overflow: hidden`), und die abgeschnittenen
              Momente wären von der Karte aus auf keinem anderen Weg mehr
              erreichbar, eine Nadel haben sie ja gerade nicht. */}
          <SheetScroll testID="ohne-ort-liste">
            <View style={styles.kachelRaster}>
              {ohneOrt.map((eintrag, stelle) => (
                <OhneOrtKachel
                  key={eintrag.moment.id}
                  eintrag={eintrag}
                  thumbUrl={nadelBild(urls, eintrag.moment.id)}
                  stelle={stelle}
                  onAnsehen={zumPlayer}
                />
              ))}
            </View>
          </SheetScroll>
        </Sheet>
      )}

      {/* Erst gemountet, wenn es etwas zu zeigen gibt: `Sheet` bringt seine
          Eintrittsanimation im Effekt mit (spring-ui, DESIGN-LANGUAGE §4), und
          ein frisch gemountetes Sheet öffnet damit jedes Mal von unten. Die
          Kinder werden ohnehin vom Elternteil gebaut, ein dauerhaft
          gemountetes Sheet müsste sie also trotzdem gegen `null` absichern. */}
      {sheetPunkte !== null && (
        <Sheet
          sichtbar
          // Die Liste bekommt eine Überschrift, der einzelne Moment nicht:
          // dort ist das Bild der Kopf (Spec §5.7). Mehr als ein Punkt heisst
          // hier immer «alle auf derselben Koordinate», «an diesem Ort» ist
          // also wörtlich wahr, anders als bei einer nach Bildschirmpunkten
          // gebildeten Gruppe.
          titel={sheetPunkte.length > 1 ? `${sheetPunkte.length} Momente an diesem Ort` : undefined}
          onSchliessen={() => setSheetPunkte(null)}
        >
          {sheetPunkte.length === 1 ? (
            <MomentSheetInhalt
              punkt={sheetPunkte[0]}
              bildUrl={sheetBild(urls, sheetPunkte[0].moment.id)}
              form={SHEET_FORM}
              onAnsehen={zumPlayer}
            />
          ) : (
            <GruppenSheetInhalt
              punkte={sheetPunkte}
              urls={urls}
              form={SHEET_FORM}
              onAnsehen={zumPlayer}
            />
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
  // Der Rückweg auf einer hellen Fläche (Skelett): dieselbe Stelle wie die
  // Zurück-Pille der fertigen Karte, nur ohne Pille darunter.
  zurueckHell: { position: 'absolute', left: spacing.screen },
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
  // Die Leiste der Momente ohne Ort, mittig unten. Waagrecht zentriert statt
  // an einem Rand: links und rechts oben sitzen bereits Rückweg und
  // Tagesfilter, und eine dritte Pille in derselben Ecke sähe aus, als
  // gehörte sie zu einer von beiden. Der Abstand nach unten ist der
  // Screen-Rand (DESIGN-LANGUAGE §3); die Tab-Leiste darunter gehört nicht zu
  // dieser Fläche, der Screen endet über ihr.
  leiste: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    alignItems: 'center',
    gap: spacing.s,
  },
  // Mehrzeilig und ohne feste Höhe, anders als die Pillen daneben: hier stehen
  // ganze Sätze, keine Beschriftung.
  fehlenPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.control,
    gap: spacing.xs,
  },
  // Dieselbe Höhe und dasselbe Innenmass wie die Filter-Pille gegenüber.
  ohneOrtPille: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Drei Spalten, wortgleich zur Übersicht (Spec §5.8: dieselbe Kachel-Liste),
  // inklusive der Begründung dort, warum die Lücke aus `columnGap`/`rowGap`
  // kommt und nicht aus `justifyContent: 'space-between'`.
  kachelRaster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    columnGap: spacing.xs,
    rowGap: spacing.xs,
  },
  kachel: { width: '31.5%', aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
  // Die Zustände ohne Karte (lädt / Fehler / keine Orte): ein heller Screen,
  // der von oben nach unten gelesen wird. Rand 24 (DESIGN-LANGUAGE §3), oben
  // von `useOberkante` überschrieben.
  textScreen: { padding: spacing.screen, gap: spacing.xl },
  textBlock: { gap: spacing.m },
});
