import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { ChevronDown, SwitchCamera, Zap, ZapOff } from 'lucide-react-native';
import { Ausloeser } from '@/components/Ausloeser';
import { Button } from '@/components/Button';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import type { GemerkteReise } from '@/features/trips/tripsCache';
import { eigenerZaehler } from '@/features/moments/zaehler';
import { useAuth } from '@/features/auth/AuthProvider';

// Höchstdauer eines Videos (Produktkonzept: Snapchat-Muster, Ring stoppt hier
// von selbst), dieselbe Zahl geht an den Auslöser UND an CameraView.recordAsync.
const MAX_VIDEO_SEKUNDEN = 30;

function momenteText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment' : 'Momente'}`;
}

// Kino gilt in diesem Tab NUR dem Sucher (DESIGN-LANGUAGE v2 §1: die feste
// Kino-Palette gehört den Medien-Screens — und wo kein Bild steht, ist kein
// Medium). Jeder Zustand, der statt der Kamera nur Text zeigt, ist ein
// gewöhnlicher Alltags-Screen und liegt auf hellem Grund, wie Reise-, Recap-
// und Profil-Tab auch. Bis hierher lagen alle vier im dunklen Saal, obwohl
// nie ein Foto darin vorkam.
//
// Auch der Wartezustand ist hell: er führt in der Mehrzahl der Fälle direkt in
// den Sucher, und genau dieser Wechsel soll laut Leitidee inszeniert werden
// («das Licht geht aus»), nicht dadurch verschwinden, dass es vorher schon
// dunkel war.
function LeererScreen() {
  return <View style={styles.hell} />;
}

// Spec §4 verlangt beides wörtlich: «Kamera wechseln und Blitz als translucente
// Pillen». §10 nimmt nur den Trip-Umschalter aus, im Plan kam «Blitz»
// nirgends vor (Final-Review, Important 7). Für ein gemeinsames Reisetagebuch
// heisst keine Frontkamera: keine Gruppenbilder.
//
// Translucente Pille nach DESIGN-LANGUAGE §1/§4: `overlay-pill` + Blur
// (Task 10, Phase 6, siehe components/Pille.tsx), Radius 999. Icons:
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
    <View style={[styles.hell, styles.mitte]}>
      <Text style={[type.h2, styles.titel]}>Das hat nicht geklappt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>{fehler}</Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button variant="primary" label="Nochmal versuchen" onPress={onRetry} />
      </View>
    </View>
  );
}

// Hub des Schwebens. 12 aus dem 4er-Raster (§3), gross genug, dass die
// Bewegung trägt, klein genug, dass sie den Text darunter nicht anschubst.
const SCHWEBE_HUB = 12;

// Breite des Bildes, zugleich seine Obergrenze (siehe styles.ticketFlaeche).
const TICKET_BREITE = 288;

// Eine Dauer ausserhalb der Token-Skala, und zwar bewusst: die Skala (§5)
// bemisst ÜBERGÄNGE, also wie lange etwas braucht, um etwas anderes zu werden.
// `gentle` (400) reicht dem Skeleton-Puls, ein Schweben in dem Tempo wäre
// Zappeln, und `feature` (800) ist laut §5 Inszenierungen vorbehalten. 2400 ms
// pro Richtung sind knapp fünf Sekunden pro Runde: Bewegung, die man bemerkt,
// wenn man hinsieht, und die einen sonst in Ruhe lässt.
const SCHWEBE_MS = 2400;

