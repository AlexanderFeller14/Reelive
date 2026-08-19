import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { BlurView } from 'expo-blur';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type PictureRef,
} from 'expo-camera';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { ChevronDown, SwitchCamera, Zap, ZapOff } from 'lucide-react-native';
import { Ausloeser } from '@/components/Ausloeser';
import { Button } from '@/components/Button';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { ZoomWahl } from '@/components/ZoomWahl';
import * as nativeAufnahme from '@/features/kamera/nativeAufnahme';
import * as nativeZoom from '@/features/kamera/nativeZoom';
import * as multiKamera from '@/features/kamera/multiKamera';
import {
  begrenzen,
  fingerAbstand,
  multiCamZiel,
  nativerFaktor,
  zoomGeraet,
  zugFaktor,
  type Linse,
} from '@/features/kamera/zoom';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchTrips } from '@/features/trips/tripsApi';
import * as tripsCache from '@/features/trips/tripsCache';
import type { GemerkteReise } from '@/features/trips/tripsCache';
import { ownMomentCount } from '@/features/moments/counter';
import { useAuth } from '@/features/auth/AuthProvider';
import * as uebergabe from '@/features/kamera/uebergabe';
import * as aufnahmeSperre from '@/features/kamera/aufnahmeSperre';
import * as kinoBuehne from '@/features/kamera/kinoBuehne';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Höchstdauer eines Videos, dieselbe Zahl geht an den Auslöser UND an
// CameraView.recordAsync. Ursprünglich 30 (Produktkonzept: Snapchat-Muster),
// seit dem 2026-08-14 auf User-Entscheid 90: das Story-Mass war im
// Reise-Alltag zu knapp. Der Ring am Auslöser füllt sich weiterhin über die
// volle Dauer und stoppt die Aufnahme dann von selbst.
const MAX_VIDEO_SEKUNDEN = 90;

// Wie lange der Video-Stopp höchstens auf den vorgewärmten Vorschau-Player
// wartet, bevor er trotzdem navigiert. Ein lokales Video ist in aller Regel
// nach ~100–250 ms abspielbereit; die Frist fängt nur den Ausreisser, damit
// ein zähes Laden die Navigation nie festhält.
const PLAYER_VORLAUF_MS = 400;

// Wie lange der Stopp höchstens auf das Poster (Bild 0 des Videos) wartet.
// Es entsteht parallel zum Player-Vorlauf und überbrückt in der Vorschau die
// ~0,8 s, die die VideoView am Gerät zum ersten Zeichnen braucht (gemessen
// 2026-08-14). Ohne Poster wird trotzdem navigiert — die Fläche bleibt dann
// kurz dunkel, der alte Zustand als Rückfallebene.
const POSTER_FRIST_MS = 300;

// Bild 0 der Aufnahme als Poster, oder null bei Fehlschlag oder Trödelei.
// getThumbnailAsync liefert bei sofort gestoppten Mini-Videos gelegentlich
// ein Objekt ohne uri (bekannter Fund) — deshalb die Prüfung statt Vertrauen.
function posterErzeugen(uri: string): Promise<string | null> {
  return new Promise((weiter) => {
    const frist = setTimeout(() => weiter(null), POSTER_FRIST_MS);
    getThumbnailAsync(uri, { time: 0 })
      .then((bild) => bild?.uri ?? null)
      .catch(() => null)
      .then((poster) => {
        clearTimeout(frist);
        weiter(poster);
      });
  });
}

// Wartet, bis der vorgewärmte Player abspielbereit ist oder scheitert —
// höchstens PLAYER_VORLAUF_MS. Ist er es schon (oder schon kaputt), geht es
// sofort weiter, ohne Timer und ohne Horcher.
function playerBereit(player: VideoPlayer): Promise<void> {
  return new Promise((weiter) => {
    if (player.status === 'readyToPlay' || player.status === 'error') {
      weiter();
      return;
    }
    let abo: { remove(): void } | null = null;
    const fertig = () => {
      clearTimeout(frist);
      abo?.remove();
      weiter();
    };
    const frist = setTimeout(fertig, PLAYER_VORLAUF_MS);
    abo = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') fertig();
    });
  });
}

// Wie lange die Meldung nach einer gescheiterten Aufnahme stehen bleibt. Lang
// genug zum Lesen, kurz genug, dass sie nicht zur Tapete wird und den Sucher
// verdeckt. Ausserhalb der Motion-Skala (§5), weil die Übergänge bemisst, nicht
// Lesezeiten.
const FEHLER_MS = 4000;

// Am Simulator scheitert jede Videoaufnahme (dort gibt es keine Kamera), am
// Gerät kann ein Anruf dazwischenkommen oder der Speicher voll sein. Ohne
// diese Meldung tippt man auf Stopp und steht vor einem Bildschirm, der
// nichts sagt (DESIGN-LANGUAGE §6: Fehler erklären Ursache und Lösung).
const FEHLER_TEXT = 'Das Video hat nicht geklappt. Versuch es nochmal.';

// Das Foto-Gegenstück: scheitert takePictureAsync (am Simulator immer, am
// Gerät bei vollem Speicher oder entzogener Berechtigung), bleibt man im
// Sucher und die Pille sagt es (DESIGN-LANGUAGE §6).
const FOTO_FEHLER_TEXT = 'Das Foto hat nicht geklappt. Versuch es nochmal.';

// Wie oft der Start einer Videoaufnahme wiederholt wird, und wie lange
// dazwischen gewartet wird.
//
// Seit die Kamera dauerhaft im Video-Modus läuft (Spec 2026-08-13 §3), ist
// die Session beim Druck aufs Halten längst gebaut und der erste Versuch
// trifft. Die Schleife bleibt als Sicherheitsnetz: ein Tab-Wechsel oder ein
// Unterbruch (Anruf) kann die Session genau dann beschäftigen, wenn der
// Startversuch sie trifft, und ein Ereignis «Session bereit» gibt es nicht
// (onCameraReady feuert genau einmal beim Sessionstart, nicht danach).
const VIDEO_START_VERSUCHE = 10;
const VIDEO_START_WARTE_MS = 100;

// Wie viel Zeit zwischen den beiden Tippern des Kamera-Wechsels liegen darf.
// Sicherheitsfrist der Wechsel-Blende: bleibt das Geräte-Ereignis aus
// (Simulator ohne zweite Kamera), räumt sie sich selbst wieder weg, statt
// für immer über dem Sucher zu stehen. Grosszügig über den gemessenen
// ~350–650 ms Umbau-Dauern.
const WECHSEL_BLENDE_FRIST_MS = 1500;

// 300 ms ist iOS' eigenes Mass für einen Doppeltipp. Ausserhalb der
// Motion-Skala (§5), und zwar richtig so: die bemisst Übergänge, nicht die
// Geduld einer Geste.
const DOPPELTIPP_MS = 300;

// Wie weit ein Finger wandern darf, ohne dass aus dem Tipp ein Wischen wird —
// und wie weit die beiden Tipper voneinander entfernt liegen dürfen. 24 aus
// dem 4er-Raster (§3).
const TIPP_RADIUS = 24;

// Die Strecken des Zug-Zooms (Spec 2026-08-13 §7). Nach oben deckt ein
// fester Anteil der Fensterhöhe den Weg vom Startfaktor zum Maximum ab —
// Anteil statt Punkte, damit sich ein iPhone SE und ein Pro Max gleich
// anfühlen. Nach unten bleibt vom Auslöser (sitzt fast am Boden) nur eine
// kurze Reststrecke bis zum Rand, sie führt zurück zum Minimum. Beides
// Feintuning-Kandidaten für den Gerätetest.
const ZUG_WEG_HOCH_ANTEIL = 0.4;
const ZUG_WEG_RUNTER = 96;

// Durchmesser des Auslösers (components/Ausloeser.tsx). Alles, was über ihm
// liegt, rechnet ab dieser Zahl.
const AUSLOESER_GROESSE = 76;

// Wie weit der Auslöser über dem unteren Rand sitzt, und damit die ganze
// untere Bedienung: Die Zoom-Reihe und die Fehlermeldung stapeln sich darüber.
// In zwei Schritten von 48 auf 16 gesunken, beide Male nach dem Blick aufs
// Gerät — die Bedienung stand zu weit im Bild. Darunter beginnt die Tab-Bar
// (49 + 8 + Geräte-Inset), viel tiefer geht es also nicht.
const AUSLOESER_UNTEN = spacing.base;

// Wie dicht die Zoom-Reihe über dem Auslöser sitzt.
const ZOOM_ABSTAND = spacing.s;

// Höhe der Zoom-Reihe: 24 Stufe plus zweimal 4 Innenabstand der Pille
// (components/ZoomWahl.tsx).
const ZOOM_REIHE_HOEHE = 24 + 2 * spacing.xs;

// Wo die Fehlermeldung steht: über dem Auslöser, und über der Zoom-Reihe,
// falls das Gerät eine hat. Ohne diese Verschiebung lägen beide übereinander,
// denn die Meldung erscheint direkt nach einer Aufnahme — also genau dann,
// wenn die Reihe wieder im Bild steht.
function fehlerUnten(mitZoomReihe: boolean): number {
  const ueberDemAusloeser = AUSLOESER_UNTEN + AUSLOESER_GROESSE + spacing.l;
  return mitZoomReihe ? ueberDemAusloeser + ZOOM_REIHE_HOEHE + spacing.m : ueberDemAusloeser;
}

function momenteText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment' : 'Momente'}`;
}

