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
import { gruppiereNachTagen, sortiereMomente } from '@/features/recap/tage';
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

// Wirft eine der beiden Abfragen, statt ihren Fehler als Wert zurückzugeben,
// gibt es keinen Text vom Server. Dann muss dieser hier einspringen — Ursache
// und Lösung, ohne Entschuldigung (DESIGN-LANGUAGE §6), nach demselben Muster
// wie der allgemeine Ladefehler in recapApi.ts («Die Momente konnten nicht
// geladen werden. Probier es gleich nochmal.»).
const WURF_TEXT = 'Die Karte konnte nicht geladen werden. Probier es gleich nochmal.';

// Spec §5.9, wörtlich. Kein leerer Kartenausschnitt über dem Atlantik,
// sondern die Auskunft, warum hier nichts ist.
const LEER_TITEL = 'Diese Reise hat keine Orte';
const LEER_ERKLAERUNG =
  'Momente bekommen ihren Ort beim Einsenden — nur, wenn die Ortungsdienste erlaubt sind. Für diese Reise war das nie der Fall.';

// Und der andere leere Fall: es gibt überhaupt keine Momente zu zeigen.
// Wortgleich zu uebersicht.tsx und player.tsx — dieselbe Reise soll auf allen
// drei Screens dasselbe sagen.
const LEER_OHNE_MOMENTE = 'Diese Reise ist leer geblieben.';

// Die eine Zeile, die die Lücke in den Tagesnummern erklärt. `waehlbareTage`
// lässt Tage weg, an denen kein Moment einen Ort hat — die Übersicht zeigt
// sie trotzdem, der Filter springt hier also z.B. von Tag 1 auf Tag 3. Ohne
// diesen Satz sieht das nach einem Fehler aus statt nach einer Regel.
const LUECKEN_HINWEIS = 'Tage, an denen kein Moment einen Ort hat, stehen nicht zur Wahl.';

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

// Was VoiceOver zu einem einzelnen Moment sagt — wortgleich an der Nadel
// (KartenNadel.tsx), in der Gruppenliste und an den Kacheln der Momente ohne
// Ort: derselbe Moment, derselbe Weg. Eine zweite Formulierung liefe
// irgendwann gegen die erste.
function momentLabel(moment: RecapMoment): string {
  return `Moment von ${moment.autor_name} um ${zeitInZone(moment.captured_at, moment.captured_tz)} öffnen`;
}

// Die Leiste unten UND der Titel ihres Sheets (Spec §5.8) — eine Quelle für
// beide. Singular/Plural wie überall im Projekt: die Zahl bleibt auch im
// Singular stehen.
function ohneOrtText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment' : 'Momente'} ohne Ort`;
}

// Ein Moment, den keine Nadel tragen kann — mit seinem Platz in der
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
  fehlerText: string | null;
};

// Feste leere Listen statt `[]` bei jedem Ableiten — gleicher Grund wie bei
// KEINE_URLS oben: die Werte gehen als Abhängigkeit in `sichtbarePunkte`,
// `linie` und `gruppen`, und ein bei jedem Rendern neues Array liesse sie
// ohne Grund neu rechnen.
const KEINE_PUNKTE: KartenPunkt[] = [];
const KEINE_OHNE_ORT: OhneOrt[] = [];
const KEINE_MOMENTE: RecapMoment[] = [];

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
// Tage» hilft. Was dabei wegfällt, reisst eine Lücke in die Nummern (Tag 1,
// Tag 3) — die erklärt LUECKEN_HINWEIS im Sheet, statt sie stumm zu lassen.
function waehlbareTage(alle: RecapTag[], punkte: KartenPunkt[]): RecapTag[] {
  const mitOrt = new Set(punkte.map((p) => p.moment.id));
  return alle.filter((tag) => tag.momente.some((m) => mitOrt.has(m.id)));
}