// Freigestellt und schwebend (Wunsch): das Ticket hebt und senkt sich.
//
// Ohne Schatten, vorerst ausdrücklich so gewollt. Drei Anläufe scheiterten am
// selben Punkt: das Ticket liegt im PNG gekippt (4 Grad, an seiner Unterkante
// gemessen) und endet bei 84 % der Bildhöhe, jede gezeichnete Form darunter
// muss beides von Hand treffen. Wer ihn nachrüstet, fängt hier an.
//
// Animiert werden ausschliesslich `transform` und `opacity` (§5), beides läuft
// damit über `useNativeDriver`.
function SchwebendesFlugticket() {
  const reducedMotion = useReducedMotion();
  // 0 = unten (Ruhelage), 1 = oben. `useState` statt `useRef`, weil der Wert
  // beim Rendern gelesen wird (interpolate) und ein Ref dort nichts zu suchen
  // hat.
  const [schwebe] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      schwebe.setValue(0);
      return;
    }
    // Symmetrisches ease-in-out statt `easeSmooth`: das ist ein ease-OUT und
    // schnellt an jedem Umkehrpunkt los, was bei einem Hin und Her als Ruck
    // sichtbar wird. Ein Schweben ist eine Sinusbewegung, an beiden Enden
    // gleich langsam. `linear` bleibt in jedem Fall verboten (§7).
    const easing = Easing.inOut(Easing.ease);
    const runde = Animated.loop(
      Animated.sequence([
        Animated.timing(schwebe, { toValue: 1, duration: SCHWEBE_MS, easing, useNativeDriver: true }),
        Animated.timing(schwebe, { toValue: 0, duration: SCHWEBE_MS, easing, useNativeDriver: true }),
      ])
    );
    runde.start();
    return () => runde.stop();
  }, [reducedMotion, schwebe]);

  const hoehe = schwebe.interpolate({ inputRange: [0, 1], outputRange: [0, -SCHWEBE_HUB] });

  return (
    <View style={styles.ticketBuehne}>
      <Animated.View style={[styles.ticketFlaeche, { transform: [{ translateY: hoehe }] }]}>
        <Image
          testID="leerzustand-flugticket"
          source={require('@/assets/images/flugticket-transparent.png')}
          style={styles.flugticket}
          contentFit="contain"
          // Sagt nichts, was der Text darunter nicht schon sagt.
          accessible={false}
        />
      </Animated.View>
    </View>
  );
}

function KeineReiseScreen({ onAnlegen }: { onAnlegen: () => void }) {
  return (
    <View style={[styles.hell, styles.mitte]}>
      {/* Dritter Leerzustand mit eigenem Bild, nach Camper (Reise-Tab) und
          Filmrolle (Recap-Tab): das Bild steht NUR dort, wo sonst nichts
          steht. */}
      <SchwebendesFlugticket />
      <Text style={[type.h2, styles.titel]}>Keine laufende Reise</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        Leg deine erste Reise an oder tritt einer per Einladungslink bei. Sobald sie läuft,
        fängt hier deine Kamera an.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button variant="primary" label="Neue Reise anlegen" onPress={onAnlegen} />
      </View>
    </View>
  );
}

function BerechtigungScreen() {
  return (
    <View style={[styles.hell, styles.mitte]}>
      <Text style={[type.h2, styles.titel]}>Kamera-Zugriff fehlt</Text>
      <Text style={[type.body, styles.text, { marginTop: spacing.s }]}>
        Reelive braucht Zugriff auf Kamera und Mikrofon, um Momente aufzunehmen. Erlaube das in
        den Systemeinstellungen.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button
          variant="primary"
          label="Einstellungen öffnen"
          onPress={() => void Linking.openSettings()}
        />
      </View>
    </View>
  );
}

