import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { Versiegelung } from '@/components/Versiegelung';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante, useUnterkante } from '@/theme/useOberkante';
import * as medien from '@/features/moments/medien';
import * as ortUndZeit from '@/features/moments/ortUndZeit';
import * as uploadWorker from '@/features/moments/uploadWorker';
import { useAuth } from '@/features/auth/AuthProvider';
import type { QueueJob } from '@/features/moments/types';

const CAPTION_MAX = 120;

const OHNE_REISE_MELDUNG =
  'Diese Aufnahme lässt sich keiner Reise zuordnen. Geh zurück zur Kamera und versuch es nochmal.';
// Praktisch unerreichbar (das Root-Layout lässt diesen Screen nur bei
// status === 'signedIn' zu), aber ein Job ohne Autoren-Kennung darf nie
// erzeugt werden, deshalb sichtbar abgelehnt statt geraten, gleiches Prinzip
// wie OHNE_REISE_MELDUNG (Task-13-Fix-Runde-2).
const OHNE_SITZUNG_MELDUNG = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';
const SENDEN_FEHLGESCHLAGEN_MELDUNG =
  'Der Moment konnte nicht gesichert werden, oft weil kein Speicherplatz mehr frei ist. Räum etwas Platz frei und versuch es nochmal.';

function zweistellig(n: number): string {
  return String(n).padStart(2, '0');
}

// Lokale Uhrzeit auf dem Gerät, das die Aufnahme gemacht hat, bewusst ohne
// Intl, um von der Jest-/Hermes-ICU-Unterstützung unabhängig zu bleiben
// (gleiches Vorsichtsprinzip wie tripDay.ts).
function zeitAnzeige(iso: string): string {
  const datum = new Date(iso);
  return `${zweistellig(datum.getHours())}:${zweistellig(datum.getMinutes())}`;
}

type Ort = { lat: number | null; lng: number | null; place_name: string | null };
const KEIN_ORT: Ort = { lat: null, lng: null, place_name: null };

// Medien-Screen (DESIGN-LANGUAGE v2 §1): feste Kino-Palette, kein useTheme(),
// gleiches Muster wie index.tsx. `accent`/`on-accent`/`danger` kommen direkt
// aus `palette`, weil es reine Interaktions-/Fehlerfarben sind, die
// unabhängig von Hell/Kino funktionieren.
function EinsendenButton({
  onPress,
  loading,
}: {
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <PressScale
      testID="einsenden-knopf"
      accessibilityRole="button"
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={() => {
        if (!loading) onPress();
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.einsendenButton,
            { backgroundColor: pressed ? palette['accent-pressed'] : palette.accent },
          ]}
        >
          {loading ? (
            <ActivityIndicator testID="einsenden-loading" color={palette['on-accent']} />
          ) : (
            <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Einsenden</Text>
          )}
        </View>
      )}
    </PressScale>
  );
}