// Ob unter diesen Linsen ein Ultraweitwinkel ist: als eigene Linse oder als
// Bestandteil eines virtuellen Geräts. Daran entscheidet multiCamZiel, ob
// 0,5× eine eigene Linse ist oder nur auf 1× klemmt. Als freie Funktion,
// weil der Kamerawechsel sie für die NEUE Richtung braucht, bevor React die
// abgeleiteten Werte der alten ersetzt hat.
function hatUltraweitIn(linsen: Linse[]): boolean {
  return linsen.some((l) => l.typ === 'ultraWide' || l.bestandteile.includes('ultraWide'));
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

// Grösse des Fokus-Rings: zwischen Bedienknopf (44) und Auslöser (76), im
// 4er-Raster (§3). Gross genug, dass er als Antwort auffällt, klein genug,
// dass er das Motiv nicht verstellt.
const FOKUS_RING_GROESSE = 72;

// Wie lange der Ring nach dem Erscheinen stehen bleibt. Ausserhalb der
// Motion-Skala (§5), die bemisst Übergänge — das hier ist eine Standzeit,
// wie FEHLER_MS eine Lesezeit ist.
const FOKUS_RING_STAND_MS = 600;

// Die sichtbare Antwort auf den Fokus-Tipp (Kamera-App-Muster): der Ring
// erscheint leicht zu gross am Punkt, setzt sich auf seine Grösse, steht
// kurz und geht von selbst. Animiert werden nur transform und opacity (§5),
// beides über useNativeDriver; `fast` fürs Erscheinen und Gehen — das ist
// Mikro-Feedback, kein Übergang.
function FokusRing({ x, y, onFertig }: { x: number; y: number; onFertig: () => void }) {
  const reducedMotion = useReducedMotion();
  // Beide per useState statt useRef: gelesen beim Rendern (interpolate),
  // gleiches Muster wie SchwebendesFlugticket unten.
  const [auftritt] = useState(() => new Animated.Value(0));
  const [deckung] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const dauer = reducedMotion ? 0 : motion.duration.fast;
    const easing = Easing.bezier(...motion.easeSmooth);
    const lauf = Animated.sequence([
      Animated.parallel([
        Animated.timing(auftritt, { toValue: 1, duration: dauer, easing, useNativeDriver: true }),
        Animated.timing(deckung, { toValue: 1, duration: dauer, easing, useNativeDriver: true }),
      ]),
      Animated.delay(FOKUS_RING_STAND_MS),
      Animated.timing(deckung, { toValue: 0, duration: dauer, easing, useNativeDriver: true }),
    ]);
    // Nur ein VOLLENDETER Lauf räumt auf: ein Abbruch heisst, ein neuer Ring
    // (neuer key) hat übernommen — dessen Lauf räumt dann für beide.
    lauf.start(({ finished }) => {
      if (finished) onFertig();
    });
    return () => lauf.stop();
  }, [auftritt, deckung, onFertig, reducedMotion]);

  const groesse = auftritt.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] });
  return (
    <Animated.View
      testID="fokus-ring"
      pointerEvents="none"
      // Sagt nichts, was der Tipp nicht schon selbst gesagt hat.
      accessible={false}
      style={[
        styles.fokusRing,
        {
          left: x - FOKUS_RING_GROESSE / 2,
          top: y - FOKUS_RING_GROESSE / 2,
          opacity: deckung,
          transform: [{ scale: groesse }],
        },
      ]}
    />
  );
}