// Die Momente ohne Ort mit ihrem Platz in der Spielliste.
//
// Die Reihenfolge kommt aus `sortiereMomente` — DERSELBEN Funktion, mit der
// `zuKartenPunkten` seine Indizes vergibt (kartenPunkte.ts). Sie ist eine
// totale Ordnung (captured_at, id als zweites Kriterium, tage.ts), zweimal
// auf dieselbe Liste angewandt kommt also zwangsläufig dieselbe Reihenfolge
// heraus: die Kachel eines Moments ohne Ort und die Nadel eines Moments mit
// Ort zählen damit nachweislich in dieselbe Liste.
//
// Nicht über die Eingangsreihenfolge: `fetchRecapMomente` sortiert heute
// selbst (recapApi.ts) — genau deshalb fiele es nirgends auf, wenn hier die
// Eingangsliste gezählt würde, bis eines Tages jemand diese Sortierung
// verschiebt. WER keinen Ort hat, entscheidet weiterhin allein
// `zuKartenPunkten`; hier wird nur nachgeschlagen, an welcher Stelle er steht.
function ohneOrtMitIndex(spielliste: RecapMoment[], ohneOrt: RecapMoment[]): OhneOrt[] {
  const ids = new Set(ohneOrt.map((m) => m.id));
  return sortiereMomente(spielliste)
    .map((moment, index) => ({ moment, index }))
    .filter((eintrag) => ids.has(eintrag.moment.id));
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
        accessibilityLabel={momentLabel(moment)}
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

// Eine Kachel der Momente ohne Ort — dieselbe Kachel-Liste wie in der
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
          {/* Ohne brauchbare URL bleibt die ruhige bg-1-Fläche stehen — kein
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
// Gradient-Shimmer)». Auf diesem Screen ist der Block die GANZE Fläche — die
// Karte füllt sie später ebenso (Spec §5.3), es gibt daneben nichts, was ein
// kleinerer Block andeuten könnte.
//
// MIT Rückweg, anders als SkelettScreen in uebersicht.tsx: die Übersicht ist
// eine Tab-Wurzel, die Karte ein per `push` erreichter Screen. Weder
// `urlVorrat.ts` noch `recapApi.ts` kennen Timeout oder AbortController —
// hängt eine der beiden Abfragen, bliebe hier sonst dauerhaft ein pulsender
// grauer Block stehen, aus dem nur die Tab-Leiste führt (Fixrunde 1,
// Important 2).
function KartenSkelett({ oben, onZurueck }: { oben: number; onZurueck: () => void }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    // §5: mit Reduced Motion pulst nichts — der Block steht still, aber
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
          Zurück-Pille der fertigen Karte — und nicht die Pille selbst: unter
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

  // Alles, was aus EINEM Ladevorgang der Momente stammt — in EINEM State und
  // mit der Reise, zu der es gehört (Fixrunde 1, Important 1).
  //
  // Zusammen, weil es zusammen entsteht und zusammen ungültig wird: eine
  // Phase ohne die zugehörigen Punkte (oder umgekehrt) gibt es nie.
  //
  // Mit Stempel, weil der Screen bei einem Wechsel der Reise-id gemountet
  // bleibt — und ohne ihn stand der Ladestand von t1 über t2, nicht einen
  // Frame lang, sondern die volle Ladedauer der neuen Reise: «Diese Reise hat
  // keine Orte» über einer Reise voller Orte, t1s Fehlertext samt «Nochmal
  // versuchen» über t2, t1s Leiste mit t1s Momenten. Und t1s Nadeln: ein
  // Tipp darauf öffnete ein Sheet, das bereits `tripId: t2` trägt — der
  // Wächter unten greift dann nicht mehr, und «Im Recap ansehen» schickte
  // den Player mit t1s Index in t2.
  const [ladestand, setLadestand] = useState<Ladestand>(() => ({
    tripId: id,
    phase: 'laedt',
    punkte: KEINE_PUNKTE,
    ohneOrt: KEINE_OHNE_ORT,
    fehlerText: null,
  }));
  // Nur für den Knopf im Fehlerzweig. Ein zweiter Anlauf setzt die Phase
  // bewusst NICHT auf 'laedt' zurück: der Fehlertext soll stehen bleiben,
  // solange der neue Versuch läuft — sonst blitzt zwischen zwei Fehlschlägen
  // ein Skelett auf, und niemand kann mehr lesen, was eigentlich los war.
  // Gleiches Muster wie `laedt` in uebersicht.tsx.
  const [nochmalLaeuft, setNochmalLaeuft] = useState(false);
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
  // Die beiden Hälften, aus denen die Tagesnummern entstehen — jede mit der
  // Reise, aus der sie stammt. Sie kommen aus ZWEI getrennten Abfragen (siehe
  // die Ladewege unten), und eine Mischung aus zwei Reisen ergäbe Nummern, die
  // es in keiner der beiden gibt: das Startdatum der einen, die Momente der
  // anderen.
  //
  // Die Spielliste liegt hier zusätzlich zu `punkte`, weil sie die Momente
  // OHNE Ort mitträgt — `waehlbareTage` braucht sie für die Nummerierung
  // (Begründung dort).
  const [spielliste, setSpielliste] = useState<{ tripId: string; momente: RecapMoment[] } | null>(null);
  const [reiseStart, setReiseStart] = useState<{ tripId: string; startDate: string } | null>(null);
  // Der gewählte Tag, mit der Reise, in der er gewählt wurde — aus demselben
  // Grund wie beim Sheet oben: der Screen bleibt bei einem Wechsel der id
  // gemountet, und ein stehen gebliebener Filterstand öffnete die NÄCHSTE
  // Reise vorgefiltert auf einen Tag, den niemand gewählt hat.
  const [tagWahl, setTagWahl] = useState<{ tripId: string; nummer: number } | null>(null);
  // Das offene Tages-Sheet trägt seine Reise aus demselben Grund wie `sheet`
  // — und aus einem eigenen, schärferen: es listet die Tage DER REISE, aus der
  // es geöffnet wurde. Bliebe es bei einem Wechsel stehen, würde ein Tipp auf
  // «Tag 3» die neue Reise auf einen Tag filtern, den niemand in ihr gewählt
  // hat — und `waehleTag` schriebe dabei die NEUE id in die Wahl, der Wächter
  // unten käme also nie zum Zug.
  const [tageSheet, setTageSheet] = useState<{ tripId: string } | null>(null);
  // Und das Sheet der Momente ohne Ort, aus genau denselben Gründen: seine
  // Kacheln tragen Indizes der Reise, aus der es geöffnet wurde.
  const [ohneOrtSheet, setOhneOrtSheet] = useState<{ tripId: string } | null>(null);

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
  if (tageSheet !== null && tageSheet.tripId !== id) setTageSheet(null);
  if (ohneOrtSheet !== null && ohneOrtSheet.tripId !== id) setOhneOrtSheet(null);
  const sheetPunkte = sheet?.punkte ?? null;
  const tageOffen = tageSheet !== null;
  const ohneOrtOffen = ohneOrtSheet !== null;

  // Der Ladestand wird ABGELEITET statt beim Rendern zurückgesetzt — anders
  // als die vier Sheets/Filter darüber, und aus einem Grund, der nur für
  // geladene Daten gilt: bei t1 → t2 → t1 ist t1s Stand wieder der richtige.
  // Ein Zurücksetzen verwürfe ihn und zeigte für die Dauer eines erneuten
  // Ladevorgangs ein Skelett über einer Karte, die längst stimmt. Bei einem
  // Sheet ist es umgekehrt — dort öffnete sich sonst von selbst eines, das
  // niemand angetippt hat (Begründung oben).
  //
  // Gehört der Stand zu einer anderen Reise, ist diese hier schlicht noch
  // nicht geladen: 'laedt'. Genau das, was der Screen beim ersten Öffnen
  // auch zeigt.
  // EINE Bedingung für alle vier Werte, nicht vier einzelne. Vier wären zu
  // dritt nicht prüfbar: schon die Phase allein schickt den Screen ins
  // Skelett und kehrt vor jedem anderen Zweig zurück, ein zusätzlicher Test
  // an `punkte` oder `ohneOrt` liesse sich also ersatzlos streichen, ohne
  // dass eine Zusicherung fiele — genau die Art Bedingung, die später niemand
  // mehr prüfen kann (gleiche Überlegung wie bei `aufEinemFleck` in
  // `aufNadel`). So getrennt kann es einen halben Stand aber gar nicht geben:
  // entweder gilt der ganze Ladestand, oder es gilt der eines Screens, der
  // noch nichts geladen hat.
  const sichtbarerStand: Ladestand =
    ladestand.tripId === id
      ? ladestand
      : { tripId: id, phase: 'laedt', punkte: KEINE_PUNKTE, ohneOrt: KEINE_OHNE_ORT, fehlerText: null };
  const { phase, punkte, ohneOrt, fehlerText } = sichtbarerStand;
  // Aus demselben Grund abgeleitet wie oben — und hier zusätzlich für den
  // Unterschied zwischen «kein Moment hat einen Ort» und «es gibt gar keine
  // Momente» gebraucht (siehe die beiden Leer-Zweige unten).
  const spiellisteJetzt =
    spielliste !== null && spielliste.tripId === id ? spielliste.momente : KEINE_MOMENTE;

  // Der Ladeanlauf, dessen Antwort noch zählt.
  //
  // Ein eigenes Objekt je Anlauf und nicht mehr das frühere `aktiv`-Flag:
  // seit «Nochmal versuchen» lässt sich der Ladeweg auch von Hand starten, es
  // können also ZWEI Anläufe gleichzeitig offen sein. Ein gemeinsames Flag
  // könnte nur «alle abbrechen» sagen, nicht «nur der neueste zählt» — und
  // die langsamere der beiden Antworten überschriebe sonst die neuere.
  const anlauf = useRef({ gilt: true });

  // Die drei ungestempelten Nebenzustände eines Ladevorgangs — sie gehören
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
    try {
      const [momente, vorratErgebnis] = await Promise.all([fetchRecapMomente(id), holeVorrat(id)]);
      if (!meiner.gilt) return;

      // Beide Abfragen geben ihren Fehler als WERT zurück, und beide Texte
      // sind bereits deutsche Copy in Du-Form (recapApi.ts, urlVorrat.ts) —
      // inklusive der beiden fachlichen 403 «Diese Reise ist noch versiegelt.»
      // und «Kein Zugriff auf diese Reise.», die `holeVorrat` zusätzlich als
      // `grund` maschinenlesbar macht. Der `grund` wird hier NICHT ausgewertet:
      // was dieser Screen tun kann, ist in allen Fällen dasselbe (den Grund
      // nennen, einen zweiten Versuch anbieten, den Rückweg offen lassen), und
      // player.tsx entscheidet an derselben Stelle genauso.
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
          fehlerText: fehler,
        });
        return;
      }

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
        fehlerText: null,
      });
    } catch (wurf: unknown) {
      // fetchRecapMomente und holeVorrat geben Fehler als WERT zurück statt
      // zu werfen — aber "wirft normalerweise nicht" ist keine Zusicherung,
      // die diese Kette tragen kann. Wirft eine der beiden doch, wäre die
      // Ablehnung ohne dieses `catch` unbehandelt (Fixrunde 1). Es gibt dann
      // keinen Text vom Server, also springt WURF_TEXT ein — und der Fehler
      // geht zusätzlich an den Fehlermelder (ohne DSN ein No-Op, siehe
      // lib/fehlermelder.ts), weil nur er die technische Ursache kennt.
      if (!meiner.gilt) return;
      meldeFehler(wurf, { screen: 'recap/karte', tripId: id, ladeweg: 'momente' });
      leereKarte();
      setLadestand({
        tripId: id,
        phase: 'fehler',
        punkte: KEINE_PUNKTE,
        ohneOrt: KEINE_OHNE_ORT,
        fehlerText: WURF_TEXT,
      });
    }
  }, [id, leereKarte]);

  useEffect(() => {
    // `laden` setzt seinen Zustand erst NACH dem ersten `await` (die Zeilen
    // davor berühren nur ein Ref) — die kaskadierenden Renders, vor denen die
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
    // anderer — react-hooks/exhaustive-deps warnt zu Recht genau davor.
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
  // Startdatum DER REISE (tage.ts), nicht ab dem ersten Moment — uebersicht.tsx
  // und player.tsx lesen es an derselben Stelle. Ohne diese Abfrage müsste
  // dieser Screen die Tage aus den Momenten heraus raten und zeigte für
  // dieselbe Reise andere Nummern als die Übersicht.
  //
  // Aber: der Filter ist Beiwerk, die Nadeln SIND der Screen — und in einem
  // gemeinsamen `Promise.all` wäre das nur für den Fehlerpfad wahr, nicht für
  // den Zeitpfad. Bis der Ausschnitt steht, wird die Karte gar nicht erst
  // gemountet; die Nadeln hingen also an einer Abfrage, die für sie nichts
  // beiträgt. Und `fetchTrip` ist nicht eine Abfrage, sondern zwei: es wartet
  // intern auf die rpc `my_post_counts` mit (tripsApi.ts) — ein hängender
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
        // der Sprung in den Player stehen vollständig — eine Fehlermeldung
        // über einer intakten Karte behauptete, hier sei etwas kaputt, und
        // stritte ausserdem mit der Leiste unten um denselben Platz. Was
        // fehlt, ist eine Pille, die es sonst nur bei mehr als einem
        // wählbaren Tag überhaupt gibt.
        //
        // Spurlos verschwinden darf er trotzdem nicht: bis Task 10 war das
        // der einzige Ladepfad dieses Screens ohne jede Meldung. Der
        // Fehlermelder ist die einzige Stelle, an der «der Filter fehlt, weil
        // die Reise-Abfrage ausgefallen ist» von «diese Reise hat nur einen
        // Tag mit Nadeln» zu unterscheiden ist — von aussen sehen beide
        // gleich aus.
        if (error !== null) {
          meldeFehler(new Error(error), { screen: 'recap/karte', tripId: id, ladeweg: 'reise' });
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
        meldeFehler(fehler, { screen: 'recap/karte', tripId: id, ladeweg: 'reise' });
        setReiseStart(null);
      });
    return () => {
      aktiv = false;
    };
  }, [id]);

  // Der sichtbare Ausschnitt wandert bei jeder Kartenbewegung in den State:
  // Task 7 gruppiert Nadeln nach ihrem Abstand in BILDSCHIRMpunkten und
  // braucht dafür den aktuellen Zoom, nicht den anfänglichen.
  const merkeAusschnitt = useCallback((region: Region) => setAusschnitt(region), []);

  // Die wählbaren Tage — erst, wenn BEIDE Hälften zur gerade angezeigten Reise
  // gehören. Die Ladewege laufen unabhängig, es gibt also ein Fenster, in dem
  // das Startdatum der neuen Reise schon da ist und die Momente noch die der
  // vorherigen sind; die Nummern daraus gäbe es in keiner der beiden Reisen.
  //
  // `useMemo` und nicht ein State im Ladeweg: die Rechnung hängt an genau
  // diesen drei geladenen Werten, und die ändern sich einmal pro Ladevorgang —
  // dieser Screen rendert aber bei jeder Kartenbewegung neu.
  const alleTage = useMemo(() => {
    if (spiellisteJetzt.length === 0) return [];
    if (reiseStart === null || reiseStart.tripId !== id) return [];
    return gruppiereNachTagen(spiellisteJetzt, reiseStart.startDate);
  }, [spiellisteJetzt, reiseStart, id]);

  const tage = useMemo(() => waehlbareTage(alleTage, punkte), [alleTage, punkte]);

  // Ob die angebotenen Tagesnummern eine Lücke haben — genau dann, wenn
  // `waehlbareTage` etwas weggelassen hat. Nicht an den Nummern selbst
  // abgelesen: die Übersicht zeigt dieselben Nummern, und was hier fehlt,
  // fehlt AUS DIESEM Grund, nicht aus irgendeinem.
  const tageLuecke = alleTage.length > tage.length;

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
        // Wie in `oeffneTagesfilter`: es ist immer höchstens EIN Sheet offen
        // (Begründung dort).
        setOhneOrtSheet(null);
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

  // Der Weg in den Player (Spec §5.7) — für ALLE drei Sheets dieses Screens
  // derselbe. Die Union statt eines blossen `{ index: number }`: sonst passte
  // JEDE Zahl namens `index` hierher, auch eine Stelle innerhalb von
  // `ohneOrt` oder innerhalb einer Gruppe. Der Typ ist an dieser einen Stelle
  // der letzte Hinweis zur Übersetzungszeit darauf, woher der Wert stammen
  // darf. `index` zählt über die SPIELLISTE, die der Ladeweg
  // oben filtert — dieselbe, die der Player aufbaut, und `parseStartIndex`
  // zählt dort in genau sie (player.tsx:503-527). Nie der Index innerhalb von
  // `punkte` (der überspringt die Momente ohne Ort), nie der innerhalb der
  // Gruppe und nie der innerhalb von `ohneOrt`: alle drei sässen scheinbar
  // richtig und starteten den Player beim falschen Moment.
  //
  // Das Sheet bleibt dabei bewusst offen: es zu schliessen hiesse, es während
  // des Übergangs in den Player wegblitzen zu lassen — und wer zurückkommt,
  // findet die Stelle wieder, an der er war.
  const zumPlayer = useCallback(
    (eintrag: KartenPunkt | OhneOrt) => {
      router.push({ pathname: '/recap/[id]/player', params: { id, start: String(eintrag.index) } });
    },
    [router, id]
  );

  // Was die Pille zeigt und was VoiceOver ansagt — eine Quelle für beides.
  const filterStand = gewaehlterTag ? `Tag ${gewaehlterTag.nummer}` : 'Alle Tage';

  const oeffneTagesfilter = () => {
    // KEINE gestapelten Sheets: `Sheet` bringt jeweils einen eigenen Backdrop
    // über den ganzen Screen mit (Sheet.tsx), zwei übereinander ergäben eine
    // doppelt abgedunkelte Karte — und ein Wisch nach unten schlösse nur das
    // obere und liesse ein Panel zurück, das niemand mehr erwartet.
    //
    // (Nicht der Grund: die Zahl der Primär-Buttons. Die Tagesliste hat per
    // Konstruktion keinen, zwei offene Sheets hätten also weiterhin genau
    // einen — DESIGN-LANGUAGE §4 ist hier nicht verletzt und trägt diese
    // Entscheidung nicht.)
    //
    // Auf dem Gerät fängt der Backdrop des offenen Moment-Sheets diesen Tipp
    // ohnehin ab; dass der Zustand hier trotzdem eindeutig gemacht wird,
    // kostet nichts und macht die Zusicherung prüfbar, statt sie der
    // Trefferreihenfolge zu überlassen.
    setSheet(null);
    setOhneOrtSheet(null);
    setTageSheet({ tripId: id });
  };

  // Aus demselben Grund und auf demselben Weg.
  const oeffneOhneOrt = () => {
    setSheet(null);
    setTageSheet(null);
    setOhneOrtSheet({ tripId: id });
  };

  const waehleTag = (tag: RecapTag | null) => {
    setTageSheet(null);
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

  // ---------------------------------------------------------------------
  // Die drei Zustände ohne Karte. Sie sahen bis Task 10 alle gleich aus —
  // eine weisse Fläche mit Zurück-Pille —, weil alle drei in `punkte = []`
  // und `ausschnitt = null` enden.
  // ---------------------------------------------------------------------

  if (phase === 'laedt') return <KartenSkelett oben={oben} onZurueck={zurueck} />;

  if (phase === 'fehler') {
    return (
      <View style={[styles.flaeche, { backgroundColor: colors['bg-0'] }]}>
        <View style={[styles.textScreen, { paddingTop: oben }]}>
          {/* Der Rückweg auf einem Screen OHNE Karte. Die translucente Pille
              taugt dafür nicht: sie ist für eine Fremdfläche gemacht
              (DESIGN-LANGUAGE §1) — ohne Karte läge sie auf reinem Weiss und
              wäre der einzige Kino-Fleck eines hellen Screens. Also dieselbe
              Kopfzeile wie in uebersicht.tsx, mit derselben Beschriftung wie
              die Pille. */}
          <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={zurueck}>
            <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
          {/* Der Text kommt vom Ladeweg und nennt bereits Ursache und Lösung
              in Du-Form (recapApi.ts, urlVorrat.ts) — hier wird nichts
              dazuerfunden. */}
          <Text style={[type.body, { color: colors.danger }]}>{fehlerText}</Text>
          {/* Der einzige Primär-Button dieses Zustands (DESIGN-LANGUAGE §4):
              der Rückweg oben ist ein Icon, kein Knopf. */}
          <Button
            variant="primary"
            label="Nochmal versuchen"
            onPress={() => void nochmal()}
            loading={nochmalLaeuft}
          />
        </View>
      </View>
    );
  }

  // «Es gibt gar keine Momente» ist NICHT «kein Moment hat einen Ort»
  // (Fixrunde 1, Important 3). Eine Reise, in der niemand eingesendet hat —
  // oder in der alle Uploads noch unterwegs sind —, bekäme sonst den Satz
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
  // liefert `null`, wenn kein einziger Moment einen Ort hat — statt einer
  // erfundenen Region steht hier die Erklärung aus Spec §5.9.
  //
  // Keine Kopfzeile und kein zweiter Weg hinaus: der eine Knopf IST der
  // Rückweg, ein Pfeil daneben täte dasselbe noch einmal. Er ruft `zurueck`
  // und nicht ein eigenes `replace` — beide Zweige davon landen auf der
  // Übersicht dieser Reise (von woanders kommt man auf die Karte nicht), und
  // `back()` behält dabei den Stapel, statt ihn zu überschreiben.
  //
  // Auch keine Leiste «N Momente ohne Ort», obwohl HIER jeder Moment einen
  // hat: sie ist eine Pille für die Kartenfläche, und was sie sagt, sagt die
  // Erklärung darüber bereits für die ganze Reise. Erreichbar bleiben die
  // Momente über die Übersicht — die zeigt sie alle.
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
      {/* `ausschnitt` steht hier immer — er wird aus denselben `punkte`
          berechnet, deren Zahl den Leer-Zustand oben abgefangen hat. Die
          Abfrage bleibt trotzdem stehen, weil der Typ sie verlangt. */}
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

      {/* Die Momente, die keine Nadel tragen können (Spec §5.8). Jede echte
          Reise hat sie — ohne Berechtigung, in Innenräumen oder bei
          Zeitüberschreitung liefert `ortBestimmen` bewusst drei `null`
          (features/moments/ortUndZeit.ts) —, und sie dürfen auf der Karte
          nicht einfach fehlen, ohne dass es jemand merkt.

          Kein Primär-Button, sondern eine translucente Pille wie die beiden
          oben: sie liegt auf der Kartenfläche (DESIGN-LANGUAGE §1), und den
          einen Primär-Button dieses Screens trägt das Moment-Sheet (§4).

          Die Zahl gilt für die GANZE Reise, auch bei gewähltem Tag: ein
          Moment ohne Ort liegt auf keinem Tag DER KARTE, und ein Tag, dessen
          Momente alle ohne Ort sind, steht gar nicht erst zur Wahl (siehe
          `waehlbareTage`). Eine mitgefilterte Leiste liesse genau diese
          Momente auf keinem Weg mehr erreichbar. */}
      {ohneOrt.length > 0 && (
        // Die Zentrierung trägt ein eigener Rahmen, nicht die PressScale
        // selbst: die zöge sich über die volle Breite und finge damit jeden
        // Tipp links und rechts der Pille ab — auf einer Karte wäre das ein
        // 44 Punkte hohes Band, in dem sich nicht mehr schieben liesse.
        // `box-none` lässt Tipps durch den Rahmen hindurch, nur die Pille
        // selbst nimmt sie an.
        <View style={styles.ohneOrt} pointerEvents="box-none">
          <PressScale
            testID="karte-ohne-ort"
            accessibilityRole="button"
            // Die Pille zeigt die Zahl, das Label sagt zusätzlich, was ein
            // Tipp tut — wortgleich zur Nadel einer unteilbaren Gruppe.
            accessibilityLabel={`${ohneOrtText(ohneOrt.length)} ansehen`}
            onPress={oeffneOhneOrt}
          >
            <Pille style={styles.ohneOrtPille}>
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                {ohneOrtText(ohneOrt.length)}
              </Text>
            </Pille>
          </PressScale>
        </View>
      )}

      {/* Wie beim Moment-Sheet erst gemountet, wenn es offen sein soll: `Sheet`
          bringt seine Eintrittsanimation im Effekt mit. */}
      {tageOffen && (
        <Sheet sichtbar titel="Reisetage" onSchliessen={() => setTageSheet(null)}>
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
          {/* AUSSERHALB der Scroll-Fläche: der Satz erklärt die Liste, und
              eine Erklärung, die man erst ganz nach unten scrollen muss, um
              sie zu finden, erklärt nichts. Nur bei einer echten Lücke — eine
              lückenlose Liste wirft die Frage gar nicht auf. */}
          {tageLuecke && (
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{LUECKEN_HINWEIS}</Text>
          )}
        </Sheet>
      )}

      {ohneOrtOffen && (
        <Sheet sichtbar titel={ohneOrtText(ohneOrt.length)} onSchliessen={() => setOhneOrtSheet(null)}>
          {/* Scrollt und ist gedeckelt, aus demselben Grund wie Gruppen- und
              Tagesliste: `Sheet` schnitte den Überhang hart ab (85 %
              Fensterhöhe, `overflow: hidden`), und die abgeschnittenen
              Momente wären von der Karte aus auf keinem anderen Weg mehr
              erreichbar — eine Nadel haben sie ja gerade nicht. */}
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
  // Die Leiste der Momente ohne Ort, mittig unten. Waagrecht zentriert statt
  // an einem Rand: links und rechts oben sitzen bereits Rückweg und
  // Tagesfilter, und eine dritte Pille in derselben Ecke sähe aus, als
  // gehörte sie zu einer von beiden. Der Abstand nach unten ist der
  // Screen-Rand (DESIGN-LANGUAGE §3); die Tab-Leiste darunter gehört nicht zu
  // dieser Fläche, der Screen endet über ihr.
  ohneOrt: { position: 'absolute', left: 0, right: 0, bottom: spacing.screen, alignItems: 'center' },
  // Dieselbe Höhe und dasselbe Innenmass wie die Filter-Pille gegenüber.
  ohneOrtPille: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Drei Spalten, wortgleich zur Übersicht (Spec §5.8: dieselbe Kachel-Liste)
  // — inklusive der Begründung dort, warum die Lücke aus `columnGap`/`rowGap`
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
  eintrag: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  eintragBild: { width: 56, height: 56, borderRadius: radius.control, overflow: 'hidden' },
  // `flex: 1` nimmt den Rest der Zeile — ohne das schöbe eine lange Caption
  // die Zeile über den Rand hinaus, statt in `numberOfLines` abgeschnitten zu
  // werden.
  eintragText: { flex: 1, gap: spacing.xs },
});
