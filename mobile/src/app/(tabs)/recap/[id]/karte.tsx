import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft } from 'lucide-react-native';
import { KartenNadelMarker } from '@/components/KartenNadel';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { meldeFehler } from '@/lib/fehlermelder';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat, type MedienUrl } from '@/features/recap/urlVorrat';
import { ausschnittFuer } from '@/features/karte/ausschnitt';
import { gruppiere } from '@/features/karte/gruppierung';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import type { Ausschnitt, Gruppe, KartenPunkt } from '@/features/karte/typen';

// Eine feste leere Map statt `new Map()` bei jedem Zurücksetzen: der Wert geht
// als Abhängigkeit in die Nadeln, und eine jedes Mal neue Map liesse sie ohne
// Grund neu rechnen.
const KEINE_URLS: ReadonlyMap<string, MedienUrl> = new Map();

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

  useEffect(() => {
    let aktiv = true;
    void Promise.all([fetchRecapMomente(id), holeVorrat(id)])
      .then(([momente, { vorrat }]) => {
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
      });
    return () => {
      aktiv = false;
    };
  }, [id]);

  // Der sichtbare Ausschnitt wandert bei jeder Kartenbewegung in den State:
  // Task 7 gruppiert Nadeln nach ihrem Abstand in BILDSCHIRMpunkten und
  // braucht dafür den aktuellen Zoom, nicht den anfänglichen.
  const merkeAusschnitt = useCallback((region: Region) => setAusschnitt(region), []);

  // Die Linie der Reise (Spec K3/§5.6). `punkte` kommt aus zuKartenPunkten
  // bereits nach `captured_at` sortiert — hier wird bewusst NICHT noch einmal
  // sortiert: die Linie zeigt, in welcher Reihenfolge aufgenommen wurde, nie,
  // in welcher hochgeladen wurde.
  //
  // `useMemo` ist hier nicht Feinschliff: `merkeAusschnitt` lässt den Screen
  // bei jeder Kartenbewegung neu rendern, und ein bei jedem Rendern neues
  // Koordinaten-Array schickte die Polyline jedes Mal erneut über die Brücke.
  const linie = useMemo(
    () => punkte.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [punkte]
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
    () => (ausschnitt ? gruppiere(punkte, ausschnitt, breite, hoehe) : []),
    [punkte, ausschnitt, breite, hoehe]
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
  // Mitglied, kein Anker). Heute fiele der Tipp nur still aus; ab Task 8 wäre
  // es ein verschlucktes Moment-Sheet.
  const stand = useRef<{ gruppen: Gruppe[]; ausschnitt: Ausschnitt | null }>({ gruppen, ausschnitt });
  useLayoutEffect(() => {
    stand.current = { gruppen, ausschnitt };
  }, [gruppen, ausschnitt]);

  // Ein Tipp auf eine Gruppe fährt in sie hinein, statt ein Sheet zu öffnen
  // (Spec §5.5): wer auf der Karte sucht, will die Karte benutzen.
  const aufNadel = useCallback(
    (anker: KartenPunkt) => {
      const { gruppen: aktuelle, ausschnitt: sichtbar } = stand.current;
      const gruppe = aktuelle.find((g) => g.anker === anker);
      if (!gruppe || !sichtbar) return;
      // Genau ein Punkt ist keine Gruppe: dorthin führt das Moment-Sheet
      // (Task 8), keine Kamerafahrt — der Moment soll nicht unter dem Sheet
      // wegrutschen, während man ihn liest.
      if (gruppe.punkte.length === 1) return;

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
    [zeige]
  );

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
});
