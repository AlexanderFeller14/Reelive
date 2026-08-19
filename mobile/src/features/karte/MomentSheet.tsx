import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/Button';
import { PressScale } from '@/components/PressScale';
import { SHEET_SCROLL_ANTEIL } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import type { RecapMoment } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';
import { momentLabel } from './nadel';
import type { KartenPunkt } from './typen';

// Was ein Tipp auf eine Nadel zeigt: der einzelne Moment und, wo mehrere auf
// derselben Koordinate liegen, ihre Liste (Spec §5.7). Zweimal dieselbe
// Oberfläche, an zwei Stellen gebraucht: auf der Karte in der App
// (recap/[id]/karte.tsx) und auf der Karte des geteilten Recaps
// (teilen/[token].tsx).
//
// Sie lag bis hierher zweimal im Projekt, rund 250 Zeilen, entstanden in
// dieser Reihenfolge: erst die App-Fassung, dann die geteilte, die sie
// übernahm. Beide trugen Kommentare, die auf die jeweils andere verweisen,
// und genau das ist der Zustand, in dem eine Änderung an einer Stelle
// stillschweigend nur die Hälfte der App erreicht.
//
// Was die beiden Screens WIRKLICH unterscheidet, sind zwei Dinge, und beide
// sind hier Props: die Beschriftung des Knopfs (die App springt in ihren
// Recap-Player, der geteilte Recap in den Player auf derselben Seite) und das
// Präfix der testIDs.
//
// Diese Datei liegt in features/karte, nicht in components: sie kennt
// `KartenPunkt`, also die Karte. Und sie zieht bewusst NICHTS Natives herein,
// react-native-maps kommt hier nicht vor. Der geteilte Recap läuft auch im
// Browser-Bundle (siehe teilen/__tests__/modulgraph.test.ts), und ein Import
// von dort wäre das Ende des Web-Exports.

// Woraus sich ein Bild laden lässt. Absichtlich schmaler als die beiden Typen,
// die die Aufrufer halten (`MedienUrl` aus urlVorrat.ts trägt zusätzlich die
// `post_id`, `MedienLink` in teilen/[token].tsx ist strukturell dieser hier):
// gebraucht werden genau diese zwei Felder, und wer weniger verlangt, nimmt
// beide entgegen, ohne dass ein Screen seinen Typ umbauen muss.
export type BildQuelle = { medium_url: string; thumb_url: string | null };

// Eine URL, mit der sich tatsächlich ein Bild laden lässt, oder `null`.
//
// `medium_url` ist in beiden Quelltypen als `string` typisiert, wird aber
// ungeprüft aus der Antwort einer Edge Function übernommen (urlVorrat.ts
// prüft die FORM der Antwort, nicht jedes Feld jedes Moments; shareApi.ts
// ebenso). Fehlt das Feld dort, lügt der Typ, und ohne diese Prüfung ginge
// ein `undefined` als Bildquelle an die Nadel.
export function brauchbareUrl(wert: string | null | undefined): string | null {
  return typeof wert === 'string' && wert.length > 0 ? wert : null;
}

// Das Bild einer Nadel: klein reicht, `thumb_url` zuerst. Fehlt es (die
// Function hatte für diesen Moment keinen `thumb_key`, siehe
// supabase/functions/media-urls/index.ts), trägt das mittlere Bild die Nadel.
// Ohne diesen Ausweg bliebe für solche Momente für immer das Skelett stehen.
export function nadelBild(
  urls: ReadonlyMap<string, BildQuelle>,
  momentId: string
): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return brauchbareUrl(url.thumb_url) ?? brauchbareUrl(url.medium_url);
}

// Das Bild IM SHEET ist gross (3:2, Spec §5.7), dafür ist das mittlere Bild
// gedacht, nicht das 44 Punkte breite Nadel-Thumbnail. Die Reihenfolge ist
// deshalb genau umgekehrt zu `nadelBild`; der Ausweg auf die jeweils andere
// URL bleibt aus demselben Grund wie dort.
export function sheetBild(
  urls: ReadonlyMap<string, BildQuelle>,
  momentId: string
): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return brauchbareUrl(url.medium_url) ?? brauchbareUrl(url.thumb_url);
}

// «Mira · 14:32» (Spec §5.7). Die Uhrzeit läuft über dieselbe Formatierung wie
// im Player und an der Nadel (features/recap/uhrzeit.ts): sie zeigt die Zeit
// in `captured_tz`, die Uhrzeit von damals vor Ort, nicht die auf die
// Gerätezeit umgerechnete.
export function autorUndZeit(moment: RecapMoment): string {
  return `${moment.autor_name} · ${timeInZone(moment.captured_at, moment.captured_tz)}`;
}

