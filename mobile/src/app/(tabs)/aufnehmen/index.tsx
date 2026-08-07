import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ausloeser } from '@/components/Ausloeser';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { fetchTrips } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';

// Höchstdauer eines Videos (Produktkonzept: Snapchat-Muster, Ring stoppt hier
// von selbst) — dieselbe Zahl geht an den Auslöser UND an CameraView.recordAsync.
const MAX_VIDEO_SEKUNDEN = 30;

function momenteText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment' : 'Momente'}`;
}

// Medien-Screen (DESIGN-LANGUAGE v2 §1): feste Kino-Palette, kein useTheme().
// `accent`/`on-accent` sind bewusst direkt aus den Tokens statt aus dem
// Theme importiert — sie sind reine Interaktionsfarben und funktionieren
// unabhängig von Hell/Kino gleich (siehe Button.tsx-Rezept für „primär").
function KinoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.kinoButton}>
        <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function LeererKinoScreen() {
  return <View style={styles.screen} />;
}

function FehlerScreen({ fehler, onRetry }: { fehler: string; onRetry: () => void }) {
  return (
    <View style={[styles.screen, styles.mitte]}>
      <Text style={[type.h2, styles.titel]}>Das hat nicht geklappt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>{fehler}</Text>
      <View style={{ marginTop: spacing.xl }}>
        <KinoButton label="Nochmal versuchen" onPress={onRetry} />
      </View>
    </View>
  );
}

function KeineReiseScreen({ onAnlegen }: { onAnlegen: () => void }) {
  return (
    <View style={[styles.screen, styles.mitte]}>
      <Text style={[type.h2, styles.titel]}>Keine laufende Reise</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        Leg deine erste Reise an oder tritt einer per Einladungslink bei — sobald sie läuft,
        fängt hier deine Kamera an.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <KinoButton label="Neue Reise anlegen" onPress={onAnlegen} />
      </View>
    </View>
  );
}

function BerechtigungScreen() {
  return (
    <View style={[styles.screen, styles.mitte]}>
      <Text style={[type.h2, styles.titel]}>Kamera-Zugriff fehlt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        Reelive braucht Zugriff auf Kamera und Mikrofon, um Momente aufzunehmen. Erlaube das in
        den Systemeinstellungen.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <KinoButton label="Einstellungen öffnen" onPress={() => void Linking.openSettings()} />
      </View>
    </View>
  );
}

function ReiseWahlScreen({ reisen, onWahl }: { reisen: Trip[]; onWahl: (id: string) => void }) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.wahlInhalt}>
        <Text style={[type.h2, styles.titel, { marginBottom: spacing.l }]}>Für welche Reise?</Text>
        {reisen.map((reise) => (
          <PressScale key={reise.id} accessibilityRole="button" onPress={() => onWahl(reise.id)}>
            <View style={styles.wahlZeile}>
              <Text style={[type.bodyMedium, styles.titel]}>{reise.name}</Text>
              <Text style={[type.secondary, styles.text]}>{momenteText(reise.my_post_count)}</Text>
            </View>
          </PressScale>
        ))}
      </ScrollView>
    </View>
  );
}