function ReiseWahlScreen({ reisen, onWahl }: { reisen: GemerkteReise[]; onWahl: (id: string) => void }) {
  // Wird von oben nach unten gelesen und braucht darum die geschonte
  // Oberkante. Der Sucher braucht sie inzwischen ebenso: randlos ist dort das
  // Kamerabild (§3, «Fotos randlos in Medien-Screens»), nicht die Bedienung,
  // die darauf liegt. Solange hier «der Sucher hat oben nichts zu schonen»
  // stand, klebte die Reise-Pille auf Geräten mit Dynamic Island an der Uhr.
  const oben = useOberkante(spacing.xl);
  return (
    <View style={styles.hell}>
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
  // Der Trip-Umschalter aus dem Produktkonzept («Oben dezent: aktiver
  // Trip-Name, bei mehreren aktiven Reisen wechselbar»). Ohne diesen Zustand
  // war der Auswahl-Screen eine Einbahnstrasse: einmal gewählt, führte kein
  // Weg zurück, und bei genau einer laufenden Reise war er nie erreichbar,
  // weil die Reise fest verdrahtet wurde.
  const [wahlOffen, setWahlOffen] = useState(false);
  const [modus, setModus] = useState<'picture' | 'video'>('picture');
  const [richtung, setRichtung] = useState<'back' | 'front'>('back');
  const [blitz, setBlitz] = useState<'off' | 'on'>('off');
  // Zähler-Nachzug aus Task 9 (Task-10-Auftrag): Serverstand PLUS wartende
  // Momente derselben Reise (eigenerZaehler), statt beim reinen
  // reise.my_post_count einzufrieren, sonst bewegt sich die Pille nach
  // einer Offline-Aufnahme nicht (Spec §7, „darf nie rückwärts wirken").
  // Bleibt `null`, bis die erste Antwort da ist, bis dahin zeigt die Pille
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
  // geladen), dann bleibt `aktiveReisen` leer und `reise` `null`, was der
  // Effekt unten und die späteren Returns bereits abfangen.
  const aktiveReisen = (trips ?? []).filter((t) => t.status === 'active');
  // `wahlOffen` schlägt alles: wer den Reisenamen antippt, will die Auswahl
  // sehen, auch wenn nur eine Reise läuft und die Automatik sie sonst sofort
  // wieder einsetzen würde.
  const reise = wahlOffen
    ? null
    : aktiveReisen.length === 1
      ? aktiveReisen[0]
      : (aktiveReisen.find((t) => t.id === ausgewaehlteReiseId) ?? null);

  // Der Kern des Offline-Versprechens dieser Phase (Final-Review, Critical 1):
  // «Aufnehmen funktioniert vollständig offline», aber der Sucher erscheint
  // erst, wenn eine laufende Reise bekannt ist. Ohne lokalen Bestand lieferte
  // fetchTrips() im Flugmodus `{ data: [], error: OFFLINE_HINT }`, und statt
  // Sucher und Auslöser stand hier eine Fehlerseite: Queue, Kompression,
  // Worker und Versiegelung alle korrekt, und alle unerreichbar.
  //
  // Deshalb: jeder erfolgreiche Abruf schreibt den Bestand fort, ein
  // gescheiterter greift darauf zurück. Die Fehlerseite bleibt nur für den
  // Fall, dass es auch nichts Vorgehaltenes gibt (`null`, also noch nie
  // erfolgreich geladen). Ein vorgehaltener LEERER Bestand ist dagegen eine
  // Aussage, «du hattest zuletzt keine Reise», und führt bewusst auf
  // KeineReiseScreen statt auf die Fehlerseite.
  // Setzt für jede Reise den zuletzt bekannten Zähler ein. Die Quelle dafür ist
  // der vorgehaltene Bestand selbst, er trägt den Zähler ohnehin mit sich, und
  // anders als der separate Zählerspeicher (den nur eigenerZaehler pflegt, also
  // nur für die GEWÄHLTE Reise) deckt er auch den Auswahl-Schritt ab, bei dem
  // noch gar keine Reise gewählt ist. Wo es keinen gemerkten Stand gibt, bleibt
  // es beim gelieferten Wert, eine 0, die dann wirklich nur «noch nichts
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
      // das über eigenerZaehler ab, der Auswahl-Screen bei mehreren
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
      // Kamera-Screen erzeugte, sein Effekt lief also zwangsläufig neu.
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
  // Tab-Screens gemountet bleiben, daher fokus-abhängig umschalten und beim
  // Verlassen wieder auf 'dark' zurücksetzen (globaler Default in _layout.tsx).
  //
  // Seit nur noch der Sucher dunkel ist, hängt der Stil am Zustand statt am
  // Tab: helle Icons auf weissem Grund wären schlicht unsichtbar. `zeigtSucher`
  // steht bewusst hier oben bei den Hooks, die Bedingung bildet exakt die Kette
  // der frühen Returns weiter unten ab — kein Zustand davor erreicht die Kamera.
  const zeigtSucher =
    trips !== null &&
    !fehler &&
    reise !== null &&
    cameraPermission?.granted === true &&
    micPermission?.granted === true;
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(zeigtSucher ? 'light' : 'dark');
      return () => setStatusBarStyle('dark');
    }, [zeigtSucher])
  );

  // Steht bei den Hooks, weil die frühen Returns weiter unten dazwischenliegen.
  // Was oben auf dem Sucher liegt, schont dieselbe Oberkante wie jeder andere
  // Screen: randlos ist das Kamerabild, nicht die Pille darauf.
  const sucherOben = useOberkante(spacing.xl);

  // Berechtigungen proaktiv anfragen, sobald der aktuelle Stand bekannt ist,
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
  // output"), deshalb hier per Effekt statt direkt im Tastendruck-Handler.
  //
  // `.catch()` direkt an der Quelle, nicht erst beim Auswerten: Scheitert die
  // Aufnahme, lehnt dieses Promise ab, und ohne das Abfangen flog der Fehler
  // in handleVideoStop aus dem `await`. Dann wurde `setModus('picture')` nie
  // erreicht, `modus` blieb auf 'video', und weil DIESER Effekt an `modus`
  // hängt, lief er nie wieder an: Der Tab nahm bis zum Neuladen kein Video
  // mehr auf. Am Simulator passiert das immer («SimulatorNotSupported»,
  // ExpoCamera/CameraViewModule.swift:290), am Gerät bei Anruf, vollem
  // Speicher oder entzogener Berechtigung.
  //
  // Ein `undefined` heisst hier «kein Video entstanden», und genau das
  // behandelt handleVideoStop unten schon (`if (!ergebnis?.uri) return`).
  useEffect(() => {
    if (modus !== 'video') return;
    videoPromise.current =
      cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SEKUNDEN }).catch(() => undefined) ??
      null;
  }, [modus]);

  // Zieht den Zähler bei jedem Reise-Wechsel UND bei jedem Fokussieren nach
  // (`fokusStand`, Important 3), ohne `reise` gibt es nichts zu zählen.
  // Genau hier landet die Rückkehr aus der Vorschau: der Moment steckt dann
  // frisch in der Warteschlange, die Pille muss ihn mitzählen.
  // eigenerZaehler kann ablehnen (kaputte lokale Warteschlange, siehe
  // queueDb.ts), ohne .catch() bliebe das eine unbehandelte Ablehnung; der
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

  if (trips === null) return <LeererScreen />;
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
    return (
      <ReiseWahlScreen
        reisen={aktiveReisen}
        onWahl={(id) => {
          setAusgewaehlteReiseId(id);
          setWahlOffen(false);
        }}
      />
    );
  }

  // Die Aufnahme verlässt diesen Screen nur als Dateipfad plus Typ (bewusste
  // Grenze, siehe Auftrag), dazu kommt `tripId`, weil Task 8 daraus den
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
  if (cameraPermission === null || micPermission === null) return <LeererScreen />;
  if (cameraPermission.status === 'denied' || micPermission.status === 'denied') {
    return <BerechtigungScreen />;
  }
  if (!cameraPermission.granted || !micPermission.granted) {
    // 'undetermined': weder gefragt noch beantwortet, die Anfrage kann
    // gerade laufen, der Systemdialog kann offen sein. Warten, nichts
    // behaupten, NIE den Settings-Screen zeigen.
    return <LeererScreen />;
  }

  return (
    <View style={styles.screen}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={richtung}
        mode={modus}
        // `flash` gilt für Fotos; beim Video braucht es stattdessen das
        // Dauerlicht, derselbe Schalter, zwei Prop-Namen.
        flash={blitz}
        enableTorch={blitz === 'on' && modus === 'video'}
        videoQuality="1080p"
      />
      {/* Läuft ein Video, verschwindet die Kopfzeile (Spec 2026-08-12). Der
          Grund ist nicht Ästhetik: Im gesperrten Zustand ist die Hand frei,
          diese Knöpfe wären also erreichbar, und ein Kamera-Wechsel mitten in
          recordAsync kann die laufende Aufnahme abbrechen. Entfernt statt nur
          ausgeblendet, damit auch VoiceOver nichts anbietet, was gerade nicht
          zu bedienen ist. */}
      {modus !== 'video' && (
        <View testID="sucher-kopfzeile" style={[styles.kopfZeile, { top: sucherOben }]}>
          {/* Der Trip-Umschalter (Produktkonzept): der Reisename IST der Knopf,
              kein zusätzliches Bedienelement auf dem Bild. Das Chevron macht das
              sichtbar, ohne mehr Platz zu verlangen als ein Icon. */}
          <PressScale
            style={styles.kopfWahl}
            accessibilityRole="button"
            accessibilityLabel={`Reise wechseln, ${reise.name}`}
            onPress={() => setWahlOffen(true)}
          >
            <Pille style={styles.kopfPille}>
              <View style={styles.kopfTexte}>
                {/* numberOfLines: ein einzelnes langes Wort (Reisenamen sind frei
                    wählbar) würde die geschrumpfte Pille sonst überlaufen statt
                    gekürzt zu werden. */}
                <Text numberOfLines={1} style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                  {reise.name}
                </Text>
                <Text style={[type.secondary, { color: cinema['text-2'] }]}>
                  {momenteText(zaehler ?? reise.my_post_count)}
                </Text>
              </View>
              <ChevronDown size={18} color={cinema['text-2']} strokeWidth={1.75} />
            </Pille>
          </PressScale>
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
      )}
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

// Die hellen Werte kommen direkt aus `palette` statt über useTheme(): diese
// Datei führt beide Paletten nebeneinander und bleibt so bei EINEM Muster
// (StyleSheet mit Token-Werten). Light-only (§1) macht beide Wege ohnehin
// deckungsgleich — `theme.colors` IST `palette`.
const styles = StyleSheet.create({
  // Der Kinosaal: nur noch der Sucher selbst.
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  // Alles andere in diesem Tab, siehe LeererScreen.
  hell: { flex: 1, backgroundColor: palette['bg-0'] },
  mitte: { justifyContent: 'center', padding: spacing.screen },
  // Grösser als Camper und Filmrolle (beide quadratisch auf 160): das Ticket
  // ist 3:2 quer und trägt diesen Screen allein, auf gleicher Fläche wirkte es
  // neben dem grossen H2 verloren. 288 × 192, beides im 4er-Raster (§3).
  //
  // Die Breite ist eine OBERGRENZE, keine feste Zahl: 288 plus die zweimal 24
  // Screen-Rand sprengen ein iPhone SE (320 breit), das Bild liefe über den
  // Rand hinaus. `width: '100%'` + `aspectRatio` lässt es auf schmalen Geräten
  // mitschrumpfen und hält dabei 3:2. Bei 1536 px Quelle bleiben über 5x
  // Reserve, scharf bis 3x ohne @2x/@3x-Dateien.
  ticketBuehne: { alignItems: 'center', marginBottom: spacing.l },
  // Der Hub bewegt nur das Bild (transform ändert kein Layout), der Schatten
  // bleibt liegen: genau daraus entsteht der Eindruck von Höhe.
  ticketFlaeche: { width: '100%', maxWidth: TICKET_BREITE },
  flugticket: { width: '100%', aspectRatio: 3 / 2 },
  titel: { color: palette['text-1'] },
  text: { color: palette['text-2'] },
  wahlInhalt: { padding: spacing.screen, paddingTop: spacing.xl },
  wahlZeile: {
    padding: spacing.base,
    borderRadius: radius.control,
    // §1: `bg-1` ist die abgesetzte Fläche auf hellem Grund.
    backgroundColor: palette['bg-1'],
    marginBottom: spacing.m,
    gap: spacing.xs,
  },
  // Eine Zeile für alles, was oben auf dem Sucher liegt: links die Kopf-Pille,
  // rechts die Steuerung (Re-Review, Minor 1). Vorher lagen beide einzeln
  // absolut positioniert übereinander, solange rechts nichts war, fiel nicht
  // auf, dass die Kopf-Pille unbegrenzt breit wird; mit der Steuerung daneben
  // läuft ein langer Reisename darunter. Die Zeile begrenzt die Pille
  // (flexShrink), ohne die Steuerung zu verschieben: sie sitzt weiterhin am
  // rechten Screen-Rand (§3, Ränder 24).
  // `top` fehlt hier bewusst: es kommt aus useOberkante und damit vom Gerät,
  // nicht aus dem Stylesheet (siehe sucherOben).
  kopfZeile: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.m,
  },
  // Das Schrumpfen sitzt am Druckbereich statt an der Pille: seit der Name ein
  // Knopf ist, liegt zwischen Zeile und Pille noch das Pressable, und ein
  // flexShrink weiter innen liesse dieses auf voller Breite stehen.
  kopfWahl: { flexShrink: 1 },
  // Pille auf der Kamera-Vorschau (DESIGN-LANGUAGE §1/§4): translucent, Radius
  // 999, Blur über components/Pille.tsx (kein backgroundColor hier, das
  // übernimmt die Pille-Komponente selbst).
  kopfPille: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  // Name und Zähler bleiben untereinander, das Chevron steht daneben. Der
  // Schrumpf-Anteil gehört den Texten, nicht dem Icon.
  kopfTexte: { flexShrink: 1 },
  // Kamera wechseln und Blitz (Spec §4): rechts oben, auf Höhe der Kopf-Pille,
  // untereinander im 4er-Raster (§3). flexShrink: 0, schrumpfen soll die
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