// Liegt während des Kamerawechsel-Umbaus über dem zwangsläufig eingefrorenen
// Sucher (FaceTime-Muster): der Blur macht aus dem Standbild eine bewusste
// Blende statt eines Hängers (Nutzer-Befund 2026-08-18). Sie blendet sich
// nur EIN (opacity, §5) — ihr Ende ist das erste lebende Bild der neuen
// Kamera, das sie ersatzlos ablöst; ein Ausblenden würde genau dieses Bild
// wieder verschleiern.
function WechselBlende() {
  const reducedMotion = useReducedMotion();
  const [deckung] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const lauf = Animated.timing(deckung, {
      toValue: 1,
      duration: reducedMotion ? 0 : motion.duration.fast,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    });
    lauf.start();
    return () => lauf.stop();
  }, [deckung, reducedMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[StyleSheet.absoluteFill, { opacity: deckung }]}
    >
      <BlurView testID="wechsel-blende" intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
    </Animated.View>
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
  const oben = useTopInset(spacing.xl);
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
  // Die Kamera läuft DAUERHAFT im Video-Modus (Spec 2026-08-13 §3): der
  // Wechsel des mode-Props baute die native Session um (Preset + Outputs,
  // setCameraMode auf der sessionQueue) und kostete den Video-Start bis zu
  // ~1 s. Fotos nimmt der Foto-Output derselben Session auf — er bleibt im
  // Video-Modus angeschlossen, liefert dann 16:9 mit 1920×1080, und die
  // Pipeline skaliert ohnehin auf 1080 px lange Kante (medien.ts).
  // `nimmtAuf` ersetzt die frühere Frage `modus === 'video'`: läuft gerade
  // eine Aufnahme?
  const [nimmtAuf, setNimmtAuf] = useState(false);
  // Ob dieser Tab gerade im Fokus steht: daran hängt `mute`. Das Mikrofon
  // gehört dauerhaft an die laufende Video-Session (sonst fehlte dem
  // Videoanfang der Ton), aber NUR solange der Sucher zu sehen ist — die
  // Tab-Screens bleiben gemountet, und der orange Mikrofon-Punkt soll nicht
  // app-weit leuchten, während man im Reise-Tab liest.
  const [fokussiert, setFokussiert] = useState(true);
  // Ob die EIGENE MultiCam-Session den Sucher trägt (Spec §8/§9). Zustand,
  // nicht abgeleitete Frage: scheitert der Sitzungsaufbau am Gerät, fällt der
  // Screen für den REST der Sitzung auf expo-camera zurück, und dieser
  // Rückfall muss ein Rendern auslösen. Der Startwert kommt vom Modul selbst
  // (kein Modul, Android, Simulator → sofort false, die CameraView übernimmt,
  // ohne dass je etwas anlief).
  const [multiCam, setMultiCam] = useState(() => multiKamera.verfuegbar());
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
  // Der Text der Meldung, oder null: seit dem Instant-Foto gibt es zwei
  // Quellen (Foto und Video), die Pille zeigt, was auch immer zuletzt
  // schiefging.
  const [aufnahmeFehler, setAufnahmeFehler] = useState<string | null>(null);
  // Der ANGEZEIGTE Faktor (0,5 / 1 / 4 …), nicht der des Geräts. Zwischen
  // beiden liegt die Basis, siehe zoom.ts.
  const [faktor, setFaktor] = useState(1);
  // Ob die laufende Aufnahme gesperrt ist, die Hand also frei.
  const [aufnahmeGesperrt, setAufnahmeGesperrt] = useState(false);
  // Wo der letzte Fokus-Tipp sass, oder null. `stand` zählt hoch und ist der
  // key des Rings: ein neuer Tipp ersetzt den stehenden Ring durch einen
  // frischen, statt dessen ablaufende Animation weiterzuzeigen.
  const [fokusPunkt, setFokusPunkt] = useState<{ x: number; y: number; stand: number } | null>(null);
  // Wird bei jedem Fokussieren hochgezählt und hängt am Zähler-Effekt unten
  // (siehe dort und useFocusEffect).
  const [fokusStand, setFokusStand] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  // Ob gerade ein Foto-Zyklus läuft (Tipp bis Navigations-Commit). Der
  // Auslöser bleibt zwischen Tipp und Navigation bedienbar; ein zweiter
  // Zyklus würde den Übergabe-Holder überschreiben und die erste Aufnahme
  // (samt Hintergrund-Datei) verwaisen lassen. Als Ref, weil der Wert
  // synchron im selben Tick gelesen werden muss.
  const laeuftFoto = useRef(false);
  const videoStartZeit = useRef(0);
  const videoPromise = useRef<Promise<{ uri: string } | undefined> | null>(null);
  // Der Start der NATIVEN Pipeline (Task 2), gemerkt als PROMISE statt als
  // blosser Boolean: ein Blitz-Stopp direkt nach dem Start muss auf genau
  // dieses Ergebnis warten können, sonst liest handleVideoStop noch den
  // alten Stand und nimmt versehentlich den Fallback-Weg, während die native
  // Aufnahme tatsächlich läuft (oder umgekehrt). `null` heisst: kein
  // Startversuch unterwegs.
  const nativStart = useRef<Promise<boolean> | null>(null);
  // Ob die NATIVE Pipeline die laufende Aufnahme trägt (das aufgelöste
  // Ergebnis von nativStart, als Ref für den synchronen Blick der Gesten).
  // Der Doppeltipp-Wechsel WÄHREND der Aufnahme hängt daran: expo-camera
  // tauscht beim Facing-Wechsel nur den Geräte-Input derselben laufenden
  // Session, die eigene Pipeline hängt an deren Outputs und nimmt einfach
  // weiter auf — eine laufende recordAsync (Fallback) bräche der Umbau
  // dagegen ab.
  const nativLaeuft = useRef(false);
  // Ob der Auslöser seit dem Start dieser Aufnahme losgelassen wurde. Als Ref,
  // weil die Startschleife den Wert zwischen zwei Runden synchron lesen muss;
  // ein State-Wert wäre dort noch der alte.
  const videoGestoppt = useRef(false);
  // Schirmt setState nach Blur/Unmount ab (gleiches Muster wie reise/index.tsx).
  const aktiv = useRef(true);
  // Ob gerade die AUFNAHME-VORSCHAU über dem Tab liegt (zurPreview setzt
  // es, der nächste Fokus nimmt es zurück). Der Unterschied zum echten
  // Tab-Wechsel zählt doppelt (Nutzer-Befund 2026-08-18, «kurzes Standbild
  // beim Verwerfen»): unter der Vorschau bleibt das Mikrofon angehängt (das
  // Wiederanhängen beim Rückweg war ein Session-Umbau, der den Sucher exakt
  // im Moment der Rückkehr einfror), und der fürs Foto eingefrorene Sucher
  // läuft schon UNTER der Vorschau wieder an — der Instant-Rückweg zeigt
  // dann sofort ein lebendes Bild. Als State, nicht als Ref: der mute-Prop
  // hängt daran (Refs im Render sind tabu), und der Blur-Effekt weiter
  // unten bekommt den aktuellen Wert über seine Abhängigkeit.
  const [inVorschau, setInVorschau] = useState(false);
  // Ob gerade der Kamerawechsel-Umbau läuft (kameraWechseln setzt es, das
  // Eintreffen der neuen Kamera nimmt es zurück): solange liegt eine
  // Blur-Blende über dem zwangsläufig eingefrorenen Sucher (FaceTime-
  // Muster) — der Hardware-Umbau dauert ~350–650 ms, und ein nacktes
  // Standbild fühlte sich nach Hänger an (Nutzer-Befund 2026-08-18).
  const [wechselLaeuft, setWechselLaeuft] = useState(false);
  // Derselbe Wert wie `faktor`, nur synchron lesbar: das Nachsetzen und die
  // Pinch-Geste brauchen ihn ausserhalb des Renderns, wo ein State-Wert noch
  // der alte wäre.
  const faktorRef = useRef(1);
  // Der zuletzt gewählte Anzeige-Faktor JE BLICKRICHTUNG (Nutzer-Befund
  // 2026-08-19): wer auf 0,5× filmt, kurz zur Front wechselt und zurückkommt,
  // will wieder seine 0,5× sehen, nicht 1×. Geschrieben und gelesen wird nur
  // beim Kamerawechsel (richtungAnwenden), dazwischen führt faktorRef.
  const faktorJeRichtung = useRef<{ back: number; front: number }>({ back: 1, front: 1 });
  // Laufende Nummer der Kamerawechsel: jede native Antwort trägt die Nummer
  // ihres Anstosses, und nur die JÜNGSTE darf abstimmen oder nachziehen.
  // Ohne sie rollte die verspätete Antwort eines überholten Wechsels in
  // einen Zustand hinein, der längst dem nächsten gehört (Re-Review
  // 2026-08-19, Minor 2).
  const wechselNummer = useRef(0);
  // Dieselben Werte wie `nimmtAuf` und `inVorschau`, ebenfalls nur synchron
  // lesbar: das Blur-Cleanup des MultiCam-Lebenszyklus (siehe unten) muss
  // ihren Stand im Moment des Blurs kennen, darf aber nicht an ihnen HÄNGEN:
  // als Abhängigkeiten stoppte und startete jede einzelne Aufnahme die
  // Session neu.
  const nimmtAufRef = useRef(false);
  const inVorschauRef = useRef(false);
  // Was beim Aufsetzen der zwei Finger galt. Alles Weitere ist Verhältnis
  // dazu, deshalb wird es beim Loslassen wieder geräumt.
  const pinchStart = useRef<{
    abstand: number;
    faktor: number;
    grenzen: { min: number; max: number };
  } | null>(null);
  // Was beim Start der Aufnahme galt: der Zug-Zoom rechnet relativ dazu,
  // wie der Pinch relativ zu seinem Aufsetzen.
  const zugStart = useRef<{ faktor: number; grenzen: { min: number; max: number } } | null>(null);
  // Wo der Finger aufgesetzt hat, und wann zuletzt getippt wurde: daraus
  // entsteht der Doppeltipp (siehe zoomGeste unten).
  const tippStart = useRef<{ pageX: number; pageY: number } | null>(null);
  const letzterTipp = useRef<{ zeit: number; pageX: number; pageY: number } | null>(null);
  // Der ROHE Tipp während der gehaltenen Aufnahme (siehe onTouchStart der
  // Zoomfläche): Kennung und Aufsetzpunkt des zweiten Fingers.
  const rohTipp = useRef<{ id: number | string; pageX: number; pageY: number } | null>(null);

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
      setFokussiert(true);
      // Der Aufnahme-Fluss ist vorbei (zurück aus der Vorschau) — oder war
      // nie einer (normaler Fokus).
      setInVorschau(false);
      // Rückkehr aus der Vorschau: der Sucher war fürs Foto oder den
      // Video-Stopp eingefroren (pausePreview) und läuft jetzt weiter. Beim
      // allerersten Fokus ist die Kamera noch nicht gemountet, das optionale
      // Chaining macht den Aufruf dann zum No-op. (Der Regelfall ist
      // inzwischen, dass der Blur-Cleanup unten ihn schon unter der Vorschau
      // hat anlaufen lassen — dann ist auch dies ein No-op.)
      void cameraRef.current?.resumePreview();
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
        setFokussiert(false);
        // Sicherheitsnetz: verlässt der Screen die Bühne, während die Sperre
        // steht (Deep Link, Unmount — per Tab geht es ja nicht mehr), darf
        // die Tab-Bar nicht app-weit tot bleiben. Die regulären Ausgänge
        // lösen selbst (handleFoto/handleVideoStop); hier fängt der Rest.
        aufnahmeSperre.sperren(false);
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
      // Dieselbe Bedingung meldet die Kino-Bühne an den Tab-Navigator: über
      // dem Sucher liegt die Leiste durchscheinend AUF dem Bild, damit Sucher
      // und Vorschau dieselbe Fläche zeigen (kinoBuehne.ts, Gerätefund
      // 2026-08-18 «mehr gecropt als bevor ich auslöse»).
      kinoBuehne.setzen(zeigtSucher);
      // Beim Blur bleibt das Zeichen bewusst STEHEN: der Blur feuert auch,
      // wenn nur die Vorschau den Tab überdeckt — nähme man es hier zurück,
      // fiele die Leiste unsichtbar in die helle Form und spränge beim
      // Instant-Rückweg im ersten Frame sichtbar um (Nutzer-Befund
      // 2026-08-18). Auf ANDEREN Tabs gilt ohnehin die normale Leiste, das
      // entscheidet _layout.tsx an der Tab-Wahl (route.name), nicht am
      // Zeichen.
      return () => setStatusBarStyle('dark');
    }, [zeigtSucher])
  );

  // Sicherheitsnetz: verlässt der Screen die Bühne ganz (Unmount, Deep
  // Link), darf das Sucher-Zeichen nicht stehen bleiben.
  useEffect(() => () => kinoBuehne.setzen(false), []);

  // Überdeckt die Vorschau den Tab, den fürs Foto eingefrorenen Sucher
  // schon JETZT wieder anlaufen lassen (unsichtbar, er liegt darunter): der
  // Instant-Rückweg zeigt dann sofort ein lebendes Bild statt des
  // Standbilds vom Auslöse-Moment (Nutzer-Befund 2026-08-18). Ein eigener
  // Effekt mit inVorschau als Abhängigkeit: das Cleanup sieht so beim Blur
  // den AKTUELLEN Wert — im grossen Fokus-Effekt oben (Abhängigkeit nur
  // laden) wäre er eine veraltete Schliessung.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (inVorschau) void cameraRef.current?.resumePreview();
      };
    }, [inVorschau])
  );

  // Hält die beiden Spiegel-Refs nach (siehe dort). Ein eigener Effekt statt
  // einer Zuweisung beim Rendern: Refs beim Rendern zu beschreiben ist im
  // konkurrierenden Rendern nicht verlässlich.
  useEffect(() => {
    nimmtAufRef.current = nimmtAuf;
    inVorschauRef.current = inVorschau;
  }, [nimmtAuf, inVorschau]);

  // Der Lebenszyklus der MultiCam-Session (Spec §8/§9). Zwei Dinge hängen
  // daran:
  //
  // Beim Fokus baut die Session auf. Meldet sie `false` (kein Modul, alter
  // Build, Simulator, oder zweimal in Folge gescheiterter Aufbau), fällt der
  // Screen für den REST der Sitzung auf expo-camera zurück: `multiCam` bleibt
  // dann false, dieser Effekt läuft ins Leere und die CameraView übernimmt.
  // Der aktiv-Ref schirmt die Antwort ab, die erst nach dem Verlassen des
  // Screens eintrifft (gleiches Muster wie beim Laden oben).
  //
  // Beim Blur wird NUR gestoppt, wenn nichts mehr auf der Session liegt,
  // nach genau den Bedingungen des mute-Props im anderen Zweig: unter der
  // AUFNAHME-VORSCHAU läuft sie weiter (ein Neuaufbau wäre ausgerechnet auf
  // dem Instant-Rückweg der teuerste Moment), und in eine laufende Aufnahme
  // greift ohnehin niemand hinein.
  useFocusEffect(
    useCallback(() => {
      if (!multiCam) return;
      void multiKamera.starten().then((ok) => {
        if (!ok && aktiv.current) setMultiCam(false);
      });
      return () => {
        if (!nimmtAufRef.current && !inVorschauRef.current) multiKamera.stoppen();
      };
    }, [multiCam])
  );

  // Das Dauerlicht im MultiCam-Zweig. Im anderen Zweig macht das ein Prop
  // (`enableTorch={blitz === 'on' && nimmtAuf}` an der CameraView); die eigene
  // Session kennt keine Props, sie bekommt denselben Schalter als Aufruf.
  //
  // `richtung` hängt in den Abhängigkeiten, obwohl der Ausdruck sie nicht
  // liest: die LED sitzt an der Rückseite, ein Wechsel auf die Front während
  // der Aufnahme muss sie also löschen (und der Rückweg sie wieder anzünden).
  // Das Aufräumen schaltet aus, weil ein Unmount oder ein Rückfall auf
  // expo-camera sonst eine brennende Lampe zurückliesse, aber nur wenn sie
  // überhaupt brannte, sonst wäre jede Änderung ein kurzes Flackern.
  useEffect(() => {
    if (!multiCam) return;
    const an = blitz === 'on' && nimmtAuf;
    multiKamera.blitz(an);
    return () => {
      if (an) multiKamera.blitz(false);
    };
  }, [multiCam, blitz, nimmtAuf, richtung]);

  // Liegt die Leiste über dem Bild, nimmt sie dem Screen keinen Platz mehr
  // weg — die unten verankerten Bedienelemente (Auslöser, Zoom-Reihe,
  // Fehler-Pille) heben sich deshalb um ihre Höhe, sonst lägen sie dahinter.
  // Dieselbe Formel wie in _layout.tsx (kinoBuehne.leisteHoehe), damit die
  // beiden Seiten nicht auseinanderlaufen können.
  const leisteHoehe = kinoBuehne.leisteHoehe(useSafeAreaInsets().bottom);

  // Steht bei den Hooks, weil die frühen Returns weiter unten dazwischenliegen.
  // Was oben auf dem Sucher liegt, schont dieselbe Oberkante wie jeder andere
  // Screen: randlos ist das Kamerabild, nicht die Pille darauf.
  const sucherOben = useTopInset(spacing.xl);

  // ——— Zoom (Spec 2026-08-12-kamera-zoom-design.md) ———
  //
  // Die Stufen kommen vom Gerät, nicht aus einer gepflegten Tabelle: eine
  // virtuelle Mehrfach-Kamera kennt die Faktoren, bei denen iOS die Linse
  // wechselt, und genau das sind die Stufen der Kamera-App (siehe zoom.ts).
  // Jede Blickrichtung hat eigene Linsen, und die Frontkamera meist nur eine.
  // Abgeleitet statt in einem Effekt gespeichert: das Auflisten der Kameras
  // ist eine Abfrage ohne Nebenwirkung, ein Zustand daneben wäre eine zweite
  // Wahrheit. Zurückgesetzt wird der Faktor dort, wo die Richtung wechselt
  // (siehe «Kamera wechseln»), nicht hier.
  const linsen = useMemo(() => nativeZoom.linsen(richtung), [richtung]);
  const zoom = useMemo(() => zoomGeraet(linsen), [linsen]);

  // Ob diese Blickrichtung einen Ultraweitwinkel hat. Daran entscheidet die
  // MultiCam-Session, ob 0,5× eine eigene Linse ist oder nur ein Beschnitt
  // (siehe multiCamZiel in zoom.ts). Die Quelle sind dieselben ENUMERIERTEN
  // Linsen, aus denen auch die Stufen entstehen: aufzählen darf man das
  // virtuelle Gerät weiterhin, es soll nur nicht in der Session laufen.
  const hatUltraweit = useMemo(() => hatUltraweitIn(linsen), [linsen]);

  // Die Basis der aktiven Blickrichtung: 0,5 auf einem Ultraweitwinkel-Gerät,
  // sonst 1; auch für die einlinsige Front, deren Anzeige und Gerätefaktor
  // dasselbe sind (sie hat kein virtuelles Mehrfach-Gerät, `zoom` ist null).
  const zoomBasis = zoom?.basis ?? 1;

  const zoomSetzen = useCallback(
    (neu: number, sanft: boolean) => {
      // Nur der SETZ-Weg wechselt: Stufen, Grenzen, Pinch und Zug rechnen in
      // beiden Zweigen dieselbe Anzeige aus. Die MultiCam-Session kennt aber
      // keine virtuelle Mehrfach-Kamera, sie führt die Linsen einzeln, der
      // Anzeige-Faktor wird darum in Linse plus deren eigenen Faktor
      // übersetzt. Ein Stufen-Gerät braucht sie dafür nicht: die einlinsige
      // Front zoomt digital (Nutzer-Befund 2026-08-19), multiCamZiel klemmt
      // unter 1× selbst, und das Modul klemmt an den Gerätegrenzen.
      if (multiCam) {
        faktorRef.current = neu;
        setFaktor(neu);
        multiKamera.zoomSetzen(multiCamZiel(neu, richtung, hatUltraweit), sanft);
        return;
      }
      if (!zoom) return;
      faktorRef.current = neu;
      setFaktor(neu);
      nativeZoom.setzeZoom(zoom.name, nativerFaktor(neu, zoom.basis), sanft);
    },
    [zoom, multiCam, richtung, hatUltraweit]
  );

  // Der Notausgang der MultiCam-Session (Spec §9): zwei Linsen zugleich
  // heizen, und das Betriebssystem meldet Druck, bevor es selbst eingreift.
  // Der teure Teil ist der zweite Sensor unter 1×, ab 'ernst' geht der Zoom
  // deshalb auf 1× zurück, wo eine Linse allein reicht. Bei 'nominal'
  // passiert nichts: wer zurück auf 0,5× will, tippt selbst.
  useFocusEffect(
    useCallback(() => {
      if (!multiCam) return;
      return multiKamera.aufDruck((stufe) => {
        if (stufe === 'nominal') return;
        if (faktorRef.current < 1) zoomSetzen(1, false);
      });
    }, [multiCam, zoomSetzen])
  );

  // Beim Betreten des Screens springt ein REINGEZOOMTER Stand (> 1×) auf 1×
  // zurück (Wunsch 2026-08-17): ein stehen gebliebener Pinch- oder Zug-Zoom
  // soll nicht unbemerkt in die nächste Aufnahme hineinragen. Der Weitwinkel
  // (≤ 1×) bleibt stehen (Präzisierung 2026-08-18): wer bewusst auf 0,5×
  // gestellt hat, will nach dem Verwerfen genau dort weitermachen. Über
  // zoomSetzen, damit auch das Gerät zurückgeht, nicht nur die Pille.
  //
  // zoomSetzen kommt über eine Ref herein statt als Abhängigkeit: seine
  // Identität wechselt mit der Blickrichtung, und ein daran hängender Effekt
  // liefe bei JEDEM Kamerawechsel neu und würfe den gerade aus dem
  // Richtungs-Gedächtnis wiederhergestellten Faktor weg. Mitten in der
  // gehaltenen Aufnahme sprang so der Zug-Zoom bei jedem Rückwechsel auf 1×
  // (Re-Review 2026-08-19, Important 1). Das Gedächtnis wird beim Betreten
  // mitgeklemmt: auch die gerade NICHT sichtbare Richtung soll keinen alten
  // Rein-Zoom in die nächste Aufnahme tragen.
  const zoomSetzenRef = useRef(zoomSetzen);
  useEffect(() => {
    zoomSetzenRef.current = zoomSetzen;
  }, [zoomSetzen]);
  useFocusEffect(
    useCallback(() => {
      faktorJeRichtung.current.back = Math.min(faktorJeRichtung.current.back, 1);
      faktorJeRichtung.current.front = Math.min(faktorJeRichtung.current.front, 1);
      if (faktorRef.current > 1) zoomSetzenRef.current(1, false);
    }, [])
  );

  // Der Fallstrick dieser Funktion: auf dem virtuellen Gerät IST der native
  // Faktor 1,0 die weiteste Linse, also 0,5×. Und genau diese 1,0 setzt
  // expo-camera bei jedem Gerätewechsel selbst (addDevice → updateZoom mit
  // unserem zoom-Prop 0, CameraSessionManager.swift:354). Ohne Nachsetzen
  // begänne der Sucher bei 0,5× und spränge nach jedem Kamerawechsel dorthin
  // zurück.
  const zoomNachsetzen = useCallback(() => {
    // Im MultiCam-Zweig gibt es nichts nachzusetzen: dort läuft das virtuelle
    // Gerät gar nicht in der Session, und niemand setzt seinen Zoom hinter
    // unserem Rücken auf 1,0 zurück.
    if (!zoom || multiCam) return;
    nativeZoom.setzeZoom(zoom.name, nativerFaktor(faktorRef.current, zoom.basis), false);
  }, [zoom, multiCam]);

  // Die Zoom-Grenzen einer Blickrichtung, in der Zählung des Geräts, mit
  // demselben Fallback, den bisher nur der Pinch kannte: kennt das Modul
  // keine Grenzen, dient die oberste Stufe als Maximum. Von Pinch UND
  // Zug-Zoom benutzt. Richtungs-parametrisiert statt an den aktuellen
  // Zustand gebunden: der Kamerawechsel braucht die Grenzen der NEUEN
  // Richtung, bevor React die abgeleiteten Werte der alten ersetzt hat.
  // Genau daran starb der Zug-Zoom nach dem Wechsel mitten in der Aufnahme
  // (Nutzer-Befund 2026-08-19: Front zu Back verlor den Anker ganz, Back zu
  // Front behielt die falschen Grenzen).
  //
  // Eine Richtung ohne virtuelles Mehrfach-Gerät (jede Front) hat im
  // expo-camera-Zweig keine Grenzen und damit keinen Zoom, dort führt der
  // Weg nur über das virtuelle Gerät. Die MultiCam-Session zoomt sie
  // dagegen digital, ihre Grenzen kommen von der Linse selbst: der echten
  // Weitwinkel-Linse, nicht blind der ersten der Liste (die Reihenfolge der
  // Discovery ist kein Vertrag). Antwortet das Modul für sie ohne Grenzen,
  // bleibt ein bescheidener Ersatzbereich statt eines toten Zooms: er formt
  // nur die Finger-Abbildung, geklemmt wird nativ ohnehin am echten Gerät.
  const zoomGrenzenFuer = (r: 'back' | 'front') => {
    const linsenDort = nativeZoom.linsen(r);
    const geraet = zoomGeraet(linsenDort);
    if (geraet) {
      return (
        nativeZoom.zoomGrenzen(geraet.name) ?? {
          min: 1,
          max: nativerFaktor(geraet.stufen[geraet.stufen.length - 1], geraet.basis),
        }
      );
    }
    if (!multiCam) return null;
    const linse = linsenDort.find((l) => l.typ === 'wide') ?? linsenDort[0];
    if (!linse) return null;
    return nativeZoom.zoomGrenzen(linse.name) ?? { min: 1, max: 8 };
  };

  // Läuft, sobald die Mehrfach-Kamera bekannt ist. Der Wechsel des GERÄTS
  // meldet sich dagegen von selbst, siehe onAvailableLensesChanged an der
  // CameraView.
  useEffect(() => {
    zoomNachsetzen();
  }, [zoomNachsetzen]);

  // Ein sauberer Tipp auf den Sucher: Fokus und Belichtung an diesen Punkt
  // (Kamera-App-Muster, siehe onResponderRelease der Zoomfläche unten). Der
  // Ring ist die sichtbare Antwort darauf.
  const fokusAuf = (punkt: { pageX: number; pageY: number }) => {
    // Zwei Sessions, zwei Wege zum selben Gerät: fokussiert wird immer die
    // Kamera, die gerade WIRKLICH läuft. Der Ring darüber ist derselbe.
    if (multiCam) multiKamera.fokussiere(punkt.pageX, punkt.pageY);
    else nativeZoom.fokussiere(punkt.pageX, punkt.pageY);
    setFokusPunkt((alt) => ({ x: punkt.pageX, y: punkt.pageY, stand: (alt?.stand ?? 0) + 1 }));
  };
  // Stabil über useCallback: der Ring hängt seinen Animations-Effekt daran,
  // eine neue Identität bei jedem Rendern würde den Lauf neu starten.
  const fokusRingFertig = useCallback(() => setFokusPunkt(null), []);

  // Räumt die Meldung nach FEHLER_MS wieder ab. Der Timer hängt am Zustand
  // selbst, nicht am Auslöser: So setzt ihn ein zweiter Fehlschlag neu auf,
  // statt dass die erste Uhr die zweite Meldung wegwischt.
  useEffect(() => {
    if (!aufnahmeFehler) return;
    const uhr = setTimeout(() => setAufnahmeFehler(null), FEHLER_MS);
    return () => clearTimeout(uhr);
  }, [aufnahmeFehler]);

  // Sicherheitsnetz der Wechsel-Blende (siehe WECHSEL_BLENDE_FRIST_MS): im
  // Regelfall räumt onAvailableLensesChanged sie deutlich früher weg.
  useEffect(() => {
    if (!wechselLaeuft) return;
    const frist = setTimeout(() => setWechselLaeuft(false), WECHSEL_BLENDE_FRIST_MS);
    return () => clearTimeout(frist);
  }, [wechselLaeuft]);


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
    void ownMomentCount(reise.id)
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

  // Videos verlassen diesen Screen als Dateipfad, Fotos über die Übergabe im
  // Speicher (bewusste Grenze, siehe Auftrag); dazu kommt `tripId`, weil
  // Task 8 daraus den Speicherschlüssel und den Queue-Job baut; eine Kennung
  // ist nichts Bibliotheksspezifisches, verletzt die Grenze also nicht.
  // `/aufnehmen/preview` selbst entsteht erst in Task 8 und fehlt darum noch
  // in der generierten (gitignorten) Routen-Liste `.expo/types/router.d.ts`.
  // Der Cast über `unknown` (statt `any`, siehe Präzedenz in joinFlow.ts) ist
  // bewusst temporär: sobald Task 8 die Route anlegt, entfällt er ersatzlos.
  const zurPreview = (params: { typ: 'photo' | 'video'; dauer: string; tripId: string; uri?: string }) => {
    // VOR der Navigation gesetzt: der Blur-Effekt und der mute-Prop
    // behandeln die Vorschau anders als einen Tab-Wechsel (siehe inVorschau
    // oben).
    setInVorschau(true);
    router.push({ pathname: '/vorschau', params } as unknown as Href);
  };

  // Während einer GEHALTENEN Aufnahme liegt der Finger auf dem Auslöser.
  // React Native kennt genau einen Responder: ein zweiter Finger auf der
  // Reihe entzöge dem Druck die Berührung, das Loslassen käme an, und die
  // Aufnahme endete mitten im Zoomen. Ist sie dagegen gesperrt, ist die Hand
  // frei — dann bleibt der Zoom bedienbar, wie in der Kamera-App.
  const zoomBedienbar = !nimmtAuf || aufnahmeGesperrt;
  // Zoomen können und Stufen zeigen sind zwei Fragen: die einlinsige Front
  // hat keine Reihe, zoomt im MultiCam-Zweig aber digital: der Pinch muss
  // dort greifen, obwohl keine Stufen im Bild stehen.
  const zoomMoeglich = multiCam || zoom !== null;
  const zoomSichtbar = zoom !== null && zoomBedienbar;

  // Der Pinch, von Hand statt über einen Gesten-Erkenner: gebraucht wird der
  // Abstand zweier Finger, mehr nicht. `onStartShouldSetResponder: false`
  // lässt jede einzelne Berührung durch — sie gehört dem Auslöser und der
  // übrigen Bedienung. Erst die Bewegung mit zwei Fingern übernimmt.
  // Der Doppeltipp wechselt die Kamera auch WÄHREND der Aufnahme (Wunsch
  // 2026-08-17, Snapchat-Muster) — aber nur auf dem nativen Weg: expo-camera
  // tauscht beim Facing-Wechsel nur den Geräte-Input derselben laufenden
  // Session (CameraSessionManager.addDevice), die eigene Pipeline hängt an
  // deren Outputs und nimmt einfach weiter auf. Eine laufende recordAsync
  // (Fallback) bräche der Umbau dagegen ab — dort schweigt der Doppeltipp
  // weiterhin, gesperrt oder nicht. Als Funktion statt als Wert, weil die
  // Gesten den nativLaeuft-Ref im Moment des Tipps lesen müssen.
  //
  // Der MultiCam-Zweig kennt diese Frage nicht mehr: dort laufen beide
  // Kameras in DERSELBEN Session, der Wechsel tauscht nur, welche von ihnen
  // den Sucher speist. Es gibt nichts, was dabei abbrechen könnte, der Gate
  // bleibt allein dem expo-camera-Weg.
  const wechselErlaubt = () => multiCam || !nimmtAuf || nativLaeuft.current;

  // Stellt den Screen auf eine Blickrichtung um: merkt sich den Faktor der
  // alten Richtung, stellt den gemerkten der neuen wieder her und verankert
  // einen laufenden Zug-Zoom neu: Faktor aus dem Gedächtnis, Grenzen der
  // neuen Kamera (vorher blieb der Anker auf den alten Grenzen stehen oder
  // fiel beim Wechsel auf die geräte-lose Front ganz weg, und der Zug war
  // für den Rest der Aufnahme tot). Im expo-camera-Zweig bleibt es beim
  // Zurücksetzen auf 1×: expo stellt den Zoom beim Gerätewechsel selbst
  // zurück, und die abgenommene Fallback-Mechanik (zoomNachsetzen über
  // onAvailableLensesChanged) rechnet ab genau diesem Stand.
  const richtungAnwenden = (von: 'back' | 'front', nach: 'back' | 'front') => {
    faktorJeRichtung.current[von] = faktorRef.current;
    const wieder = multiCam ? faktorJeRichtung.current[nach] : 1;
    setRichtung(nach);
    faktorRef.current = wieder;
    setFaktor(wieder);
    if (zugStart.current) {
      const grenzen = zoomGrenzenFuer(nach);
      zugStart.current = grenzen ? { faktor: wieder, grenzen } : null;
    }
  };

  const kameraWechseln = () => {
    const alt = richtung;
    const neu = alt === 'back' ? 'front' : 'back';
    if (multiCam) {
      // Kein Hardware-Umbau, kein Warten, und darum auch keine Blende: die
      // Session läuft weiter, das Modul legt nur die andere Verbindung auf
      // den Sucher. Auf die Antwort wartet der Screen nicht, die Richtung
      // stellt er sofort um, damit Stufen, Grenzen und Zoom-Ziel im selben
      // Bild zur neuen Kamera passen.
      richtungAnwenden(alt, neu);
      // Sobald die Antwort da ist, wird der NATIVE Zoom nachgezogen. Ohne
      // das liefen Anzeige und Session auseinander: das Modul merkt sich je
      // Richtung ihre zuletzt gewählte Kamera samt stehendem Zoomfaktor,
      // der Screen ihren Anzeige-Faktor; erst das Nachziehen bringt beide
      // auf denselben gemerkten Stand (im expo-camera-Zweig erledigt das
      // zoomNachsetzen über onAvailableLensesChanged). Antwortet das Modul
      // mit null (kein Modul, Aufbau-Fenster, Wechsel abgelehnt), hat nativ
      // NICHTS gewechselt: die optimistische Umstellung rollt zurück, sonst
      // stünde der Screen dauerhaft verkehrt zur Session, und jeder weitere
      // Doppeltipp hielte die Vertauschung aufrecht (Final-Review
      // 2026-08-19, Important 1).
      const nummer = ++wechselNummer.current;
      void multiKamera.wechsleKamera().then((antwort) => {
        // Überholt: ein jüngerer Wechsel ist längst angewandt, seine Antwort
        // stimmt den Zustand ab. Diese hier hat nichts mehr zu sagen.
        if (nummer !== wechselNummer.current) return;
        const wirklich = antwort ?? alt;
        if (wirklich !== neu) richtungAnwenden(neu, wirklich);
        if (!antwort) return;
        multiKamera.zoomSetzen(
          multiCamZiel(faktorRef.current, antwort, hatUltraweitIn(nativeZoom.linsen(antwort))),
          false
        );
      });
      return;
    }
    setWechselLaeuft(true);
    richtungAnwenden(alt, neu);
  };

  // Der Zug-Zoom (Spec 2026-08-13 §7): Hochziehen ab Aufnahmestart zoomt
  // rein, zurück nach unten wieder raus. Hart gesetzt wie der Pinch — der
  // Zoom folgt dem Finger, nicht hinterher.
  const zoomZug = (hub: number) => {
    // Der Anker existiert nur, wo es Grenzen gab (zoomGrenzenFuer); die
    // Frage «hat diese Richtung überhaupt Zoom?» ist damit schon beantwortet,
    // auch für die geräte-lose Front im MultiCam-Zweig.
    const start = zugStart.current;
    if (!start) return;
    zoomSetzen(
      zugFaktor(hub, start.faktor, start.grenzen, zoomBasis, {
        hoch: Dimensions.get('window').height * ZUG_WEG_HOCH_ANTEIL,
        runter: ZUG_WEG_RUNTER,
      }),
      false
    );
  };

  // Zwei saubere Tipps kurz nacheinander am selben Ort. Verwaltet die
  // Zählung selbst: meldet true genau beim zweiten Tipp und beginnt danach
  // von vorn. Von BEIDEN Tipp-Pfaden benutzt (Responder-Weg im Ruhezustand
  // und bei gesperrter Aufnahme, roher Touch-Weg bei gehaltener) — die
  // Zustände schliessen einander aus, der geteilte Zähler kann nicht
  // zwischen ihnen verschwimmen.
  const istDoppeltipp = (ende: { pageX: number; pageY: number }) => {
    const vorher = letzterTipp.current;
    const jetzt = Date.now();
    const doppelt =
      vorher !== null &&
      jetzt - vorher.zeit <= DOPPELTIPP_MS &&
      (fingerAbstand([vorher, ende]) ?? 0) <= TIPP_RADIUS;
    letzterTipp.current = doppelt ? null : { zeit: jetzt, ...ende };
    return doppelt;
  };

  // Berührungen auf dem Kamerabild: zwei Finger zoomen, zwei Tipper wechseln
  // die Kamera (Snapchat-Muster).
  //
  // Das Ereignis ist überall optional angefasst (`e?.`), gleiches Muster wie
  // im Auslöser: Wer nur wissen will, OB dieses Element Berührungen annimmt,
  // ruft die Prüffrage ohne Ereignis auf.
  const zoomGeste = {
    // Einzelne Berührungen nimmt die Fläche an, wenn aus ihnen ein Tipp
    // werden darf: im Ruhezustand (Fokus und Doppeltipp-Wechsel) und während
    // einer GESPERRTEN Aufnahme (nur Fokus, die Hand ist frei). Während einer
    // GEHALTENEN Aufnahme muss sie sie durchlassen: React Native kennt genau
    // einen Responder, und der gehört dann dem Auslöser — nähme die Fläche
    // ihn an sich, endete die Aufnahme.
    onStartShouldSetResponder: () => !nimmtAuf || aufnahmeGesperrt,
    onMoveShouldSetResponder: (e?: GestureResponderEvent) =>
      zoomMoeglich && zoomBedienbar && (e?.nativeEvent?.touches?.length ?? 0) >= 2,
    onResponderGrant: (e?: GestureResponderEvent) => {
      tippStart.current = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      const abstand = fingerAbstand(e?.nativeEvent?.touches ?? []);
      if (abstand === null) return;
      // Die Grenzen erst jetzt erfragen: sie hängen am aktiven Kameraformat
      // und damit daran, ob gerade ein Foto oder ein Video ansteht. Ohne
      // Grenzen (Front im expo-Zweig) gibt es keinen Anker und keinen Pinch.
      const grenzen = zoomGrenzenFuer(richtung);
      if (!grenzen) return;
      pinchStart.current = { abstand, faktor: faktorRef.current, grenzen };
    },
    onResponderMove: (e?: GestureResponderEvent) => {
      const abstand = fingerAbstand(e?.nativeEvent?.touches ?? []);
      if (abstand === null) return;
      // Am Gerät setzen zwei Finger fast nie im selben Ereignis auf: der
      // erste ergreift die Fläche allein (onResponderGrant sieht EINE
      // Berührung, kein Anker), der zweite kommt ein Ereignis später nach.
      // Der Anker wird darum HIER nachgezogen, sobald erstmals zwei Finger
      // da sind — vorher rechnete in dem Fall niemand, und der Pinch griff
      // nur, wenn beide Finger zufällig gleichzeitig landeten (Gerätefund
      // 2026-08-14, «erkennt den Zoom nur teilweise»).
      if (pinchStart.current === null) {
        const grenzen = zoomGrenzenFuer(richtung);
        if (!grenzen) return;
        pinchStart.current = { abstand, faktor: faktorRef.current, grenzen };
        return;
      }
      const start = pinchStart.current;
      if (start.abstand === 0) return;
      // Hart gesetzt, nicht sanft: der Zoom soll dem Finger folgen, nicht
      // hinterherfahren.
      zoomSetzen(begrenzen((start.faktor * abstand) / start.abstand, start.grenzen, zoomBasis), false);
    },
    onResponderRelease: (e?: GestureResponderEvent) => {
      const warPinch = pinchStart.current !== null;
      const start = tippStart.current;
      pinchStart.current = null;
      tippStart.current = null;
      // Wer gezoomt hat, meinte weder Wechsel noch Fokus.
      if (warPinch || !start) return;

      const ende = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      // Gewandert heisst gewischt, nicht getippt. Ein Wischen setzt die
      // Zählung zurück, sonst würde es zur ersten Hälfte eines Doppeltipps.
      if ((fingerAbstand([start, ende]) ?? 0) > TIPP_RADIUS) {
        letzterTipp.current = null;
        return;
      }

      // Der Doppeltipp wechselt die Kamera — im Ruhezustand immer, während
      // der Aufnahme nur auf dem nativen Weg (siehe wechselErlaubt).
      if (istDoppeltipp(ende) && wechselErlaubt()) {
        kameraWechseln();
        return;
      }
      // Jeder andere saubere Tipp fokussiert an seinem Punkt — auch der
      // erste eines Doppeltipps (die Kamera-App tut dasselbe; der Wechsel
      // danach macht den Fokus einfach hinfällig).
      fokusAuf(ende);
    },
    onResponderTerminate: () => {
      pinchStart.current = null;
      tippStart.current = null;
    },
    // Der Fokus-Tipp WÄHREND der gehaltenen Aufnahme: der Responder gehört
    // dann dem Auslöser, Responder-Ereignisse erreichen die Fläche nicht.
    // Die rohen Touch-Ereignisse kommen aber an — sie folgen dem
    // Berührungs-ZIEL, nicht dem Responder (Gerätefund 2026-08-14). Tab-Bar
    // und Auslöser treffen die Fläche nie: deren Tipps zielen auf die
    // eigenen Views, ein Ring über der Bedienung ist damit ausgeschlossen.
    // In allen anderen Zuständen bleibt dieser Pfad stumm, dort fokussiert
    // onResponderRelease oben — sonst feuerte der Tipp doppelt.
    onTouchStart: (e?: GestureResponderEvent) => {
      if (!nimmtAuf || aufnahmeGesperrt) return;
      const id = e?.nativeEvent?.identifier;
      if (id === undefined) return;
      rohTipp.current = {
        id,
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
    },
    onTouchEnd: (e?: GestureResponderEvent) => {
      const start = rohTipp.current;
      if (!start || e?.nativeEvent?.identifier !== start.id) return;
      rohTipp.current = null;
      if (!nimmtAuf || aufnahmeGesperrt) return;
      const ende = {
        pageX: e?.nativeEvent?.pageX ?? 0,
        pageY: e?.nativeEvent?.pageY ?? 0,
      };
      // Gewandert heisst gewischt — derselbe Massstab wie beim Tipp oben.
      if ((fingerAbstand([start, ende]) ?? 0) > TIPP_RADIUS) {
        letzterTipp.current = null;
        return;
      }
      // Der Doppeltipp des zweiten Fingers wechselt die Kamera mitten im
      // Filmen (Snapchat-Muster) — nur auf dem nativen Weg, der Fallback
      // bräche ab (siehe wechselErlaubt).
      if (istDoppeltipp(ende) && wechselErlaubt()) {
        kameraWechseln();
        return;
      }
      fokusAuf(ende);
    },
  };

  const handleFoto = async () => {
    // Re-Entry-Schutz: Zwischen `pressOut` und dem Navigations-Commit bleibt
    // der Auslöser bedienbar, ein zweiter Tipp in diesem Fenster stiesse ohne
    // diese Sperre einen zweiten Zyklus an (siehe laeuftFoto oben).
    if (laeuftFoto.current) return;
    laeuftFoto.current = true;
    // Solange der Zyklus läuft, wechselt kein Tab (aufnahmeSperre.ts) — mit
    // Blitz ist das Fenster 1–2 s breit, und ein Wechsel mitten im Capture
    // liesse die Übergabe verwaisen und die Vorschau von fremden Tabs starten.
    aufnahmeSperre.sperren(true);
    try {
      // Der MultiCam-Zweig greift in den laufenden Strom (Spec §6): das Modul
      // nimmt den nächsten Frame der aktiven Kamera und legt ihn als JPEG ins
      // tmp: kein takePictureAsync, kein zweiter Foto-Ausgang. Der Blitz
      // reist als Argument mit, weil erst das Modul weiss, wann nach dem
      // Zünden gegriffen werden darf. KEIN pausePreview: die eigene Session
      // kennt keine Vorschau-Pause, der Sucher läuft unter der Vorschau
      // weiter, und der Rückweg trifft dadurch auf ein laufendes Bild.
      if (multiCam) {
        const foto = await multiKamera.fotoAufnehmen(blitz === 'on');
        if (!foto) throw new Error('kein Frame');
        // Dieselbe Übergabe wie unten, nur mit einer FERTIGEN Datei statt
        // eines Refs samt Hintergrund-Speichern: der Griff hat das JPEG schon
        // geschrieben, `datei` ist deshalb sofort eingelöst. Der Holder trägt
        // fürs Anzeigen einen expo-camera-PictureRef; expo-image nimmt eine
        // Quelle in der Form `{ uri }` genauso an (die Vorschau reicht sie im
        // Deep-Link-Fall längst so durch), der Holder-Typ kennt diese zweite
        // Form nur noch nicht. Die Umdeutung steht darum hier an genau EINER
        // Stelle, statt den Typ zu ändern und die Vorschau mitzuziehen.
        // breite/hoehe braucht auf diesem Weg niemand: sie stehen im JPEG.
        const quelle = { uri: foto.uri } as unknown as PictureRef;
        uebergabe.uebergeben({ ref: quelle, datei: Promise.resolve({ uri: foto.uri }) });
        zurPreview({ typ: 'photo', dauer: '0', tripId: reise.id });
        return;
      }
      // Erst die Aufnahme anstossen, DANN die Vorschau einfrieren: die
      // SDK-Doku rät von takePictureAsync bei pausierter Vorschau ab, und
      // der Reihenfolge sieht man den Unterschied nicht an, beides läuft im
      // selben Tick. Das eingefrorene Bild ist der gefühlte Shutter.
      //
      // Das gilt nur OHNE Blitz, wo das Bild in wenigen Dutzend ms da ist
      // (Spec 2026-08-13 §4). MIT Blitz fährt iOS erst die Messsequenz
      // (Vorblitz, Belichtungs-Konvergenz, Hauptblitz), 1–2 s — ein sofort
      // eingefrorener Sucher stünde die ganze Zeit als dunkler Freeze da
      // (Gerätetest 2026-08-13). Er bleibt darum live, man SIEHT den Blitz
      // zünden (Kamera-App-Muster), und eingefroren wird erst, wenn das Bild
      // da ist: als ruhiger Stand für den Übergang, wie beim Video-Stopp.
      // `mirror: true` wirkt NUR auf die Frontkamera (expo-camera prüft die
      // Blickrichtung selbst, CameraPhotoCapture.swift) und speichert dort,
      // was der Sucher zeigte — ohne das Flag kippte ein Selfie nach der
      // Aufnahme spiegelverkehrt (Gerätefund 2026-08-18). Die Video-Pipeline
      // braucht nichts davon, sie übernimmt die Spiegelung direkt von der
      // Sucher-Verbindung (verbindungAngleichen).
      const versprochen = cameraRef.current?.takePictureAsync({
        pictureRef: true,
        shutterSound: false,
        mirror: true,
      });
      if (blitz === 'off') void cameraRef.current?.pausePreview();
      const ref = await versprochen;
      if (!ref) throw new Error('keine Kamera');
      if (blitz === 'on') void cameraRef.current?.pausePreview();
      // Der Ref ist in Millisekunden da (kein JPEG, kein Platten-I/O);
      // gespeichert wird ab jetzt im Hintergrund, «Einsenden» in der
      // Vorschau wartet auf genau dieses Promise (Spec 2026-08-13 §4).
      // gespeicherteDatei statt savePictureAsync direkt: die native Rückgabe
      // heisst auf iOS `url`, auf Android `uri` (siehe uebergabe.ts).
      uebergabe.uebergeben({ ref, datei: uebergabe.gespeicherteDatei(ref) });
      zurPreview({ typ: 'photo', dauer: '0', tripId: reise.id });
    } catch (fehler) {
      console.error('[aufnehmen] Foto kam nicht zustande', fehler);
      // Ohne das Auftauen bliebe der Sucher eingefroren stehen: pausePreview
      // ist gelaufen, und niemand navigiert weg. Im MultiCam-Zweig ist der
      // Aufruf ein Leerlauf (dort gibt es keine CameraView, cameraRef bleibt
      // null), eingefroren war da ohnehin nichts.
      void cameraRef.current?.resumePreview();
      setAufnahmeFehler(FOTO_FEHLER_TEXT);
    } finally {
      // Deckt Erfolg wie Fehler ab; nach Erfolg ist die Navigation dann
      // committet — ein erneuter Tipp trifft diesen Screen erst nach der
      // Rückkehr aus der Vorschau wieder.
      laeuftFoto.current = false;
      aufnahmeSperre.sperren(false);
    }
  };

  const handleVideoStart = () => {
    videoStartZeit.current = Date.now();
    videoGestoppt.current = false;
    // Eine neue Aufnahme räumt die alte Klage weg, sonst stünde sie noch da,
    // während schon wieder aufgenommen wird.
    setAufnahmeFehler(null);
    setNimmtAuf(true);
    // Kein Tab-Wechsel, solange aufgenommen wird: das Fokus-Cleanup hinge
    // sonst mitten in der laufenden Movie-File-Aufnahme (siehe den
    // mute-Kommentar an der CameraView und aufnahmeSperre.ts).
    aufnahmeSperre.sperren(true);
    // Anker des Zug-Zooms: Faktor und Grenzen beim Aufnahmestart. Grenzen
    // erst jetzt erfragen, nicht beim Rendern — sie hängen am aktiven Format.
    // Ohne Grenzen (Front im expo-Zweig) gibt es keinen Zug.
    const grenzen = zoomGrenzenFuer(richtung);
    zugStart.current = grenzen ? { faktor: faktorRef.current, grenzen } : null;
    // Direkt starten statt über einen Effekt am Modus: die Session ist im
    // dauerhaften Video-Modus längst bereit, es gibt nichts zu committen.
    // Wiederholt wird trotzdem (siehe VIDEO_START_VERSUCHE oben) — und am
    // Simulator scheitert weiterhin JEDER Versuch («SimulatorNotSupported»),
    // am Ende bleibt es beim `undefined` und der Screen sagt es.
    const starten = async (): Promise<{ uri: string } | undefined> => {
      let letzterFehler: unknown = null;
      for (let versuch = 0; versuch < VIDEO_START_VERSUCHE; versuch++) {
        // Wer den Auslöser schon losgelassen hat, will kein Video mehr. Ohne
        // diese Abfrage begänne die nächste Runde eine Aufnahme, die niemand
        // mehr stoppt: `stopRecording()` ist längst gelaufen und war ein
        // Schlag ins Leere, die Aufnahme liefe bis `maxDuration`.
        if (videoGestoppt.current) return undefined;
        try {
          return await cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SEKUNDEN });
        } catch (fehler) {
          letzterFehler = fehler;
          await new Promise((weiter) => setTimeout(weiter, VIDEO_START_WARTE_MS));
        }
      }
      // Alle Runden verbraucht. Was zuletzt schiefging, gehört ins Log: sonst
      // steht auf dem Gerät nur FEHLER_TEXT, und die eigentliche Ursache
      // (Simulator, kein Speicher, Berechtigung entzogen) ist verschluckt.
      console.error('[aufnehmen] Videoaufnahme kam nicht zustande', letzterFehler);
      return undefined;
    };
    // Die Weiche: erst die eigene native Pipeline versuchen (Task 2), NUR
    // wenn sie ablehnt (kein Modul, alter Build, Android) beginnt der
    // bisherige recordAsync-Weg. `nativStart` hält das Promise, nicht nur das
    // Ergebnis — handleVideoStop wartet später auf dasselbe Promise, statt
    // auf einen Boolean, der bei einem Blitz-Stopp noch den alten Stand
    // zeigen könnte.
    //
    // Trägt die eigene MultiCam-Session den Sucher, erzeugt SIE die Aufnahme:
    // dieselbe native Aufnahme wie sonst, nur gefüllt vom Verteiler ihrer
    // Session statt vom Abgriff an der expo-camera-Session (Spec §4). Der
    // Kamerawechsel mitten drin kostet dort keine Lücke, die Zeitachse ist die
    // gemeinsame Session-Clock.
    nativStart.current = multiCam
      ? multiKamera.aufnahmeStarten(MAX_VIDEO_SEKUNDEN)
      : nativeAufnahme.aufnahmeStarten(MAX_VIDEO_SEKUNDEN);
    void nativStart.current.then((ok) => {
      nativLaeuft.current = ok;
      // Der recordAsync-Weg gehört der CameraView, im MultiCam-Zweig gibt es
      // keine (cameraRef bleibt null), ein Rückfall liefe also ins Leere.
      // Scheitert der Start dort, sagt es der Stopp über die Fehlerpille.
      if (!ok && !multiCam) videoPromise.current = starten();
    });
  };

  const handleVideoStop = async () => {
    // Vor dem Stoppen gesetzt: Der Startversuch oben liest dieses Zeichen
    // zwischen zwei Runden und gibt dann auf, statt hinter dem Loslassen noch
    // eine Aufnahme zu beginnen.
    videoGestoppt.current = true;
    // Die Aufnahme endet — ab hier gilt für den Doppeltipp wieder allein
    // der Ruhezustand (wechselErlaubt).
    nativLaeuft.current = false;
    cameraRef.current?.stopRecording();

    // Die Weiche: erst abwarten, OB die native Aufnahme überhaupt lief (das
    // PROMISE aus handleVideoStart, nicht nur ein Boolean-Flag) — ein
    // Blitz-Stopp direkt nach dem Start bekäme sonst den alten, noch
    // unentschiedenen Stand zu sehen und liefe in den falschen Zweig. Im
    // nativen Fall sind `stopRecording()` oben und der Fallback-Ablauf
    // unten harmlos: es läuft ja gar kein recordAsync.
    const nativGestartet = nativStart.current ? await nativStart.current : false;
    nativStart.current = null;
    if (nativGestartet) {
      // Gestoppt wird dort, wo gestartet wurde. Alles danach ist für beide
      // Pipelines dasselbe: die Datei, das Verwerfen und die Sofort-Vorschau
      // hängen nativ an derselben laufenden Aufnahme, egal welche Session sie
      // gefüllt hat.
      const ergebnis = await (multiCam
        ? multiKamera.aufnahmeStoppen()
        : nativeAufnahme.aufnahmeStoppen());
      setNimmtAuf(false);
      aufnahmeSperre.sperren(false);
      if (!ergebnis) {
        setAufnahmeFehler(FEHLER_TEXT);
        return;
      }
      uebergabe.videoUebergeben({ art: 'nativ', dateiFertig: nativeAufnahme.dateiFertig() });
      zurPreview({
        uri: ergebnis.uri,
        typ: 'video',
        dauer: String(Math.round(ergebnis.dauerS)),
        tripId: reise.id,
      });
      return;
    }

    // Hier endet der MultiCam-Zweig: der Start hat abgelehnt, und einen
    // zweiten Weg gibt es nicht (recordAsync gehört der CameraView, die in
    // diesem Zweig gar nicht entsteht). Die Pille sagt es, statt dass der
    // Ablauf unten stumm ins Leere liefe.
    if (multiCam) {
      setNimmtAuf(false);
      aufnahmeSperre.sperren(false);
      setAufnahmeFehler(FEHLER_TEXT);
      return;
    }

    // Der Sucher läuft während der Datei-Finalisierung (~100 bis 300 ms)
    // bewusst LIVE weiter (Gerätefund 2026-08-14): das frühere pausePreview
    // stammte aus der Zeit des harten Schnitts zur Vorschau — als Standbild
    // war es genau der spürbare Ruckler beim Loslassen. Den Zeitsprung vom
    // Sucher ins Video deckt inzwischen die Blende ab (vorschau.tsx).
    const ergebnis = await videoPromise.current;
    videoPromise.current = null;
    setNimmtAuf(false);
    // Vor beiden Ausgängen (Fehler-Pille wie Navigation): die Aufnahme ist
    // vorbei, die Tabs gehören wieder bedient.
    aufnahmeSperre.sperren(false);
    if (!ergebnis?.uri) {
      void cameraRef.current?.resumePreview();
      setAufnahmeFehler(FEHLER_TEXT);
      return;
    }
    const dauer = Math.round((Date.now() - videoStartZeit.current) / 1000);
    // Vorwärmen (Gerätefund 2026-08-14, Snapchat-Massstab): der Player
    // entsteht HIER und lädt, während der Sucher live weiterläuft; navigiert
    // wird erst, wenn er abspielbereit ist — die Blende geht dann in ein
    // bereits laufendes Video statt in eine dunkle Fläche, in die das erste
    // Bild hineinpoppt. Über den Holder reist nur die ANZEIGE; die Daten
    // (uri) gehen weiterhin als Param, die dokumentierte Grenze bleibt.
    const player = createVideoPlayer(ergebnis.uri);
    player.loop = true;
    player.muted = true;
    // Stumm braucht er die Audio-Session nicht — und nur so lässt der
    // spätere Mikrofon-Umbau dieses Screens ihn in Ruhe (vorschau.tsx).
    player.audioMixingMode = 'mixWithOthers';
    player.play();
    // Poster und Player-Vorlauf laufen parallel; das Gate ist der langsamere
    // von beiden, gedeckelt durch die jeweilige Frist.
    const [poster] = await Promise.all([posterErzeugen(ergebnis.uri), playerBereit(player)]);
    if (player.status === 'error') {
      // Ein kaputter Player zeigt nichts: freigeben, die Vorschau lädt dann
      // selbst über die uri — der alte Weg als Rückfallebene.
      player.release();
    } else {
      uebergabe.videoUebergeben({ art: 'player', player, poster });
    }
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
      {multiCam ? (
        // Der Sucher der eigenen Session. Er kennt weder `mute` noch `flash`,
        // `enableTorch`, `selectedLens` oder `onAvailableLensesChanged`: das
        // Mikrofon hängt an der Session selbst (nicht an einem Prop), die
        // Linse wählt der Zoom-Weg, und der Blitz kommt in einem eigenen
        // Schritt. Alles darüber (Zoomfläche, Fokus-Ring, Kopfzeile,
        // Zoom-Reihe, Auslöser) ist für beide Zweige dasselbe.
        <multiKamera.MultiKameraSucher
          testID="multikamera-sucher"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={richtung}
          mode="video"
          // Nicht `!fokussiert` allein: die Tab-Bar bleibt sichtbar, eine
          // GESPERRTE Aufnahme läuft nach dem Loslassen weiter, und ein Tipp
          // auf einen anderen Tab feuert das Fokus-Cleanup mitten drin.
          // `mute` wechselt dort aber keinen reinen Schalter — expo-camera baut
          // dafür `session.beginConfiguration()` + `removeInput(audio)`, und
          // eine Session-Rekonfiguration MITTEN in einer laufenden
          // AVCaptureMovieFileOutput-Aufnahme bricht sie ab. Solange `nimmtAuf`
          // gilt, bleibt das Mikrofon also an, unabhängig vom Fokus — es nimmt
          // ja gerade auf. Und solange die AUFNAHME-VORSCHAU den Tab überdeckt
          // (inVorschau), ebenfalls: das Wiederanhängen beim Instant-Rückweg
          // war genau der Session-Umbau, der den Sucher im Moment der Rückkehr
          // einfror (Nutzer-Befund 2026-08-18). Erst ein echter Tab-Wechsel
          // hängt das Mikrofon ab — der orange Punkt soll nicht app-weit
          // leuchten.
          mute={!fokussiert && !nimmtAuf && !inVorschau}
          // `flash` gilt für Fotos; beim Video braucht es stattdessen das
          // Dauerlicht, derselbe Schalter, zwei Prop-Namen. Ob der Foto-Blitz
          // im Video-Preset am Gerät wirklich feuert, prüft die Geräte-
          // Checkliste (Spec 2026-08-13 §9); Fallback wäre die Torch.
          flash={blitz}
          enableTorch={blitz === 'on' && nimmtAuf}
          videoQuality="1080p"
          // Die Mehrfach-Kamera als EIN Gerät: darin schaltet iOS zwischen den
          // Linsen selbst um, nahtlos und ohne die Session neu aufzubauen. Nur
          // so führt der Zoom über 0,5× hinweg, ohne zu stocken.
          selectedLens={zoom?.name}
          // Feuert nach jedem Gerätewechsel, und zwar NACH expo-cameras
          // eigenem updateZoom (addDevice, defer-Block): genau der Moment, in
          // dem unser Faktor wiederhergestellt gehört.
          onAvailableLensesChanged={() => {
            // Die neue Kamera liefert: die Wechsel-Blende kann weg.
            setWechselLaeuft(false);
            zoomNachsetzen();
          }}
        />
      )}
      {/* Fängt die Bewegung zweier Finger ab. Liegt über dem Kamerabild, aber
          unter allem Bedienbaren: was danach kommt, bekommt seine
          Berührungen zuerst. */}
      <View testID="sucher-zoomflaeche" style={StyleSheet.absoluteFill} {...zoomGeste} />
      {fokusPunkt && (
        <FokusRing
          key={fokusPunkt.stand}
          x={fokusPunkt.x}
          y={fokusPunkt.y}
          onFertig={fokusRingFertig}
        />
      )}
      {wechselLaeuft && <WechselBlende />}
      {/* Läuft ein Video, verschwindet die Kopfzeile (Spec 2026-08-12). Der
          Grund ist nicht Ästhetik: Im gesperrten Zustand ist die Hand frei,
          diese Knöpfe wären also erreichbar, und ein Kamera-Wechsel mitten in
          recordAsync kann die laufende Aufnahme abbrechen. Entfernt statt nur
          ausgeblendet, damit auch VoiceOver nichts anbietet, was gerade nicht
          zu bedienen ist. */}
      {!nimmtAuf && (
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
            <PillenKnopf label="Kamera wechseln" onPress={kameraWechseln}>
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
      {aufnahmeFehler && (
        <Pille style={[styles.fehlerPille, { bottom: fehlerUnten(zoomSichtbar) + leisteHoehe }]}>
          <Text style={[type.secondary, styles.fehlerText]}>{aufnahmeFehler}</Text>
        </Pille>
      )}
      {zoomSichtbar && zoom && (
        <View
          style={[
            styles.zoomWrap,
            { bottom: AUSLOESER_UNTEN + AUSLOESER_GROESSE + ZOOM_ABSTAND + leisteHoehe },
          ]}
        >
          <ZoomWahl
            stufen={zoom.stufen}
            faktor={faktor}
            onWahl={(stufe) => zoomSetzen(stufe, true)}
          />
        </View>
      )}
      <View
        testID="ausloeser-buehne"
        style={[styles.ausloeserWrap, { bottom: AUSLOESER_UNTEN + leisteHoehe }]}
      >
        <Ausloeser
          onFoto={() => void handleFoto()}
          onVideoStart={handleVideoStart}
          onVideoStop={() => void handleVideoStop()}
          onZoomZug={zoomZug}
          maxSekunden={MAX_VIDEO_SEKUNDEN}
          onSperre={setAufnahmeGesperrt}
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
  // `bottom` fehlt hier wie beim zoomWrap bewusst: seit die Tab-Leiste als
  // Overlay über dem Bild liegt, kommt zum Bodenabstand die Leistenhöhe des
  // Geräts dazu (leisteHoehe, siehe JSX), und die kennt erst das Rendern.
  ausloeserWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  // Dicht über dem Auslöser, wie in der Kamera-App: dessen Bodenabstand plus
  // Durchmesser plus der knappe Abstand dazwischen (Werte im JSX).
  zoomWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  // Über dem Auslöser, nicht darunter (dort liegt die Tab-Bar) und nicht
  // oben, wo sie beim nächsten Versuch unter der Kopfzeile klemmte. `bottom`
  // fehlt hier bewusst: es hängt daran, ob die Zoom-Reihe dazwischenliegt,
  // und kommt darum aus fehlerUnten().
  fehlerPille: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.m,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  // Zentriert, weil ein einzelner kurzer Satz in einer Pille keine Textwüste
  // ist, die §7 meint, sondern eine Beschriftung.
  fehlerText: { color: cinema['text-1'], textAlign: 'center' },
  // Der Fokus-Ring: eine feine helle Linie auf dem Kamerabild, Radius 999
  // (§4). `left`/`top` fehlen bewusst — sie kommen vom Tipp-Punkt.
  fokusRing: {
    position: 'absolute',
    width: FOKUS_RING_GROESSE,
    height: FOKUS_RING_GROESSE,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: cinema['text-1'],
  },
});
