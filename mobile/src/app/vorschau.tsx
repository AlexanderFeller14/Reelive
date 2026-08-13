import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pencil, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pille } from '@/components/Pille';
import { PressScale } from '@/components/PressScale';
import { Versiegelung } from '@/components/Versiegelung';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante, useUnterkante } from '@/theme/useOberkante';
import * as medien from '@/features/moments/medien';
import * as ortUndZeit from '@/features/moments/ortUndZeit';
import * as uebergabe from '@/features/kamera/uebergabe';
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
  // Der Fuss steht bewusst näher am Rand als useUnterkante() vorgibt: Auf
  // diesem Screen trägt er nur EINEN Knopf, und der gehört in Daumenreichweite
  // ans untere Ende. `insets.bottom` heisst «direkt über dem Home-Indicator»,
  // nicht darauf; Geräte ohne Indicator behalten den gestalteten Mindestrand.
  const insets = useSafeAreaInsets();
  const unterkante = Math.max(spacing.base, insets.bottom);
  const { uri, typ, dauer, tripId } = useLocalSearchParams<{
    uri?: string;
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

  // Das Foto kommt seit dem Instant-Foto (Spec 2026-08-13 §4) als natives
  // Speicher-Objekt über das Übergabe-Modul, nicht als Datei-URI: EINMAL
  // beim Erscheinen abgeholt, wie `zeit` daneben. Videos (und der
  // Deep-Link-Fall) tragen weiterhin eine uri in den Params — `foto` ist
  // dann null und alles läuft den alten Weg.
  const [foto] = useState(() => (typ === 'photo' ? uebergabe.abholen() : null));

  // Nachzug aus Task 8 (Video-Nachzug): «das Aufgenommene formatfüllend» gilt
  // auch für Videos, dieser Screen ist der letzte Blick vor dem Versiegeln.
  // Stumm und in Schleife, ohne Bedienelemente: eine Vorschau, kein Player.
  // `source: null` bei Fotos, damit kein Player für eine Bild-URI angelegt
  // wird (Hooks laufen unabhängig von `typ` unbedingt, siehe Hook-Regeln).
  const player = useVideoPlayer(typ === 'video' ? (uri ?? null) : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  // Weder Übergabe noch uri: per Deep Link geöffnet, ohne dass je eine
  // Aufnahme entstand. Zurück zur Kamera statt eines leeren Screens.
  const quelleFehlt = typ === 'photo' ? !foto && !uri : !uri;
  useEffect(() => {
    if (quelleFehlt) router.replace('/aufnehmen');
  }, [quelleFehlt, router]);

  // Höhe der stehenden Tastatur, 0 heisst geschlossen.
  //
  // Der Screen weicht ihr selbst aus, statt sich auf eine
  // KeyboardAvoidingView zu verlassen: die setzt bei `behavior="padding"` nur
  // ein `paddingBottom` an ihrem eigenen View, und das erreicht absolut
  // positionierte Kinder nicht. Hier ist aber JEDE Ebene absolut positioniert.
  //
  // Was hier NICHT hineinzählen darf, ist eine eigene InputAccessoryView: Sie
  // wird in die gemeldete Tastaturhöhe eingerechnet, auch wenn man sie nicht
  // sieht, und das Feld sass dadurch rund 100 Punkte zu hoch. Es gibt sie
  // nicht mehr, das «Fertig» sitzt jetzt auf der Tastatur selbst.
  const [tastatur, setTastatur] = useState(0);
  // Gemessene Höhe des unteren Blocks (Fehlermeldung + Einsenden-Knopf), an
  // der die Bildunterschrift in Ruhe hängt.
  const [fussHoehe, setFussHoehe] = useState(0);
  // Ob das Eingabefeld gerade offen ist. In Ruhe steht an seiner Stelle nur
  // ein Chip, so breit wie sein Text: Ein leeres Eingabefeld über die ganze
  // Breite ist ein Kasten, der nichts zeigt und dem Foto den Platz nimmt. Erst
  // ein Tipp darauf holt das Feld (und mit `autoFocus` die Tastatur) hervor,
  // und es erscheint gleich dort, wo man es beim Schreiben braucht.
  const [feldOffen, setFeldOffen] = useState(false);

  useEffect(() => {
    // iOS meldet die Tastatur an, BEVOR sie steht, und liefert Dauer und
    // Kurve ihrer Bewegung gleich mit. Android meldet erst danach.
    const istIOS = Platform.OS === 'ios';
    const mitfahren = (dauer?: number, kurve?: keyof typeof LayoutAnimation.Types) => {
      if (!dauer) return;
      // Dasselbe Mittel, mit dem die KeyboardAvoidingView ihr Padding
      // animiert: die Pille fährt mit der Tastatur statt vor ihr her zu
      // springen. `prefers-reduced-motion` bleibt hier bewusst unbefragt,
      // weil das die Bewegung des Systems selbst ist, nicht unsere
      // Inszenierung; iOS dämpft sie dort bereits an der Quelle.
      LayoutAnimation.configureNext({
        duration: dauer,
        update: { duration: dauer, type: LayoutAnimation.Types[kurve ?? 'keyboard'] },
      });
    };
    const auf = Keyboard.addListener(istIOS ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      mitfahren(e.duration, e.easing);
      // Die grösste gemeldete Höhe gewinnt, solange die Tastatur steht: Beim
      // Tippen tauscht iOS die Leiste über den Tasten aus (der «Write with
      // Siri»-Hinweis weicht den Wortvorschlägen) und meldet dabei eine neue,
      // oft kleinere Höhe. Folgte das Feld jeder Meldung, ruckte es mitten im
      // Schreiben auf und ab. Nach oben geht es weiterhin mit, sonst
      // verschwände es hinter einer Tastatur, die wächst (Emoji, andere
      // Sprache). Zurückgesetzt wird beim Schliessen.
      setTastatur((bisher) => Math.max(bisher, e.endCoordinates.height));
    });
    const zu = Keyboard.addListener(istIOS ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      mitfahren(e.duration, e.easing);
      setTastatur(0);
      // Mit der Tastatur geht auch das Feld: Was geschrieben wurde, steht
      // danach im Chip, und ein leeres Feld bleibt nicht als Kasten stehen.
      setFeldOffen(false);
    });
    return () => {
      auf.remove();
      zu.remove();
    };
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
  // Über useState statt useRef, wie schon bei `pan`: die Wisch-Handler werden
  // beim Rendern gelesen, und ein Ref darf beim Rendern nicht gelesen werden
  // (react-hooks/refs). Erzeugt wird der Responder trotzdem nur einmal.
  const [panResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  );

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
    // Final-Review, Critical 2 (unverändert gültig): auch der Verwerfen-Weg
    // darf keine Datei hinterlassen. Beim Instant-Foto entsteht sie im
    // Hintergrund und ist womöglich noch nicht fertig — deshalb hängt das
    // Abräumen am Promise statt an einem Wert. Scheiterte das Speichern,
    // gibt es nichts zu räumen.
    if (foto) {
      void foto.datei.then((d) => medien.dateiVerwerfen(d.uri)).catch(() => {});
    } else if (uri) {
      medien.dateiVerwerfen(uri);
    }
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
    // Die Quelle der Aufnahme: beim Instant-Foto die im Hintergrund
    // gespeicherte Datei (das await unten wartet, falls sie noch schreibt,
    // und wirft, falls sie scheiterte — voller Speicher landet damit im
    // selben catch wie bisher), sonst die uri aus den Params.
    let quelle: string | null = null;
    try {
      quelle = foto ? (await foto.datei).uri : (uri ?? null);
      if (!quelle) {
        // quelleFehlt leitet bereits um, hierher kommt es nie — aber wenn
        // doch, darf der Knopf nicht für immer im Lade-Zustand hängen.
        setSendet(false);
        return;
      }
      aufbereitet =
        typ === 'video' ? await medien.videoAufbereiten(quelle) : await medien.fotoAufbereiten(quelle);

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
      medien.dateiVerwerfen(quelle);
      medien.zwischenfassungenVerwerfen(quelle, aufbereitet);

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
      if (aufbereitet && quelle) medien.zwischenfassungenVerwerfen(quelle, aufbereitet);
      console.error('[preview] Einsenden fehlgeschlagen', fehler);
      setSendeFehler(SENDEN_FEHLGESCHLAGEN_MELDUNG);
      setSendet(false);
    }
  };

  const ortZeitText = ort.place_name ? `${ort.place_name} · ${zeitAnzeige(zeit.captured_at)}` : zeitAnzeige(zeit.captured_at);

  const schreibt = tastatur > 0;
  // Wo die Bildunterschrift beim Schreiben steht: direkt über der Tastatur,
  // einen gestalteten Abstand darüber. Auf iOS bleibt das Fenster gleich
  // gross, der Screen überbrückt die volle Tastaturhöhe selbst (die gemeldete
  // Höhe schliesst die Tastaturleiste mit ein). Auf Android verkleinert das
  // Fenster sich bereits von aussen (softwareKeyboardLayoutMode «resize», der
  // Expo-Standard), dort wäre die Höhe ein zweites Mal gerechnet.
  const schreibPosition = (Platform.OS === 'ios' ? tastatur : 0) + spacing.base;
  // Und wo sie in Ruhe steht: direkt über dem Fuss, wie hoch der auch gerade
  // ist. `spacing.xl` ist nur der Stand, bis der Fuss sich einmal gemessen hat.
  const ruhePosition = unterkante + (fussHoehe || spacing.xl) + spacing.base;

  if (quelleFehlt) return null;

  return (
    <View style={styles.screen}>
      {/* Ohne Slide, als dokumentierte §5-Ausnahme (Spec 2026-08-13 §6):
          eingefrorenes Sucherbild und Aufnahme sind deckungsgleich, ein
          Parallax-Slide würde dasselbe Vollbild wegschieben und wieder
          hereinholen — er inszeniert einen Ortswechsel, den es nicht gibt. */}
      <Stack.Screen options={{ animation: 'none' }} />

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
        <Image
          testID="foto-vorschau"
          source={foto ? foto.ref : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
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

      {/* Zweiter Ausweg aus dem Feld, neben der Fertig-Taste auf der Tastatur:
          ein Tipp irgendwohin auf das Foto. Er liegt bewusst NUR über dem
          Medium und unter allem Bedienbaren, sonst verschluckte er den ersten
          Tipp auf «Einsenden». */}
      {schreibt && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tastatur schliessen"
          style={StyleSheet.absoluteFill}
          onPress={() => Keyboard.dismiss()}
        />
      )}

      <Pille style={[styles.kopfPille, { top: oberkante }]}>
        <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
      </Pille>

      {/* Verwerfen sitzt als X in der Kopfzeile, gegenüber von Ort und Zeit:
          Es ist der Rückweg aus diesem Screen, keine gleichrangige Alternative
          zum Einsenden. Unten stand es vorher neben dem Primär-Knopf und nahm
          ihm ein Drittel der Breite. */}
      <PressScale
        testID="verwerfen-knopf"
        accessibilityRole="button"
        accessibilityLabel="Aufnahme verwerfen"
        disabled={sendet}
        onPress={verwerfen}
        style={[styles.verwerfenWrap, { top: oberkante }]}
      >
        <Pille style={styles.verwerfenPille}>
          <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
        </Pille>
      </PressScale>

      {/* Beim Schreiben steht die Bildunterschrift über der Tastatur, in Ruhe
          direkt über dem Einsenden-Knopf: die beiden gehören zusammen, sie
          sollen nicht als zwei Bänder mit Leere dazwischen dastehen. Die
          Wisch-Geste ruht beim Schreiben, sonst zöge jeder Tippfehler-Wisch
          das Feld wieder unter die Tastatur; der Versatz bleibt erhalten und
          kommt beim Schliessen zurück. */}
      <Animated.View
        testID="bildunterschrift-feld"
        {...(schreibt ? {} : panResponder.panHandlers)}
        style={[
          styles.captionWrap,
          schreibt
            ? { bottom: schreibPosition }
            : { bottom: ruhePosition, transform: pan.getTranslateTransform() },
        ]}
      >
        {feldOffen ? (
          <Pille style={styles.captionPille}>
            <TextInput
              accessibilityLabel="Bildunterschrift"
              value={caption}
              onChangeText={(text) => setCaption(text.slice(0, CAPTION_MAX))}
              placeholder="Schreib etwas dazu"
              placeholderTextColor={cinema['text-2']}
              maxLength={CAPTION_MAX}
              autoFocus
              // Einzeilig, und damit steht auf der Eingabetaste unten rechts
              // «Fertig» statt eines Zeilenumbruchs: der Weg aus der Tastatur,
              // den iOS selbst anbietet. Bei `multiline` gibt es ihn nicht,
              // dort setzt dieselbe Taste eine neue Zeile, und genau deshalb
              // kam man aus diesem Feld vorher nicht mehr heraus. Für eine
              // Bildunterschrift von höchstens 120 Zeichen braucht es keine
              // Absätze.
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => Keyboard.dismiss()}
              // Android setzt Text in einem Eingabefeld sonst an die Oberkante.
              textAlignVertical="center"
              style={[styles.captionInput, { color: cinema['text-1'] }]}
            />
          </Pille>
        ) : (
          <PressScale
            testID="bildunterschrift-chip"
            accessibilityRole="button"
            accessibilityLabel={caption ? `Bildunterschrift ändern: ${caption}` : 'Etwas dazu schreiben'}
            onPress={() => setFeldOffen(true)}
            style={styles.chipWrap}
          >
            <Pille style={styles.chipPille}>
              {/* Der Stift lädt zum Schreiben ein. Steht schon etwas da,
                  spricht der Text für sich und der Stift wäre Rauschen. */}
              {!caption && <Pencil size={14} color={cinema['text-2']} strokeWidth={1.75} />}
              <Text
                style={[type.body, { color: caption ? cinema['text-1'] : cinema['text-2'] }]}
                numberOfLines={2}
              >
                {caption || 'Schreib etwas dazu'}
              </Text>
            </Pille>
          </PressScale>
        )}
      </Animated.View>

      {/* Fehlermeldung und Knopf stehen als EIN Block am unteren Rand und
          werden zusammen gemessen (onLayout). Die Bildunterschrift hängt sich
          an diese Höhe, statt an eine geratene Zahl: sonst überlappte sie den
          Text, sobald eine Meldung dazukommt und den Block wachsen lässt. */}
      <View
        testID="fuss"
        style={[styles.fuss, { bottom: unterkante }]}
        onLayout={(e) => setFussHoehe(e.nativeEvent.layout.height)}
      >
        {sendeFehler && (
          <Text style={[type.secondary, styles.fehlerText, { color: palette.danger }]}>
            {sendeFehler}
          </Text>
        )}
        <EinsendenButton onPress={() => void absenden()} loading={sendet} />
      </View>


      <Versiegelung sichtbar={versiegelt} onFertig={zurueckZurKamera} />
    </View>
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
  // Dieselbe Form wie der Chip, aus dem sie hervorgeht: Beim Antippen soll sich
  // die Pille öffnen, nicht in einen Kasten umspringen. `minHeight` +
  // `justifyContent` halten den Text auf halber Höhe, statt ihn oben kleben zu
  // lassen.
  // Wie `type.body`, aber bewusst OHNE dessen `lineHeight: 24`: Auf iOS legt
  // eine gesetzte Zeilenhöhe einen Absatz-Stil über den EINGEGEBENEN Text,
  // nicht aber über den Platzhalter. Der Text sprang dadurch beim ersten
  // Zeichen ein paar Punkte nach unten. Für eine einzeilige Bildunterschrift
  // trägt die Zeilenhöhe ohnehin nichts bei.
  captionInput: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    fontVariant: type.body.fontVariant,
  },
  captionPille: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // Der Chip nimmt nur die Breite, die sein Text braucht: `flex-start` am
  // Halter, der über die volle Screenbreite geht. Die Pille selbst ist rund
  // (radius.pill) wie jede andere UI auf einem Foto, DESIGN-LANGUAGE §4.
  chipWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  chipPille: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // Das X liegt der Ort-und-Zeit-Pille gegenüber, auf gleicher Höhe.
  verwerfenWrap: {
    position: 'absolute',
    right: spacing.screen,
  },
  verwerfenPille: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fehlerText: { textAlign: 'center' },
  fuss: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    gap: spacing.m,
  },
  einsendenButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