// DESIGN-LANGUAGE §5: «Listen = Stagger 40 ms», die Zeilen einer Liste
// erscheinen nacheinander, nicht als Block. Und «prefers-reduced-motion: alles
// wird zu 200-ms-Fades», derselbe Wert wie in Sheet.tsx (dort modulprivat).
const STAGGER_MS = 40;
const REDUZIERTE_DAUER_MS = 200;

// Der scrollende Bereich eines Sheets. Beide Sheets benutzen ihn: die Liste
// einer Gruppe, weil sie beliebig lang werden kann, und der einzelne Moment,
// weil Bild (3:2), Ort und Caption bei grosser Systemschrift zusammen höher
// werden als das Sheet, dort bliebe sonst ausgerechnet der Primär-Button
// unerreichbar. Er steht deshalb AUSSERHALB dieses Bereichs und bleibt stehen,
// während der Inhalt darüber scrollt.
//
// Der Anteil und seine Begründung stehen in components/Sheet.tsx, weil sie aus
// dessen eigenem Deckel folgen.
export function SheetScroll({ testID, children }: { testID: string; children: ReactNode }) {
  const { height: fensterHoehe } = useWindowDimensions();
  return (
    <ScrollView
      testID={testID}
      style={{ maxHeight: fensterHoehe * SHEET_SCROLL_ANTEIL }}
      // Den Abstand zwischen den Kindern hält sonst `Sheet` selbst
      // (styles.inhalt, `gap`), innerhalb der ScrollView gilt er nicht mehr,
      // also steht er hier, mit demselben Wert.
      contentContainerStyle={styles.scrollInhalt}
    >
      {children}
    </ScrollView>
  );
}

