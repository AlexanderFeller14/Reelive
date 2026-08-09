import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { SwitchCamera, Zap, ZapOff } from 'lucide-react-native';
import { Ausloeser } from '@/components/Ausloeser';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import type { GemerkteReise } from '@/features/trips/tripsCache';
import { eigenerZaehler } from '@/features/moments/zaehler';
import { useAuth } from '@/features/auth/AuthProvider';

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

// Spec §4 verlangt beides wörtlich: «Kamera wechseln und Blitz als translucente
// Pillen». §10 nimmt nur den Trip-Umschalter aus — im Plan kam «Blitz»
// nirgends vor (Final-Review, Important 7). Für ein gemeinsames Reisetagebuch
// heisst keine Frontkamera: keine Gruppenbilder.
//
// Translucente Pille nach DESIGN-LANGUAGE §1/§4: `overlay-pill` + Blur
// (Task 10, Phase 6 — siehe components/Pille.tsx), Radius 999. Icons:
// Lucide, Outline, Stroke 1.75 (§4).
function PillenKnopf({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Pille style={styles.steuerPille}>{children}</Pille>
    </PressScale>
  );
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
        Leg deine erste Reise an oder tritt einer per Einladungslink bei. Sobald sie läuft,
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

function ReiseWahlScreen({ reisen, onWahl }: { reisen: GemerkteReise[]; onWahl: (id: string) => void }) {
  // Der einzige Teil dieses Kino-Screens, der von oben nach unten gelesen
  // wird — der Sucher selbst bleibt randlos und hat oben nichts zu schonen.
  const oben = useOberkante(spacing.xl);
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.wahlInhalt, { paddingTop: oben }]}>
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
  const { userId } = useAuth();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [trips, setTrips] = useState<GemerkteReise[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ausgewaehlteReiseId, setAusgewaehlteReiseId] = useState<string | null>(null);
  const [modus, setModus] = useState<'picture' | 'video'>('picture');
  const [richtung, setRichtung] = useState<'back' | 'front'>('back');
  const [blitz, setBlitz] = useState<'off' | 'on'>('off');
  // Zähler-Nachzug aus Task 9 (Task-10-Auftrag): Serverstand PLUS wartende
  // Momente derselben Reise (eigenerZaehler), statt beim reinen
  // reise.my_post_count einzufrieren — sonst bewegt sich die Pille nach
  // einer Offline-Aufnahme nicht (Spec §7, „darf nie rückwärts wirken").
  // Bleibt `null`, bis die erste Antwort da ist — bis dahin zeigt die Pille
  // den zuletzt bekannten Serverstand statt kurz „0 Momente" aufblitzen zu
  // lassen (siehe Fallback beim Rendern unten).
  const [zaehler, setZaehler] = useState<number | null>(null);
  // Wird bei jedem Fokussieren hochgezählt und hängt am Zähler-Effekt unten
  // (siehe dort und useFocusEffect).
  const [fokusStand, setFokusStand] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  const videoStartZeit = useRef(0);
  const videoPromise = useRef<Promise<{ uri: string } | undefined> | null>(null);
  // Schirmt setState nach Blur/Unmount ab (gleiches Muster wie reise/index.tsx).
  const aktiv = useRef(true);

  // Vor den frühen Returns berechnet (Rules of Hooks: der Effekt weiter unten
  // braucht `reise?.id` als Abhängigkeit, und Hooks dürfen nicht hinter einem
  // bedingten Return stehen). `trips` kann hier noch `null` sein (noch nicht
  // geladen) — dann bleibt `aktiveReisen` leer und `reise` `null`, was der
  // Effekt unten und die späteren Returns bereits abfangen.
  const aktiveReisen = (trips ?? []).filter((t) => t.status === 'active');
  const reise =
    aktiveReisen.length === 1
      ? aktiveReisen[0]
      : (aktiveReisen.find((t) => t.id === ausgewaehlteReiseId) ?? null);

  // Der Kern des Offline-Versprechens dieser Phase (Final-Review, Critical 1):
  // «Aufnehmen funktioniert vollständig offline» — aber der Sucher erscheint
  // erst, wenn eine laufende Reise bekannt ist. Ohne lokalen Bestand lieferte
  // fetchTrips() im Flugmodus `{ data: [], error: OFFLINE_HINT }`, und statt
  // Sucher und Auslöser stand hier eine Fehlerseite: Queue, Kompression,
  // Worker und Versiegelung alle korrekt — und alle unerreichbar.
  //
  // Deshalb: jeder erfolgreiche Abruf schreibt den Bestand fort, ein
  // gescheiterter greift darauf zurück. Die Fehlerseite bleibt nur für den
  // Fall, dass es auch nichts Vorgehaltenes gibt (`null`, also noch nie
  // erfolgreich geladen). Ein vorgehaltener LEERER Bestand ist dagegen eine
  // Aussage — «du hattest zuletzt keine Reise» — und führt bewusst auf
  // KeineReiseScreen statt auf die Fehlerseite.
  // Setzt für jede Reise den zuletzt bekannten Zähler ein. Die Quelle dafür ist
  // der vorgehaltene Bestand selbst — er trägt den Zähler ohnehin mit sich, und
  // anders als der separate Zählerspeicher (den nur eigenerZaehler pflegt, also
  // nur für die GEWÄHLTE Reise) deckt er auch den Auswahl-Schritt ab, bei dem
  // noch gar keine Reise gewählt ist. Wo es keinen gemerkten Stand gibt, bleibt
  // es beim gelieferten Wert — eine 0, die dann wirklich nur «noch nichts
  // eingesendet» heissen kann.
  const mitGemerktenZaehlern = useCallback(
    async (reisen: GemerkteReise[]): Promise<GemerkteReise[]> => {
      const gemerkt = await tripsCache.gemerkteReisen(userId);
      if (gemerkt === null) return reisen;
      const stand = new Map(gemerkt.map((r) => [r.id, r.my_post_count]));
      return reisen.map((r) => ({ ...r, my_post_count: stand.get(r.id) ?? r.my_post_count }));
    },
    [userId]
  );

  const laden = useCallback(async () => {
    const { data, error, zaehlerFehler } = await fetchTrips();
    if (!error) {
      // Re-Review, Minor 2: gelingen die Reisen und scheitert nur die
      // Zähler-rpc, trägt jede Reise `my_post_count: 0`. Die Kopf-Pille fängt
      // das über eigenerZaehler ab — der Auswahl-Screen bei mehreren
      // laufenden Reisen aber nicht, und in den vorgehaltenen Bestand
      // wanderten die Nullen ebenfalls. Also: ein ausgefallener Zähler-Abruf
      // greift auf den zuletzt bekannten Stand zurück, genau wie in
      // zaehler.ts. Dieselbe Klasse wie Important 6, eine Ebene weiter.
      const reisen = zaehlerFehler ? await mitGemerktenZaehlern(data) : data;
      // Fortschreiben passiert vor dem aktiv-Guard: der Bestand soll auch
      // dann aktuell werden, wenn der Screen inzwischen verlassen wurde.
      await tripsCache.reisenMerken(userId, reisen);
      if (!aktiv.current) return;
      setTrips(reisen);
      setFehler(null);
      return;
    }
    const gemerkt = await tripsCache.gemerkteReisen(userId);
    if (!aktiv.current) return;
    if (gemerkt !== null) {
      setTrips(gemerkt);
      setFehler(null);
      return;
    }
    setTrips([]);
    setFehler(error);
  }, [userId, mitGemerktenZaehlern]);

  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      // Zählt jedes Fokussieren hoch. Der Zähler-Effekt weiter unten hängt
      // daran (Important 3): bis zur Fix-Welle wirkte er nur deshalb richtig,
      // weil preview.tsx per replace bei JEDER Aufnahme einen neuen
      // Kamera-Screen erzeugte — sein Effekt lief also zwangsläufig neu.
      // Nimmt man diesen Stapel-Fehler weg, ohne den Abruf ans Fokussieren zu
      // hängen, friert der Zähler für die ganze Sitzung ein: genau die
      // Regression, für die es Task 10 gab. Beides gehört zusammen.
      setFokusStand((n) => n + 1);
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

  // Zieht den Zähler bei jedem Reise-Wechsel UND bei jedem Fokussieren nach
  // (`fokusStand`, Important 3) — ohne `reise` gibt es nichts zu zählen.
  // Genau hier landet die Rückkehr aus der Vorschau: der Moment steckt dann
  // frisch in der Warteschlange, die Pille muss ihn mitzählen.
  // eigenerZaehler kann ablehnen (kaputte lokale Warteschlange, siehe
  // queueDb.ts) — ohne .catch() bliebe das eine unbehandelte Ablehnung; der
  // Fallback auf reise.my_post_count beim Rendern unten greift dann einfach
  // weiter (Fix-Runde 1).
  useEffect(() => {
    if (!reise) return;
    void eigenerZaehler(reise.id)
      .then((n) => {
        if (aktiv.current) setZaehler(n);
      })
      .catch(() => {});
  }, [reise?.id, fokusStand]);

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

  if (aktiveReisen.length === 0) {
    return <KeineReiseScreen onAnlegen={() => router.push('/reise/neu')} />;
  }

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
        facing={richtung}
        mode={modus}
        // `flash` gilt für Fotos; beim Video braucht es stattdessen das
        // Dauerlicht — derselbe Schalter, zwei Prop-Namen.
        flash={blitz}
        enableTorch={blitz === 'on' && modus === 'video'}
        videoQuality="1080p"
      />
      <View style={styles.kopfZeile}>
        <Pille style={styles.kopfPille}>
          {/* numberOfLines: ein einzelnes langes Wort (Reisenamen sind frei
              wählbar) würde die geschrumpfte Pille sonst überlaufen statt
              gekürzt zu werden. */}
          <Text numberOfLines={1} style={[type.bodyMedium, { color: cinema['text-1'] }]}>
            {reise.name}
          </Text>
          <Text style={[type.secondary, { color: cinema['text-2'] }]}>
            {momenteText(zaehler ?? reise.my_post_count)}
          </Text>
        </Pille>
        <View style={styles.steuerung}>
          <PillenKnopf
            label="Kamera wechseln"
            onPress={() => setRichtung((r) => (r === 'back' ? 'front' : 'back'))}
          >
            <SwitchCamera size={22} color={cinema['text-1']} strokeWidth={1.75} />
          </PillenKnopf>
          <PillenKnopf
            label={blitz === 'on' ? 'Blitz ausschalten' : 'Blitz einschalten'}
            onPress={() => setBlitz((b) => (b === 'on' ? 'off' : 'on'))}
          >
            {blitz === 'on' ? (
              <Zap size={22} color={cinema['text-1']} strokeWidth={1.75} />
            ) : (
              <ZapOff size={22} color={cinema['text-2']} strokeWidth={1.75} />
            )}
          </PillenKnopf>
        </View>
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
  // Eine Zeile für alles, was oben auf dem Sucher liegt: links die Kopf-Pille,
  // rechts die Steuerung (Re-Review, Minor 1). Vorher lagen beide einzeln
  // absolut positioniert übereinander — solange rechts nichts war, fiel nicht
  // auf, dass die Kopf-Pille unbegrenzt breit wird; mit der Steuerung daneben
  // läuft ein langer Reisename darunter. Die Zeile begrenzt die Pille
  // (flexShrink), ohne die Steuerung zu verschieben: sie sitzt weiterhin am
  // rechten Screen-Rand (§3, Ränder 24).
  kopfZeile: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.screen,
    right: spacing.screen,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.m,
  },
  // Pille auf der Kamera-Vorschau (DESIGN-LANGUAGE §1/§4): translucent, Radius
  // 999, Blur über components/Pille.tsx (kein backgroundColor hier — das
  // übernimmt die Pille-Komponente selbst).
  kopfPille: {
    flexShrink: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  // Kamera wechseln und Blitz (Spec §4): rechts oben, auf Höhe der Kopf-Pille,
  // untereinander im 4er-Raster (§3). flexShrink: 0 — schrumpfen soll die
  // Pille, nicht die Bedienelemente.
  steuerung: {
    flexShrink: 0,
    gap: spacing.m,
  },
  steuerPille: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ausloeserWrap: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
  },
});
