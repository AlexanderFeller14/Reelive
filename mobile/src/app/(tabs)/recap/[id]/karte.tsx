import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Polyline, type Region } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { KartenNadelMarker } from '@/components/KartenNadel';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { meldeFehler } from '@/lib/fehlermelder';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { holeVorrat, type MedienUrl } from '@/features/recap/urlVorrat';
import { ausschnittFuer } from '@/features/karte/ausschnitt';
import { zuKartenPunkten } from '@/features/karte/kartenPunkte';
import type { Ausschnitt, KartenPunkt } from '@/features/karte/typen';

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

          {punkte.map((p) => (
            <KartenNadelMarker key={p.moment.id} punkt={p} thumbUrl={nadelBild(urls, p.moment.id)} />
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