// Eine Zeile, die sich einblendet. Eigene Komponente, weil jede Zeile ihren
// eigenen Animated.Value braucht: §5 verlangt für Listen einen Stagger von
// 40 ms, und der ist pro Zeile eine eigene Verzögerung. Alle Listen der
// Karten-Sheets benutzen sie (Momente einer Gruppe, Reisetage, Kacheln der
// Momente ohne Ort), Kopien liefen irgendwann in verschiedenen Rhythmen.
export function Einblendung({ stelle, children }: { stelle: number; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  // `useState` mit Initialisierer statt `useRef(...).current`: beides erzeugt
  // den Wert genau einmal, aber das Lesen eines Refs beim Rendern ist ein
  // Lint-Fehler (react-hooks/refs).
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // §5: mit Reduced Motion wird alles zu einem 200-ms-Fade, die Zeilen
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

// Was die beiden Screens an ihren Sheets unterschiedlich machen, als EIN Wert.
//
// `praefix` hat bewusst keinen Vorgabewert und ist Pflicht: mit `''` als
// Vorgabe wäre ein vergessenes Prop kein Fehler, sondern zwei Screens mit
// denselben testIDs, und der Tag, an dem das auffällt, ist der Tag, an dem ein
// Test den falschen Screen prüft. Die App-Fassung übergibt den leeren String,
// weil ihre IDs seit Phase 7 in den Tests stehen und ein Präfix dort eine
// Umbenennung ohne Gewinn wäre.
export type SheetForm = {
  /** Beschriftung des Primär-Buttons im Moment-Sheet. */
  knopfLabel: string;
  /** Vor jede testID gesetzt, z.B. `'teilen-'`. Leer ist erlaubt. */
  praefix: string;
};

// Der einzelne Moment im Sheet (Spec §5.7): Bild 3:2 mit Radius 24
// (DESIGN-LANGUAGE §3), darunter Autor/Uhrzeit, Ort und Caption, und EIN
// Primär-Button (§4: genau einer pro Screen; die Gruppenliste unten hat
// deshalb keinen).
//
// Ein HELLES Sheet, auch im geteilten Recap, dessen Player Kino ist: es öffnet
// über der Karte, und die ist wie in der App ein helles Werkzeug zum Finden,
// kein Medien-Vollbild (Spec §5.3). Derselbe Moment sieht damit an beiden
// Stellen gleich aus.
export function MomentSheetInhalt({
  punkt, bildUrl, form, onAnsehen,
}: {
  punkt: KartenPunkt;
  bildUrl: string | null;
  form: SheetForm;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  const { colors } = useTheme();
  const { moment } = punkt;
  return (
    <>
      {/* Bild und Text scrollen, der Knopf bleibt: bei grosser Systemschrift
          reichen Bild (3:2), Ort und Caption sonst über die Unterkante des
          Sheets hinaus, und der Knopf wäre nicht mehr zu erreichen. */}
      <SheetScroll testID={`${form.praefix}moment-inhalt`}>
        <View style={[styles.sheetBild, { backgroundColor: colors['bg-1'] }]}>
          {/* Ohne brauchbare URL bleibt die ruhige bg-1-Fläche stehen, kein
              Puls: es kommt nichts mehr (gleiche Unterscheidung wie im
              Nadel-Skelett, components/KartenNadel.tsx). */}
          {bildUrl !== null && (
            <Image
              testID={`${form.praefix}sheet-bild`}
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
      <Button variant="primary" label={form.knopfLabel} onPress={() => onAnsehen(punkt)} />
    </>
  );
}

// Eine Zeile der Gruppenliste.
export function GruppenEintrag({
  punkt, thumbUrl, stelle, form, onAnsehen,
}: {
  punkt: KartenPunkt;
  thumbUrl: string | null;
  stelle: number;
  form: SheetForm;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  const { colors } = useTheme();
  const { moment } = punkt;

  return (
    <Einblendung stelle={stelle}>
      <PressScale
        scaleTo={0.98}
        accessibilityRole="button"
        // Wortgleich zur Beschriftung der einzelnen Nadel (nadel.ts, dieselbe
        // Funktion): derselbe Moment, derselbe Weg.
        accessibilityLabel={momentLabel(moment)}
        testID={`${form.praefix}gruppe-eintrag-${moment.id}`}
        onPress={() => onAnsehen(punkt)}
      >
        <View style={zeilenStile.zeile}>
          {/* Klein und quadratisch: Radius 12 ist der Thumbnail-Wert
              (DESIGN-LANGUAGE §3), 24 gehört dem grossen Bild oben. */}
          <View style={[styles.eintragBild, { backgroundColor: colors['bg-1'] }]}>
            {thumbUrl !== null && (
              <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
          </View>
          <View style={zeilenStile.text}>
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

// Die Momente einer Gruppe, die sich nicht auseinanderzoomen lässt
// (features/karte/gruppenTipp.ts, `zoomAussichtslos`). Jeder Eintrag führt
// über denselben Weg in den Player wie ein einzelner Moment, und keiner davon
// ist ein Primär-Button: es gibt genau einen pro Screen, und den trägt das
// Moment-Sheet.
export function GruppenSheetInhalt({
  punkte, urls, form, onAnsehen,
}: {
  punkte: KartenPunkt[];
  urls: ReadonlyMap<string, BildQuelle>;
  form: SheetForm;
  onAnsehen: (punkt: KartenPunkt) => void;
}) {
  return (
    // Die Liste scrollt (siehe SheetScroll): auf einem Fleck können beliebig
    // viele Momente liegen, und Zoomen hilft dort per Definition nicht,
    // abgeschnittene Einträge wären auf keinem anderen Weg mehr erreichbar.
    <SheetScroll testID={`${form.praefix}gruppe-liste`}>
      {punkte.map((p, stelle) => (
        <GruppenEintrag
          key={p.moment.id}
          punkt={p}
          thumbUrl={nadelBild(urls, p.moment.id)}
          stelle={stelle}
          form={form}
          onAnsehen={onAnsehen}
        />
      ))}
    </SheetScroll>
  );
}

// Die Form einer Zeile in einer Sheet-Liste. Exportiert, weil der
// Kartenscreen der App dieselbe Form für seine Tagesliste braucht: sie steht
// in demselben Sheet-Raum und darf nicht anders aussehen als die
// Gruppenliste daneben.
export const zeilenStile = StyleSheet.create({
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  // `flex: 1` nimmt den Rest der Zeile, ohne das schöbe eine lange Caption
  // die Zeile über den Rand hinaus, statt in `numberOfLines` abgeschnitten zu
  // werden.
  text: { flex: 1, gap: spacing.xs },
});

const styles = StyleSheet.create({
  // Spec §5.7: Bild in 3:2, Radius 24 (DESIGN-LANGUAGE §3, der Cover-Wert).
  // `overflow: hidden` beschneidet das Bild auf diesen Radius; einen Schatten
  // trägt es nicht, der gehört dem Sheet darunter.
  sheetBild: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  // Enger als der Abstand, den das Sheet zwischen seinen Kindern hält: die
  // drei Zeilen gehören zusammen (4er-Raster, §3).
  sheetText: { gap: spacing.xs },
  // Derselbe Abstand, den `Sheet` zwischen seinen eigenen Kindern hält, er
  // gilt innerhalb der ScrollView nicht mehr weiter.
  scrollInhalt: { gap: spacing.base },
  eintragBild: { width: 56, height: 56, borderRadius: radius.control, overflow: 'hidden' },
});