export default function PreviewScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  // Randloser Medien-Screen ohne Header: die Pille oben lag unter der Insel,
  // der Einsenden-Knopf unten auf dem Home-Indicator. Die drei unteren Ebenen
  // (Fuss, Fehler, Bildunterschrift) stehen in festen Abstaenden zueinander
  // und muessen deshalb GEMEINSAM ausweichen, sonst ueberlappen sie.
  const oberkante = useOberkante(spacing.xl);
  const unterkante = useUnterkante(spacing.xl);
  const untererVersatz = unterkante - spacing.xl;
  const { uri, typ, dauer, tripId } = useLocalSearchParams<{
    uri: string;
    typ: 'photo' | 'video';
    dauer: string;
    tripId?: string;
  }>();

  const [caption, setCaption] = useState('');
  const [ort, setOrt] = useState<Ort>(KEIN_ORT);
  const [sendet, setSendet] = useState(false);
  const [sendeFehler, setSendeFehler] = useState<string | null>(null);
  // Wird erst wahr, NACHDEM der Job sicher in der Warteschlange steckt (siehe
  // absenden unten), die Inszenierung entscheidet nie darüber, ob ein
  // Moment gesichert ist, sie kommentiert nur einen bereits gesicherten.
  const [versiegelt, setVersiegelt] = useState(false);
  // captured_at/captured_tz werden EINMAL beim Erscheinen dieses Screens
  // eingefroren (lazy state init), das liegt so nah wie möglich am
  // tatsächlichen Auslöser-Moment aus Task 7 und darf sich nicht mit jedem
  // Tastenanschlag an der Caption weiterbewegen.
  const [zeit] = useState(() => ortUndZeit.jetzt());

  // Nachzug aus Task 8 (Video-Nachzug): «das Aufgenommene formatfüllend» gilt
  // auch für Videos, dieser Screen ist der letzte Blick vor dem Versiegeln.
  // Stumm und in Schleife, ohne Bedienelemente: eine Vorschau, kein Player.
  // `source: null` bei Fotos, damit kein Player für eine Bild-URI angelegt
  // wird (Hooks laufen unabhängig von `typ` unbedingt, siehe Hook-Regeln).
  const player = useVideoPlayer(typ === 'video' ? uri : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  // Die Ortsbestimmung darf die Aufnahme nie kosten: sie läuft im Hintergrund
  // los, der Screen wartet nicht auf sie, um zu erscheinen (Task-8-Kontext).
  useEffect(() => {
    let aktiv = true;
    void ortUndZeit.ortBestimmen().then((ergebnis) => {
      if (aktiv) setOrt(ergebnis);
    });
    return () => {
      aktiv = false;
    };
  }, []);

  // Draggable Caption: nur `transform` bewegt sich (DESIGN-LANGUAGE §5),
  // Position akkumuliert über extractOffset() statt bei jedem Loslassen auf
  // 0 zurückzuspringen.
  const [pan] = useState(() => new Animated.ValueXY());
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  ).current;

  // Final-Review, Important 3: die Vorfassung navigierte mit
  // router.replace('/aufnehmen') zurück. replace ersetzt aber nur den
  // fokussierten Eintrag durch einen NEUEN, aus [kamera, preview] wurde
  // [kamera, kamera]. Jede Aufnahme stapelte damit einen weiteren
  // Kamera-Screen, jeder mit eigener Kamera-Instanz, und die Zurück-Geste lief
  // rückwärts durch alte Kameras statt aus dem Tab heraus. Diese Vorschau
  // schliessen heisst: sie vom Stapel nehmen. Das erfüllt zugleich «kein
  // Zurück zum Moment» (Spec §4), der Screen ist dann weg, nicht überdeckt.
  //
  // canGoBack(): der Screen ist auch per Deep Link erreichbar, dann gibt es
  // nichts zurückzunehmen, nur DORT ist replace richtig.
  const zurueckZurKamera = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/aufnehmen');
  };

  const verwerfen = () => {
    if (sendet) return;
    // Final-Review, Critical 2: auch der Verwerfen-Weg hinterliess bisher eine
    // Datei, die Rohaufnahme aus der Kamera. Sie liegt im Cache, wird von hier
    // an von niemandem mehr gebraucht und darf nicht zum Speicherdruck
    // beitragen, der die Warteschlange gefährdet.
    medien.dateiVerwerfen(uri);
    zurueckZurKamera();
  };

  const absenden = async () => {
    // Doppel-Tipp während eines laufenden Sendevorgangs darf keinen zweiten
    // Job erzeugen.
    if (sendet) return;

    // Navigationslücke: der Kamera-Screen (Task 7) reicht aktuell nur uri/typ/
    // dauer weiter, kein tripId. Ohne trip_id liesse sich weder der storage_key
    // noch die posts-Zeile korrekt bilden, ein Raten wäre eine stillschweigend
    // falsch zugeordnete Aufnahme, also wird hier sichtbar abgelehnt statt
    // geraten (gleiches Prinzip wie beim Speicherfehler unten).
    if (!tripId) {
      setSendeFehler(OHNE_REISE_MELDUNG);
      return;
    }

    // Autoren-Kennung wird HIER, beim Einreihen, festgehalten, nicht erst
    // vom Worker beim Schreiben aus der dann aktuell aktiven Sitzung gelesen
    // (Task-13-Fix-Runde-2). Sonst könnte ein Moment, der noch in der
    // Warteschlange liegt, unter dem Namen der nächsten angemeldeten Person
    // auf demselben Gerät landen.
    if (!userId) {
      setSendeFehler(OHNE_SITZUNG_MELDUNG);
      return;
    }

    setSendeFehler(null);
    setSendet(true);
    const postId = medien.neuePostId();
    // Ausserhalb des try: der catch-Zweig muss wissen, was schon entstanden
    // ist, um genau das Abgeleitete freizugeben, und nichts sonst.
    let aufbereitet: { medium: string; thumb: string } | null = null;
    try {
      aufbereitet =
        typ === 'video' ? await medien.videoAufbereiten(uri) : await medien.fotoAufbereiten(uri);

      // Final-Review, Critical 2: Kamera, Bildbearbeitung und Video-Standbild
      // schreiben alle nach Library/Caches, ein Verzeichnis, das iOS unter
      // Speicherdruck leeren darf. Die Warteschlange soll Momente aber
      // tagelang halten. Deshalb entsteht HIER, vor dem Einreihen, eine
      // dauerhafte Kopie, und der Job merkt sich diese Pfade, nicht die
      // flüchtigen.
      const { medium, thumb } = await medien.dauerhaftSichern(postId, aufbereitet);

      // Final-Review, Important 5: die Endung kommt aus der TATSÄCHLICHEN
      // Aufnahme, nicht aus der Aufnahmeart, expo-camera liefert auf iOS
      // QuickTime (.mov), auf Android .mp4. Fotos gehen immer als JPEG raus,
      // weil fotoAufbereiten sie ohnehin neu kodiert.
      const endung = medien.medienEndung(typ, aufbereitet.medium);

      const getrimmteCaption = caption.trim();
      const job: QueueJob = {
        id: postId,
        post_id: postId,
        trip_id: tripId,
        author_id: userId,
        typ,
        medium_uri: medium,
        thumb_uri: thumb,
        storage_key: medien.storageKey(tripId, postId, endung),
        thumb_key: medien.thumbKey(tripId, postId),
        caption: getrimmteCaption.length > 0 ? getrimmteCaption : null,
        captured_at: zeit.captured_at,
        captured_tz: zeit.captured_tz,
        lat: ort.lat,
        lng: ort.lng,
        place_name: ort.place_name,
        duration_s: typ === 'video' ? Number(dauer) : null,
        zustand: 'wartet',
        versuche: 0,
        naechster_versuch: Date.now(),
        zeile_angelegt: false,
        medium_geladen: false,
        thumb_geladen: false,
      };

      // Nicht verhandelbar (Task-8-Brief): der Job muss in der Warteschlange
      // stecken, BEVOR irgendeine Inszenierung läuft, die Inszenierung darf
      // nie darüber entscheiden, ob ein Moment gesichert ist.
      await uploadWorker.jobEinreihen(job);

      // ERST HIER gehört der Moment der Warteschlange, und erst jetzt dürfen
      // die Quellen weg: die Rohaufnahme aus der Kamera und alles daraus
      // Abgeleitete im Cache. Vorher wäre bei einem Video die einzige Kopie
      // dran (Re-Review).
      medien.dateiVerwerfen(uri);
      medien.zwischenfassungenVerwerfen(uri, aufbereitet);

      // Der Moment ist ab hier bereits sicher in der Warteschlange, die
      // Versiegelungs-Inszenierung (Gold-Glow, 700–900 ms, Haptik success,
      // DESIGN-LANGUAGE §5) kommentiert das nur noch, sie entscheidet über
      // nichts mehr. Sie navigiert selbst weiter, sobald sie fertig ist
      // (onFertig unten), bis dahin bleibt der Screen stehen, überdeckt vom
      // Kino-Overlay.
      setVersiegelt(true);
    } catch (fehler) {
      // Ein Fehler beim Aufbereiten oder Einreihen (z.B. voller Gerätespeicher,
      // Spec §7/§8) wird sichtbar gemacht statt den Moment stillschweigend
      // verschwinden zu lassen, der Screen bleibt stehen.
      //
      // Was schon im dauerhaften Ordner liegt, muss dabei weg: ohne Job in der
      // Warteschlange käme nie wieder jemand daran vorbei, der ihn aufräumt.
      // Es ist nur eine KOPIE, das Original bleibt unangetastet (Re-Review).
      medien.momentDateienEntfernen(postId);
      // Die abgeleiteten Zwischenfassungen im Cache dazu; ein zweiter Versuch
      // erzeugt sie neu. Die Rohaufnahme bleibt garantiert liegen, der Screen
      // bleibt stehen und ein zweiter Versuch braucht sie noch. Bei einem Video
      // IST sie das Medium, und zwischenfassungenVerwerfen lässt genau sie in
      // Ruhe.
      if (aufbereitet) medien.zwischenfassungenVerwerfen(uri, aufbereitet);
      console.error('[preview] Einsenden fehlgeschlagen', fehler);
      setSendeFehler(SENDEN_FEHLGESCHLAGEN_MELDUNG);
      setSendet(false);
    }
  };

  const ortZeitText = ort.place_name ? `${ort.place_name} · ${zeitAnzeige(zeit.captured_at)}` : zeitAnzeige(zeit.captured_at);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {typ === 'video' ? (
        <VideoView
          testID="video-vorschau"
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      {/* Foto-Scrims: der einzige erlaubte Gradient der App (DESIGN-LANGUAGE §1). */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'transparent']}
        style={styles.scrimOben}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.35)']}
        style={styles.scrimUnten}
        pointerEvents="none"
      />

      <Pille style={[styles.kopfPille, { top: oberkante }]}>
        <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
      </Pille>

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.captionWrap,
          { bottom: 168 + untererVersatz, transform: pan.getTranslateTransform() },
        ]}
      >
        <Pille style={styles.captionPille}>
          <TextInput
            accessibilityLabel="Bildunterschrift"
            value={caption}
            onChangeText={(text) => setCaption(text.slice(0, CAPTION_MAX))}
            placeholder="Schreib etwas dazu"
            placeholderTextColor={cinema['text-2']}
            maxLength={CAPTION_MAX}
            multiline
            style={[type.body, styles.captionInput, { color: cinema['text-1'] }]}
          />
        </Pille>
      </Animated.View>

      {sendeFehler && (
        <View style={[styles.fehlerBox, { bottom: 108 + untererVersatz }]}>
          <Text style={[type.secondary, { color: palette.danger }]}>{sendeFehler}</Text>
        </View>
      )}

      <View style={[styles.fuss, { bottom: unterkante }]}>
        <PressScale accessibilityRole="button" disabled={sendet} onPress={verwerfen}>
          <Text style={[type.bodyMedium, styles.verwerfenText]}>Verwerfen</Text>
        </PressScale>
        <View style={styles.einsendenWrap}>
          <EinsendenButton onPress={() => void absenden()} loading={sendet} />
        </View>
      </View>

      <Versiegelung sichtbar={versiegelt} onFertig={zurueckZurKamera} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  scrimOben: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  scrimUnten: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  kopfPille: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.screen,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  // Positionierung + Wisch-Transform bleiben auf dem äusseren Animated.View
  // (panResponder braucht ein direktes Ziel für die Geste), die eigentliche
  // Pillen-Optik (Radius, Blur, Tönung, Innenabstand) sitzt eine Ebene
  // tiefer auf `captionPille` (components/Pille.tsx), sonst liesse sich
  // beides nicht trennen: `Pille` ist keine `Animated.View`.
  captionWrap: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: 168,
  },
  captionPille: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  captionInput: {
    maxHeight: 96,
  },
  fehlerBox: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: 108,
  },
  fuss: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  verwerfenText: {
    color: cinema['text-1'],
    textDecorationLine: 'underline',
  },
  einsendenWrap: { flex: 1 },
  einsendenButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