export default function AufnehmenScreen() {
  const router = useRouter();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ausgewaehlteReiseId, setAusgewaehlteReiseId] = useState<string | null>(null);
  const [modus, setModus] = useState<'picture' | 'video'>('picture');
  const cameraRef = useRef<CameraView>(null);
  const videoStartZeit = useRef(0);
  const videoPromise = useRef<Promise<{ uri: string } | undefined> | null>(null);
  // Schirmt setState nach Blur/Unmount ab (gleiches Muster wie reise/index.tsx).
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const { data, error } = await fetchTrips();
    if (!aktiv.current) return;
    setTrips(data);
    setFehler(error);
  }, []);

  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  // Medien-Screens stellen die StatusBar lokal um (DESIGN-LANGUAGE v2 §1).
  // Ein gemountetes <StatusBar style="light" /> würde nicht reichen, weil
  // Tab-Screens gemountet bleiben — daher fokus-abhängig umschalten und beim
  // Verlassen wieder auf 'dark' zurücksetzen (globaler Default in _layout.tsx).
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [])
  );

  // Berechtigungen proaktiv anfragen, sobald der aktuelle Stand bekannt ist —
  // kamera-first (Produktkonzept) heisst, der Nutzer soll nicht erst einen
  // Knopf suchen müssen, um überhaupt gefragt zu werden. Erst wenn eine
  // Anfrage tatsächlich abgelehnt wurde, zeigt BerechtigungScreen den Weg in
  // die Systemeinstellungen.
  useEffect(() => {
    if (cameraPermission?.status === 'undetermined') void requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);
  useEffect(() => {
    if (micPermission?.status === 'undetermined') void requestMicPermission();
  }, [micPermission, requestMicPermission]);

  // `mode` muss committet sein, bevor recordAsync() die native Aufnahme-
  // Pipeline anspricht (CameraViewProps.mode „selects image or video
  // output") — deshalb hier per Effekt statt direkt im Tastendruck-Handler.
  useEffect(() => {
    if (modus !== 'video') return;
    videoPromise.current =
      cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SEKUNDEN }) ?? null;
  }, [modus]);

  if (trips === null) return <LeererKinoScreen />;
  if (fehler) {
    return (
      <FehlerScreen
        fehler={fehler}
        onRetry={() => {
          setTrips(null);
          void laden();
        }}
      />
    );
  }

  const aktiveReisen = trips.filter((t) => t.status === 'active');
  if (aktiveReisen.length === 0) {
    return <KeineReiseScreen onAnlegen={() => router.push('/reise/neu')} />;
  }

  const reise =
    aktiveReisen.length === 1
      ? aktiveReisen[0]
      : (aktiveReisen.find((t) => t.id === ausgewaehlteReiseId) ?? null);
  if (!reise) {
    return <ReiseWahlScreen reisen={aktiveReisen} onWahl={setAusgewaehlteReiseId} />;
  }

  // Die Aufnahme verlässt diesen Screen nur als Dateipfad plus Typ (bewusste
  // Grenze, siehe Auftrag) — dazu kommt `tripId`, weil Task 8 daraus den
  // Speicherschlüssel und den Queue-Job baut; eine Kennung ist nichts
  // Bibliotheksspezifisches, verletzt die Grenze also nicht. `/aufnehmen/
  // preview` selbst entsteht erst in Task 8 und fehlt darum noch in der
  // generierten (gitignorten) Routen-Liste `.expo/types/router.d.ts`. Der
  // Cast über `unknown` (statt `any`, siehe Präzedenz in joinFlow.ts) ist
  // bewusst temporär: sobald Task 8 die Route anlegt, entfällt er ersatzlos.
  const zurPreview = (params: { uri: string; typ: 'photo' | 'video'; dauer: string; tripId: string }) => {
    router.push({ pathname: '/aufnehmen/preview', params } as unknown as Href);
  };

  const handleFoto = async () => {
    const foto = await cameraRef.current?.takePictureAsync();
    if (!foto?.uri) return;
    zurPreview({ uri: foto.uri, typ: 'photo', dauer: '0', tripId: reise.id });
  };

  const handleVideoStart = () => {
    videoStartZeit.current = Date.now();
    setModus('video');
  };

  const handleVideoStop = async () => {
    cameraRef.current?.stopRecording();
    const ergebnis = await videoPromise.current;
    videoPromise.current = null;
    setModus('picture');
    if (!ergebnis?.uri) return;
    const dauer = Math.round((Date.now() - videoStartZeit.current) / 1000);
    zurPreview({ uri: ergebnis.uri, typ: 'video', dauer: String(dauer), tripId: reise.id });
  };

  // Drei Zustände statt zwei (Fix-Runde 1: die vorherige Fassung behandelte
  // "noch nicht gefragt"/"gerade am Fragen" fälschlich wie "abgelehnt", weil
  // `status: 'undetermined'` ebenfalls `granted: false` trägt):
  //   - null            -> Antwort noch unbekannt, nichts behaupten (warten)
  //   - 'undetermined'   -> weder gefragt noch beantwortet (die Anfrage läuft
  //                         evtl. gerade, der Systemdialog kann offen sein) ->
  //                         ebenfalls warten, NIE den Settings-Screen zeigen
  //   - 'denied'         -> tatsächlich abgelehnt -> erst hier der Weg in die
  //                         Systemeinstellungen
  if (cameraPermission === null || micPermission === null) return <LeererKinoScreen />;
  if (cameraPermission.status === 'denied' || micPermission.status === 'denied') {
    return <BerechtigungScreen />;
  }
  if (!cameraPermission.granted || !micPermission.granted) {
    // 'undetermined': weder gefragt noch beantwortet — die Anfrage kann
    // gerade laufen, der Systemdialog kann offen sein. Warten, nichts
    // behaupten, NIE den Settings-Screen zeigen.
    return <LeererKinoScreen />;
  }

  return (
    <View style={styles.screen}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode={modus}
        videoQuality="1080p"
      />
      <View style={styles.kopfPille}>
        <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{reise.name}</Text>
        <Text style={[type.secondary, { color: cinema['text-2'] }]}>
          {momenteText(reise.my_post_count)}
        </Text>
      </View>
      <View style={styles.ausloeserWrap}>
        <Ausloeser
          onFoto={() => void handleFoto()}
          onVideoStart={handleVideoStart}
          onVideoStop={() => void handleVideoStop()}
          maxSekunden={MAX_VIDEO_SEKUNDEN}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  mitte: { justifyContent: 'center', padding: spacing.screen },
  titel: { color: cinema['text-1'] },
  text: { color: cinema['text-2'] },
  kinoButton: {
    height: 52,
    borderRadius: radius.control,
    // DESIGN-LANGUAGE §1: accent ist Interaktionsfarbe, funktioniert
    // unabhängig von Hell/Kino gleich — deshalb direkt aus `palette`, nicht
    // aus `cinema` (das nur Hintergrund/Text der Medien-Screens definiert).
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
  wahlInhalt: { padding: spacing.screen, paddingTop: spacing.xl },
  wahlZeile: {
    padding: spacing.base,
    borderRadius: radius.control,
    backgroundColor: cinema['bg-1'],
    marginBottom: spacing.m,
    gap: spacing.xs,
  },
  // Pille auf der Kamera-Vorschau (DESIGN-LANGUAGE §1/§4): translucent, Radius
  // 999. Ohne echten Blur (expo-blur ist nicht installiert) — siehe Bericht.
  kopfPille: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.screen,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
  },
  ausloeserWrap: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
  },
});
