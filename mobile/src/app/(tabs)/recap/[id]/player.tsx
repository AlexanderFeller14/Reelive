import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { Download, MessageCircle, X } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { Fortschrittsbalken } from '@/components/Fortschrittsbalken';
import { Pille } from '@/components/Pille';
import { Sheet } from '@/components/Sheet';
import { Input } from '@/components/Input';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset, useUnterkante } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { sichereMomentInGalerie } from '@/features/recap/exportApi';
import { meldeMoment, MELDEN_MAX_LAENGE } from '@/features/recap/meldenApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { Kommentar, Reaktion, RecapMoment, RecapTag } from '@/features/recap/types';
import {
  holeVorrat,
  laeuftBaldAb,
  wiederholenHilft,
  type MedienUrl,
} from '@/features/recap/urlVorrat';
import {
  blockiertAutomatischenVorschub,
  dauerFuer,
  mitGrund,
  ohneGrund,
  ohneGruende,
  tagWechselt,
  weiter,
  zurueck,
  type PauseGrund,
  type PlayerStand,
} from '@/features/recap/playerLogic';
import {
  entferneReaktion,
  fetchKommentare,
  fetchReaktionen,
  KOMMENTAR_MAX_LAENGE,
  schreibeKommentar,
  setzeReaktion,
} from '@/features/recap/sozialApi';

// Die nächsten drei Fotos werden per expo-image vorgeladen (V8), beim
// Weitertippen darf nichts schwarz blitzen.
const VORLADEN_ANZAHL = 3;
// Tages-Zwischenkarte steht 1,5 Sekunden, dann geht es von selbst weiter
// (Task-11-Brief, Schritt 4).
const ZWISCHENKARTE_DAUER_MS = 1500;
// Unterhalb dieser Haltedauer zählt eine Berührung als "Tipp" (navigiert),
// darüber als "Halten" (pausiert nur und setzt beim Loslassen fort, ohne zu
// navigieren), Snapchat/Instagram-Story-Konvention, siehe Bericht.
const TAP_SCHWELLE_MS = 250;
// Task 8, Phase 6: langes Tippen öffnet «Diesen Moment melden». Bewusst
// deutlich über TAP_SCHWELLE_MS (250 ms, das ist schon "halten" = pausieren),
// 500 ms ist der plattformübliche Wert für eine Long-Press-Geste
// (iOS/Android-Konvention, von RN Pressable auch als Default für
// `delayLongPress` verwendet) und lässt sich klar von einem blossen Halten
// unterscheiden: WÄHREND der ersten 500 ms verhält sich eine Berührung exakt
// wie bisher (pausiert, siehe onPressIn), erst danach kommt zusätzlich das
// Melden-Sheet dazu. Kein Konflikt mit der bestehenden Gesten-Schicht nötig,
// siehe Kommentar bei `onLongPress` an den Tipp-Zonen unten.
const LANGES_TIPPEN_MS = 500;
// Wisch nach unten weiter als diese Schwelle schliesst den Player.
const SCHLIESSEN_SCHWELLE_PX = 120;
// DESIGN-LANGUAGE §5: „hell → Kino = Fade durch Dunkel 350 ms", der
// inszenierte Übergang beim Betreten des Players ("das Licht geht aus").
const KINO_FADE_DAUER_MS = 350;
const KINO_FADE_REDUZIERT_MS = 200;

// Final-Review Phase-5-Nachbesserung: Gründe, die zum VERLASSENEN Moment
// gehören und bei jedem TATSÄCHLICHEN Indexwechsel (Tipp-Navigation,
// automatischer Vorschub) zurückgenommen werden, nie zum NEUEN Moment
// mitgeschleppt. 'kommentare' und 'zwischenkarte' gehören bewusst NICHT
// hierher: 'kommentare' hängt am Sheet (schliesst über schliesseKommentare,
// nicht über einen Indexwechsel, während es offen ist, sind die Tipp-Zonen
// ohnehin vom Sheet verdeckt), 'zwischenkarte' ist über den eigenen Effekt
// (Deps u.a. stand.index) bereits selbstverwaltend.
const MOMENTWECHSEL_GRUENDE: PauseGrund[] = ['halten', 'neuversuch'];

// Feste kleine Emoji-Leiste (Task-12-Brief: kein Picker, kein neues Paket).
// `id` ist der stabile Schlüssel für testID/React-key (ein Emoji-Glyph kann
// aus mehreren Codepoints bestehen, z.B. Herz + Variationsselektor, als
// testID unpraktisch), `emoji` ist der Wert, den sozialApi tatsächlich
// speichert.
const EMOJI_LEISTE: { id: string; emoji: string; label: string }[] = [
  { id: 'herz', emoji: '❤️', label: 'Herz' },
  { id: 'lachen', emoji: '😂', label: 'Lachen' },
  { id: 'staunen', emoji: '😮', label: 'Staunen' },
  { id: 'klatschen', emoji: '👏', label: 'Applaus' },
  { id: 'weinen', emoji: '😢', label: 'Träne' },
];

// Dieselben Formulierungen wie im Schwester-Screen recap/[id]/uebersicht.tsx
// für Nachzügler/Ausgelassene (Task-11-Brief: "nimm dieselben, statt neue zu
// erfinden"), hier bewusst als eigene, kleine Kopie statt eines Imports:
// uebersicht.tsx exportiert diese Hilfsfunktionen nicht, und diese Aufgabe
// darf laut Auftrag ausschliesslich die eigenen vier Dateien anfassen, nicht
// uebersicht.tsx umbauen, um sie zu exportieren.
function unterwegsText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}
function ausgelassenText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Gleiche Kopie-Begründung wie oben: „Tag 3 · Lissabon · 12. August" ist das
// exakte Format aus uebersicht.tsx (dort ebenfalls nicht exportiert).
const MONATE_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
function formatTagesdatum(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONATE_LANG[m - 1]}`;
}
function tagesueberschrift(tag: RecapTag): string {
  const teile = [`Tag ${tag.nummer}`];
  if (tag.ort) teile.push(tag.ort);
  teile.push(formatTagesdatum(tag.datum));
  return teile.join(' · ');
}

// Uhrzeit in DER ZEITZONE DES MOMENTS (captured_tz), nicht in Gerätezeit
// (Task-11-Brief, Schritt 3), anders als preview.tsx (dort ist Moment- und
// Gerätezeit dieselbe, weil dort live aufgenommen wird) braucht das hier
// zwingend Intl.DateTimeFormat mit `timeZone`, es gibt dafür keinen
// Intl-freien Weg. Ein ungültiger/unbekannter Zonenname (siehe tage.ts,
// gleiches Verteidigungsprinzip) wirft dort einen RangeError, lieber eine
// best-effort Gerätezeit zeigen als abstürzen oder eine leere Pille.
function zeitInZone(capturedAt: string, capturedTz: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: capturedTz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(capturedAt));
  } catch {
    const d = new Date(capturedAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

// Vertrag 2 (Review-Fund der Vorgänger-Tasks): der Startindex aus der
// Übersicht bezieht sich auf die Momente mit upload_status==='uploaded', die
// AUCH im Vorrat eine URL haben, in der Reihenfolge von fetchRecapMomente,
// dieselbe Liste, die `laden()` unten als `spielliste` aufbaut. Verteidigt
// gegen fehlendes, nicht-numerisches und ausserhalb des Bereichs liegendes
// `start`, statt zu raten oder zu werfen.
function parseStartIndex(raw: string | undefined, laenge: number): number {
  if (laenge === 0) return 0;
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n >= laenge) return 0;
  return n;
}

type LadePhase = 'laedt' | 'fehler' | 'leer' | 'bereit' | 'ende';

// Medien-Screen (DESIGN-LANGUAGE v2 §1): feste Kino-Palette, kein useTheme(),
// gleiches Muster wie aufnehmen/index.tsx und preview.tsx.
function KinoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.kinoButton}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <Text style={[type.bodyMedium, styles.textLink]}>{label}</Text>
    </PressScale>
  );
}

// Ein Emoji der festen Leiste. Aktiv (eigene Reaktion): Pille füllt sich mit
// `cinema['text-1']`, derselbe Ton, den `KinoButton` bereits für "solide
// Fläche auf Kino-Hintergrund" benutzt, kein neuer Wert. 44×44: minimales
// Touch-Target (DESIGN-LANGUAGE v2 §8).
// Aktiv (eigene Reaktion) füllt sich SOLIDE mit `cinema['text-1']`, keine
// translucente Pille, also auch kein Blur: eine deckende Fläche hat nichts,
// das durchscheinen könnte. Inaktiv bleibt die Pille translucent + Blur
// (DESIGN-LANGUAGE §1/§4, Task 10).
function EmojiPille({
  id, emoji, label, aktiv, onPress,
}: {
  id: string;
  emoji: string;
  label: string;
  aktiv: boolean;
  onPress: () => void;
}) {
  return (
    <PressScale
      testID={`player-emoji-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: aktiv }}
      onPress={onPress}
    >
      {aktiv ? (
        <View style={[styles.emojiPille, styles.emojiPilleAktiv]}>
          <Text style={styles.emojiZeichen}>{emoji}</Text>
        </View>
      ) : (
        <Pille style={styles.emojiPille}>
          <Text style={styles.emojiZeichen}>{emoji}</Text>
        </Pille>
      )}
    </PressScale>
  );
}

// Reaktionen ANDERER Personen auf den aktiven Moment, dezent, nur die
// Emojis, ohne Namen und ohne Zähler (Task-12-Brief, Schritt 4: "nicht als
// Zählerbalken").
function AndereReaktionenPille({ emojis }: { emojis: string[] }) {
  if (emojis.length === 0) return null;
  return (
    <Pille
      testID="player-reaktionen-andere"
      style={styles.andereReaktionenPille}
      accessibilityLabel={`Weitere Reaktionen: ${emojis.join(', ')}`}
    >
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{emojis.join(' ')}</Text>
    </Pille>
  );
}

function KommentarZeile({ kommentar }: { kommentar: Kommentar }) {
  return (
    <View testID={`kommentar-${kommentar.id}`} style={styles.kommentarZeile}>
      <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{kommentar.autor_name}</Text>
      <Text style={[type.body, { color: cinema['text-1'] }]}>{kommentar.text}</Text>
    </View>
  );
}

function LadeHinweisPille({ text }: { text: string }) {
  return (
    <Pille style={styles.ladeHinweisPille}>
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{text}</Text>
    </Pille>
  );
}

function FotoMoment({ url, onFehler }: { url: string; onFehler: () => void }) {
  return (
    <Image
      testID="player-foto"
      source={{ uri: url }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      onError={onFehler}
    />
  );
}

// Videoende erkennen: das `playToEnd`-Event des Players (nicht ein Timer),
// der uniforme dauerFuer-Timer im Elternteil läuft trotzdem als Rückfall
// weiter (siehe dort) und schaltet notfalls auch bei einem Video weiter, das
// wegen fehlendem Netz nie lädt. `statusChange` mit status==='error' meldet
// genau diesen Ladefehlschlag an den Elternteil (V10: einmal still neu
// versuchen, bevor irgendetwas sichtbar wird).
//
// `pausiert` (die für DIESE Komponente auf ein einzelnes boolean verdichtete
// Frage "läuft gerade IRGENDEIN Pausier-Grund", siehe `gestoppt` weiter
// unten) steuert player.pause()/play() direkt: "Halten = Pause" darf sich
// nicht auf das Einfrieren des Fortschrittsbalkens beschränken, sonst liefe
// Bild UND Ton eines Videos unbeirrt weiter, während die Anzeige stillstünde.
// Genau dieser Fall (gehalten, während das Video währenddessen zu Ende
// liefe) ist auch der Grund, warum `weiterAutomatisch` beim Vorschub den
// Grund `'halten'` explizit zurücknimmt (Vertrag 4, playerLogic.ts): ohne
// echtes player.pause() könnte `playToEnd` sogar während einer Halten-Geste
// feuern.
function VideoMoment({
  url, pausiert, onEnde, onFehler,
}: {
  url: string;
  pausiert: boolean;
  onEnde: () => void;
  onFehler: () => void;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    const endeSub = player.addListener('playToEnd', onEnde);
    const statusSub = player.addListener('statusChange', (payload: { status: string }) => {
      if (payload.status === 'error') onFehler();
    });
    return () => {
      endeSub.remove();
      statusSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => {
    if (pausiert) player.pause();
    else player.play();
  }, [pausiert, player]);

  return (
    <VideoView
      testID="player-video"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

function MomentAnzeige({
  moment, url, fehlgeschlagen, pausiert, onVideoEnde, onFehler,
}: {
  moment: RecapMoment;
  url: MedienUrl | undefined;
  fehlgeschlagen: boolean;
  pausiert: boolean;
  onVideoEnde: () => void;
  onFehler: () => void;
}) {
  // Kein Ladefehler bekannt und eine URL vorhanden: normal anzeigen.
  if (!fehlgeschlagen && url) {
    return moment.type === 'video' ? (
      <VideoMoment url={url.medium_url} pausiert={pausiert} onEnde={onVideoEnde} onFehler={onFehler} />
    ) : (
      <FotoMoment url={url.medium_url} onFehler={onFehler} />
    );
  }
  // Randfall (Task-11-Brief, Schritt 7): ein Video, das nicht lädt, zeigt
  // sein Thumbnail plus Hinweis, Weitertippen bleibt möglich (die Tap-Zonen
  // liegen unverändert über dieser Fläche, sie ist rein informativ). Dieselbe
  // Behandlung gilt symmetrisch für ein Foto, dessen Laden zweimal
  // fehlschlägt (V10: eine kaputte URL darf den Recap nie beenden).
  return (
    <View style={StyleSheet.absoluteFill}>
      {url?.thumb_url && (
        <Image source={{ uri: url.thumb_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <View style={styles.ladeHinweisWrap}>
        <LadeHinweisPille
          text={
            moment.type === 'video'
              ? 'Dieses Video lässt sich gerade nicht laden.'
              : 'Dieses Foto lässt sich gerade nicht laden.'
          }
        />
      </View>
    </View>
  );
}

export default function RecapPlayer() {
  const router = useRouter();
  const { id: tripId, start: startParam } = useLocalSearchParams<{ id: string; start?: string }>();
  const reducedMotion = useReducedMotion();
  // Der Player zeigt keinen Header und liegt randlos hinter Insel und
  // Home-Indicator. Die gestalteten 32 aus dem StyleSheet reichten am Geraet
  // nicht: die Fortschrittssegmente lagen unter der Dynamic Island.
  const oberkante = useTopInset(spacing.xl);
  const unterkante = useUnterkante(spacing.xl);
  const { userId } = useAuth();

  const [phase, setPhase] = useState<LadePhase>('laedt');
  // Der Fehler und die Frage, ob ein zweiter Versuch etwas ausrichtet, in
  // EINEM Wert. Sie gehören zusammen: ein Text ohne die Antwort darauf hiesse,
  // «Nochmal versuchen» unter jeden Satz zu stellen, auch unter «Diese Reise
  // ist noch versiegelt.». Getrennt gehalten könnten sie auseinanderlaufen,
  // und der Knopf verspräche wieder etwas, was er nicht hält.
  const [fehler, setFehler] = useState<{ text: string; nochmalHilft: boolean } | null>(null);
  const [startDate, setStartDate] = useState('');
  // Referenzstabil ab dem Moment, in dem laden() sie einmal setzt (Vertrag 1
  // der Vorgänger-Tasks: tagWechselt memoisiert über die ARRAY-REFERENZ,
  // nicht über Inhalt/Länge, diese Liste wird darum NIE inline neu gebaut,
  // sondern genau einmal pro erfolgreichem Laden per setState ersetzt).
  const [spielliste, setSpielliste] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MedienUrl>>(new Map());
  const [gueltigBis, setGueltigBis] = useState(0);
  const [pendingAnzahl, setPendingAnzahl] = useState(0);
  const [ausgelassenAnzahl, setAusgelassenAnzahl] = useState(0);

  const [stand, setStand] = useState<PlayerStand>({ index: 0, pausiert: new Set(), fortschritt: 0 });
  const [fehlgeschlagen, setFehlgeschlagen] = useState<Set<string>>(new Set());

  // Reaktionen (Task 12): `reaktionen` trägt den OPTIMISTISCHEN Zustand, ein
  // Tipp schreibt hier sofort, bevor die Antwort von setzeReaktion/
  // entferneReaktion da ist (siehe tippeEmoji unten).
  const [reaktionen, setReaktionen] = useState<Record<string, Reaktion[]>>({});
  const [reaktionFehler, setReaktionFehler] = useState<string | null>(null);

  // Task 7: «In Galerie sichern» für den GERADE aktiven Moment. Eigener
  // Hinweistext statt Wiederverwendung von `reaktionFehler`, ein Erfolg
  // ("gesichert.") ist kein Fehler, beide sollen aber nach demselben Muster
  // (eine Pille unter der Reaktionsreihe, verschwindet beim Momentwechsel)
  // behandelt werden.
  const [exportLaeuft, setExportLaeuft] = useState(false);
  const [exportHinweis, setExportHinweis] = useState<string | null>(null);

  const [kommentarMomentId, setKommentarMomentId] = useState<string | null>(null);
  const [kommentare, setKommentare] = useState<Kommentar[]>([]);
  const [kommentareLaden, setKommentareLaden] = useState(false);
  const [kommentareFehler, setKommentareFehler] = useState<string | null>(null);
  const [kommentarText, setKommentarText] = useState('');
  const [kommentarSendetLaeuft, setKommentarSendetLaeuft] = useState(false);
  const [kommentarSendenFehler, setKommentarSendenFehler] = useState<string | null>(null);

  // Task 8, Phase 6: «Diesen Moment melden», ausgelöst durch langes Tippen
  // (siehe onLongPress an den Tipp-Zonen unten), gleiches Zustandsmuster wie
  // das Kommentar-Sheet direkt darüber. `meldenBestaetigt` schaltet den
  // Sheet-Inhalt nach einem erfolgreichen Absenden auf die Bestätigung um
  // (Brief: "Danach eine Bestätigung."); der Moment selbst bleibt in JEDEM
  // Fall unverändert sichtbar, Melden entfernt nichts, das übernimmt
  // ausschliesslich die Moderation im Reise-Detail.
  const [meldenMomentId, setMeldenMomentId] = useState<string | null>(null);
  const [meldenGrund, setMeldenGrund] = useState('');
  const [meldenSendetLaeuft, setMeldenSendetLaeuft] = useState(false);
  const [meldenSendenFehler, setMeldenSendenFehler] = useState<string | null>(null);
  const [meldenBestaetigt, setMeldenBestaetigt] = useState(false);

  const aktiv = useRef(true);
  // Wandzeit, zu der das aktuelle Segment (bei fortschritt=0) begonnen hätte,
  // daraus lässt sich beim Berühren (Halten-Geste) exakt zurückrechnen,
  // wie viel von diesem Moment schon "gesehen" wurde, ohne einen zweiten,
  // separat tickenden Zähler zu pflegen (dieselbe Trennung von Optik/Zeitgeber
  // wie Versiegelung.tsx: die Animation läuft für sich, der eigentliche
  // Zeitpunkt kommt aus Date.now()).
  const segmentStartRef = useRef(0);
  const beruehrungStartRef = useRef(0);
  const erneuerungLaeuftRef = useRef(false);
  // Pro Moment höchstens EIN automatischer, unsichtbarer Neuversuch (V10),
  // scheitert der auch, gilt der Moment als endgültig fehlgeschlagen.
  const versuchtRef = useRef<Set<string>>(new Set());
  const aktivIdRef = useRef<string | undefined>(undefined);
  // Phase-5-Final-Review, Punkt 1 (korrigiert): früher zwei separate Refs
  // (`zwischenkarteRef`, `kommentarOffenRef`), weil `stand.pausiert` als
  // einzelnes boolean die drei Gründe (Halten, Zwischenkarte,
  // Kommentar-Sheet) nicht auseinanderhalten konnte, videoZuEnde brauchte
  // zwei EIGENE, parallel geführte Booleans, um "Halten" (soll durchlassen,
  // Vertrag 4) von den anderen beiden (sollen blockieren) zu unterscheiden.
  // Mit PauseGrund als benannter Menge genügt EIN Ref auf das aktuelle
  // `stand.pausiert`, `blockiertAutomatischenVorschub` (playerLogic.ts)
  // kennt den Unterschied selbst.
  const pausiertRef = useRef<ReadonlySet<PauseGrund>>(new Set());
  // Schlüssel `${postId}:${emoji}`, verhindert, dass ein schneller
  // Doppeltipp auf dasselbe Emoji zwei sich widersprechende Anfragen lostritt
  // (Frage aus dem Task-12-Auftrag). Ein Ref statt ein State-Flag: Prüfen und
  // Setzen müssen SYNCHRON im selben Tastendruck passieren, bevor der
  // nächste Tipp überhaupt eintrifft, React committed einen State-Wechsel
  // erst beim nächsten Renderzyklus, ein zweiter, sehr schneller Tipp könnte
  // ihn also noch mit dem alten Wert lesen.
  const pendingReaktionenRef = useRef<Set<string>>(new Set());
  // Für welchen Moment das Kommentar-Sheet zuletzt geöffnet/geladen hat, mit
  // dem State `kommentarMomentId` synchron gehalten, damit eine spät
  // eintreffende Antwort (Sheet inzwischen für einen ANDEREN Moment neu
  // geöffnet) das dann aktuellere Ergebnis nicht überschreibt.
  const kommentarMomentIdRef = useRef<string | null>(null);
  // Gleiches Stale-Guard-Prinzip wie kommentarMomentIdRef, für das
  // Melden-Sheet.
  const meldenMomentIdRef = useRef<string | null>(null);

  const laden = useCallback(async () => {
    setPhase('laedt');
    setFehler(null);
    const [
      { data: trip, error: tFehler },
      { data: momente, error: mFehler },
      { vorrat, error: vFehler, grund: vGrund },
    ] = await Promise.all([fetchTrip(tripId), fetchRecapMomente(tripId), holeVorrat(tripId)]);
    if (!aktiv.current) return;

    // Priorität Reise vor Vorrat vor Momenten, gleiche Reihenfolge wie in
    // uebersicht.tsx: eine kaputte Reise-Abfrage macht die anderen beiden
    // ohnehin bedeutungslos.
    const gemeinsamerFehler = tFehler ?? vFehler ?? mFehler ?? null;
    if (gemeinsamerFehler || !trip) {
      setFehler({
        text: gemeinsamerFehler ?? 'Diese Reise gibt es nicht mehr.',
        // `grund` gehört zum VORRAT und zählt deshalb nur, wenn dessen Fehler
        // auch der angezeigte ist (siehe die Priorität darüber). Steht eine
        // gescheiterte Reise-Abfrage vorn, ist die Lage eine andere, und dort
        // ist Wiederholen genau die richtige Handlung.
        nochmalHilft: tFehler === null && vFehler !== null ? wiederholenHilft(vGrund) : true,
      });
      setPhase('fehler');
      return;
    }

    const urlsMap = vorrat?.urls ?? new Map<string, MedienUrl>();
    const uploaded = momente.filter((m) => m.upload_status === 'uploaded');
    // Dieselbe Filterung wie uebersicht.tsx: nur Momente mit Vorrats-URL
    // gehören in die Filmrolle (Vertrag 2).
    const mitBild = uploaded.filter((m) => urlsMap.has(m.id));

    setStartDate(trip.start_date);
    setUrls(urlsMap);
    setGueltigBis(vorrat?.gueltigBis ?? 0);
    setPendingAnzahl(momente.length - uploaded.length);
    setAusgelassenAnzahl(vorrat?.ausgelassen ?? 0);
    setSpielliste(mitBild);
    // Klein (Review-Fund): ein frisches Laden ist ein frischer Anlauf, ein
    // Moment, der beim VORHERIGEN Anlauf zweimal scheiterte, bekommt sonst
    // nie wieder einen stillen Neuversuch und zeigt dauerhaft die
    // Hinweispille, auch wenn das zugrunde liegende Problem (z.B. eine
    // einzelne kaputte Signatur) längst behoben ist.
    versuchtRef.current.clear();
    setFehlgeschlagen(new Set());

    if (mitBild.length === 0) {
      setPhase('leer');
      return;
    }
    setStand({ index: parseStartIndex(startParam, mitBild.length), pausiert: new Set(), fortschritt: 0 });
    setPhase('bereit');
  }, [tripId, startParam]);

  useEffect(() => {
    aktiv.current = true;
    void laden();
    return () => {
      aktiv.current = false;
    };
  }, [laden]);

  // Medien-Screens stellen die StatusBar lokal um (gleiches Muster wie
  // aufnehmen/index.tsx und preview.tsx).
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [])
  );

  // «Das Licht geht aus»: der inszenierte Fade durch Dunkel beim Betreten
  // des Players (DESIGN-LANGUAGE §5).
  //
  // Review-Fund: `reducedMotion` hängt bewusst in den Deps, obwohl die
  // Inszenierung konzeptionell "einmalig" ist. Grund: `useReducedMotion()`
  // liefert beim allerersten Render IMMER `false` (useState(false)) und löst
  // erst ASYNCHRON auf, sobald `AccessibilityInfo.isReduceMotionEnabled()`
  // zurückkommt (useReducedMotion.ts). Mit `[]`-Deps lief dieser Effekt genau
  // einmal, exakt beim Mount, zu einem Zeitpunkt, an dem `reducedMotion`
  // strukturell IMMER `false` ist, egal was die echte Systemeinstellung
  // sagt. `KINO_FADE_REDUZIERT_MS` war dadurch zur Laufzeit unerreichbar,
  // nur im (den echten Hook synchron mockenden) Test erreichbar. Mit
  // `[reducedMotion]` läuft der Effekt ein zweites Mal, FALLS der Hook nach
  // dem Mount tatsächlich auf `true` auflöst, und startet die Animation dann
  // mit der kürzeren Dauer neu, dasselbe akzeptierte Verhalten wie
  // Versiegelung.tsx/RevealInszenierung.tsx (dort ebenfalls `reducedMotion`
  // in den Deps, siehe deren Fix-Runde-1-Kommentar). Löst der Hook (der
  // Normalfall) auf `false` auf, ändert sich der State-Wert nicht, React
  // rendert nicht neu, der Effekt läuft kein zweites Mal, keine zusätzliche
  // Animation im Normalfall.
  const [kinoFade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.timing(kinoFade, {
      toValue: 0,
      duration: reducedMotion ? KINO_FADE_REDUZIERT_MS : KINO_FADE_DAUER_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const aktivMoment = spielliste[stand.index];
  aktivIdRef.current = aktivMoment?.id;
  // Beide aus `stand.pausiert` abgeleitet (Phase-5-Final-Review, Punkt 1):
  // `zwischenkarte`, zeigt die Tages-Zwischenkarte gerade, `kommentarOffen`,
  // ist das Kommentar-Sheet gerade offen. Kein eigener State mehr (vorher
  // je ein `useState`, das im gleichen Atemzug wie der jeweilige Grund
  // gesetzt/entfernt wurde, zwei Quellen der Wahrheit für dieselbe
  // Information). `gestoppt` ist die für Fortschrittsbalken/VideoMoment
  // verdichtete Frage "läuft gerade IRGENDEIN Grund" (die einzige Stelle,
  // an der die Unterscheidung der Gründe bewusst NICHT mehr interessiert).
  const zwischenkarte = stand.pausiert.has('zwischenkarte');
  const kommentarOffen = stand.pausiert.has('kommentare');
  // Task 8: dasselbe Prinzip, für das Melden-Sheet.
  const meldenOffen = stand.pausiert.has('melden');
  const gestoppt = stand.pausiert.size > 0;
  // Für videoZuEnde unten, direkt in der Render-Zeile aktuell gehalten
  // (gleiches Muster wie aktivIdRef, siehe dort).
  pausiertRef.current = stand.pausiert;
  kommentarMomentIdRef.current = kommentarMomentId;
  meldenMomentIdRef.current = meldenMomentId;

  // Erstes (und einziges) useMemo dieser Codebase (Vertrag 1): `tage` hängt
  // nur an der referenzstabilen `spielliste` + `startDate`, muss also nicht
  // bei jedem Fortschritts-Tick neu berechnet werden, dieselbe
  // Performance-Überlegung wie tagWechselt.
  const tage = useMemo(() => gruppiereNachTagen(spielliste, startDate), [spielliste, startDate]);
  const aktuellerTag = useMemo(() => {
    if (!aktivMoment) return null;
    return tage.find((t) => t.momente.some((m) => m.id === aktivMoment.id)) ?? null;
  }, [tage, aktivMoment]);

  // EIN fetchReaktionen()-Aufruf für die GANZE Spielliste (Brief: nicht pro
  // Moment, bei 200 Momenten der Unterschied zwischen "lädt" und "lädt
  // nicht"), sobald sie feststeht. `spielliste` ist referenzstabil (Vertrag
  // 1 aus Task 11), der Effekt feuert also genau einmal pro erfolgreichem
  // Laden, nicht bei jedem Momentwechsel.
  useEffect(() => {
    if (spielliste.length === 0) return;
    let lebt = true;
    void fetchReaktionen(spielliste.map((m) => m.id)).then(({ data, error }) => {
      if (!lebt || !aktiv.current) return;
      setReaktionen(data);
      // Fix-Runde 1, Klein 4: ein verschluckter Ladefehler liess jeden
      // Moment fälschlich reaktionslos wirken, die eigene, tatsächlich
      // schon bestehende Reaktion zeigte sich nicht als aktiv, UND der
      // erste Tipp darauf wurde dank `ignoreDuplicates` zu einem stillen
      // No-Op (erst der zweite Tipp hätte sie entfernt), ohne dass die
      // Person je erfahren hätte, warum. Dieselbe Pille wie ein
      // fehlgeschlagener Tipp selbst, verschwindet beim nächsten
      // Momentwechsel (siehe Effekt unten).
      if (error) setReaktionFehler(error);
    });
    return () => {
      lebt = false;
    };
  }, [spielliste]);

  // Eine stehengebliebene Fehlermeldung vom vorherigen Moment darf nicht auf
  // dem neuen weiterhängen. Gleiches gilt für den Export-Hinweis (Task 7),
  // ein "gesichert."-Text von Moment A darf nicht unter Moment B weiterstehen.
  // `exportLaeuft` wird HIER ebenfalls zurückgesetzt (nicht nur am Ende von
  // sichereAktuellenMoment): wechselt die Person WÄHREND eines laufenden
  // Exports von Moment A zu Moment B, greift dort die Stale-Guard
  // (aktivIdRef.current !== momentId) und lässt `exportLaeuft` NIE mehr auf
  // false zurückfallen, ohne diesen Reset bliebe der Sichern-Knopf auf dem
  // NEUEN, unbeteiligten Moment B fälschlich im Ladezustand hängen.
  useEffect(() => {
    setReaktionFehler(null);
    setExportHinweis(null);
    setExportLaeuft(false);
  }, [aktivMoment?.id]);

  const eigeneEmojis = useMemo(() => {
    if (!aktivMoment || !userId) return new Set<string>();
    const liste = reaktionen[aktivMoment.id] ?? [];
    return new Set(liste.filter((r) => r.user_id === userId).map((r) => r.emoji));
  }, [reaktionen, aktivMoment, userId]);

  // Nur die EMOJIS anderer Personen, dedupliziert, kein Name, kein Zähler
  // (Brief, Schritt 4).
  const andereEmojis = useMemo(() => {
    if (!aktivMoment) return [];
    const liste = reaktionen[aktivMoment.id] ?? [];
    const menge = new Set<string>();
    for (const r of liste) {
      if (r.user_id !== userId) menge.add(r.emoji);
    }
    return Array.from(menge);
  }, [reaktionen, aktivMoment, userId]);

  // Tippen auf ein Emoji: OPTIMISTISCH setzen/entfernen (Brief, Kernstück
  // dieses Screens), die Reaktion ändert sich sofort im UI, ohne auf die
  // Antwort von setzeReaktion/entferneReaktion zu warten. Scheitert der
  // Aufruf, macht der `.then()`-Zweig unten GENAU die entgegengesetzte
  // Änderung und zeigt die Ursache kurz an. Ein zweiter Tipp auf eine bereits
  // eigene Reaktion ENTFERNT sie (Toggle), die einzige Deutung, die zu
  // "Tippen setzt, Tippen nimmt zurück" ohne einen zweiten Interaktionsweg
  // (z.B. Halten) auskommt; ein PK aus (post_id, user_id, emoji) erlaubt
  // ohnehin nur genau diese zwei Zustände pro Person und Emoji.
  const tippeEmoji = (emoji: string) => {
    const moment = aktivMoment;
    if (!moment || !userId) return;
    const momentId = moment.id;
    const uid = userId;
    const schluessel = `${momentId}:${emoji}`;
    // Doppeltipp-Schutz: eine Anfrage für GENAU dieses Tripel läuft schon.
    // Der zweite (schnelle) Tipp wird bis zur Antwort schlicht ignoriert,
    // statt eine zweite, sich widersprechende Anfrage loszuschicken.
    if (pendingReaktionenRef.current.has(schluessel)) return;
    pendingReaktionenRef.current.add(schluessel);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setReaktionFehler(null);

    const warReagiert = (reaktionen[momentId] ?? []).some((r) => r.emoji === emoji && r.user_id === uid);

    const hinzufuegen = (stand: Record<string, Reaktion[]>) => ({
      ...stand,
      [momentId]: [...(stand[momentId] ?? []), { post_id: momentId, user_id: uid, emoji }],
    });
    const entfernen = (stand: Record<string, Reaktion[]>) => ({
      ...stand,
      [momentId]: (stand[momentId] ?? []).filter((r) => !(r.emoji === emoji && r.user_id === uid)),
    });

    // Rücknahme (Rollback): exakt die entgegengesetzte Änderung der
    // optimistischen oben, die Reaktion verschwindet wieder (bzw. taucht
    // wieder auf). Als benannte Funktion, weil sowohl ein AUFGELÖSTES `{
    // error }` als auch ein tatsächliches `reject()` (Fix-Runde 1, Klein 5)
    // dieselbe Behandlung brauchen.
    const rollback = (nachricht: string) => {
      pendingReaktionenRef.current.delete(schluessel);
      if (!aktiv.current) return;
      setReaktionen(warReagiert ? hinzufuegen : entfernen);
      // Nur anzeigen, wenn noch derselbe Moment aktiv ist, sonst würde ein
      // Fehler zu einem längst verlassenen Moment auf dem FALSCHEN,
      // inzwischen aktiven Moment aufblitzen.
      if (aktivIdRef.current === momentId) setReaktionFehler(nachricht);
    };

    setReaktionen(warReagiert ? entfernen : hinzufuegen);
    const aufruf = warReagiert ? entferneReaktion(momentId, emoji) : setzeReaktion(momentId, emoji);
    void aufruf
      .then(({ error }) => {
        if (error) rollback(error);
        else pendingReaktionenRef.current.delete(schluessel);
      })
      .catch(() => {
        // sozialApi fängt jeden erwarteten Fehlerpfad selbst ab und liefert
        // ihn als `{ error }`, statt zu werfen (siehe dortiger Kommentar),
        // ein tatsächliches reject() hier ist der unerwartete Rest (z.B.
        // eine Laufzeitausnahme in der fetch-Polyfill). Ohne dieses `.catch`
        // (Fix-Runde 1, Klein 5) bliebe `schluessel` für immer in
        // `pendingReaktionenRef` hängen, dieses Emoji auf diesem Moment
        // liesse sich nie wieder antippen, plus eine Unhandled Rejection.
        rollback(
          warReagiert
            ? 'Deine Reaktion konnte nicht entfernt werden. Probier es gleich nochmal.'
            : 'Deine Reaktion konnte nicht gespeichert werden. Probier es gleich nochmal.'
        );
      });
  };

  // Öffnet das Kommentar-Sheet für den GERADE aktiven Moment und hält diesen
  // in einem eigenen State fest (`kommentarMomentId`), statt bei jedem
  // Zugriff `aktivMoment.id` neu zu lesen, schreibeKommentar bekommt so
  // IMMER den Moment, für den das Sheet geöffnet wurde, unabhängig davon, ob
  // währenddessen im Hintergrund der Vorrat erneuert wird (Frage aus dem
  // Auftrag). Der Player pausiert zusätzlich strukturell (unten), solange
  // das Sheet offen ist, der eigene State macht die Zusicherung aber
  // explizit statt sich allein darauf zu verlassen.
  //
  // Fix-Runde 1, bewusste Abweichung vom Brief-Wortlaut ("Wisch nach oben
  // öffnet das Sheet"): dieser Knopf ist der EINZIGE Weg, das Sheet zu
  // öffnen, es gibt keine Wisch-Geste dafür. Der einzige PanResponder des
  // Screens (unten, `panResponder`) erkennt ausschliesslich Abwärtswische
  // zum Schliessen des Players; ihn zusätzlich für Aufwärtswische zu öffnen
  // hätte entweder eine zweite, unabhängige Touch-Fläche gebraucht (Konflikt
  // mit den Tipp-Zonen und der Zwischenkarte) oder eine Fallunterscheidung
  // in `onPanResponderMove` (nur bei Abwärtsbewegung visuell folgen, bei
  // Aufwärtsbewegung nicht). Ohne echten Gerätetest wollte ich diese
  // Kombination nicht ungeprüft einbauen. Der Tipp-Knopf ist deterministisch,
  // hat ein 44×44-Touch-Target (DESIGN-LANGUAGE v2 §8) und ist der einzige
  // Weg, den auch die Tests unten prüfen, siehe Bericht, Abschnitt
  // "Wisch-Geste".
  //
  // Phase-5-Final-Review, Punkt 1: eine frühere Fassung dieses Kommentars
  // begründete die Zurückhaltung bei der Wisch-Geste u.a. damit, dass der
  // Zwischenkarten-Timer `pausiert` "unbedingt auf false zurücksetzt" und
  // ein währenddessen geöffnetes Sheet dadurch lautlos entpausiert würde,
  // GENAU dieser Mechanismus war der tatsächliche, unabhängig von der
  // Wisch-Geste auslösbare Bug (siehe der Effekt bei
  // `ZWISCHENKARTE_DAUER_MS` und `ueberspringen` unten): der Zwischenkarten-
  // Timer nimmt jetzt AUSSCHLIESSLICH den Grund `'zwischenkarte'` zurück,
  // nie `'kommentare'`, ein offenes Sheet bleibt also so oder so
  // pausiert, auch über einen verwaisten Timer hinweg.
  const oeffneKommentare = () => {
    const moment = aktivMoment;
    if (!moment) return;
    const momentId = moment.id;
    // Fix-Runde 2 (Review-Fund): der VORHERIGE Wert, BEVOR er unten
    // überschrieben wird, entscheidet, ob dies ein echter Momentwechsel
    // ist oder ein Wiederöffnen DESSELBEN Moments (siehe
    // `kommentarSendetLaeuft`-Reset weiter unten).
    const vorherigerMomentId = kommentarMomentIdRef.current;
    // EAGER, synchron gesetzt, nicht erst über die Render-Zeile weiter
    // unten (`kommentarMomentIdRef.current = kommentarMomentId`). Löst
    // fetchKommentare unten schneller auf, als React den durch
    // setKommentarMomentId ausgelösten Re-Render committet (z.B. weil die
    // Antwort aus einem Cache kommt oder, wie im eigenen Test, synchron
    // aufgelöst ist), würde der Ref-Vergleich im `.then()` unten sonst noch
    // den ALTEN Wert sehen und die frische Antwort fälschlich verwerfen,
    // das Sheet bliebe dann für immer beim Ladespinner stehen.
    kommentarMomentIdRef.current = momentId;
    setKommentarMomentId(momentId);
    setKommentarText('');
    setKommentarSendenFehler(null);
    // Fix-Runde 1, Wichtig 3, korrigiert in Fix-Runde 2: NUR bei einem
    // echten MOMENTWECHSEL zurücksetzen. Der ursprüngliche Fix (Runde 1)
    // setzte bei JEDEM Öffnen zurück, auch beim Wiederöffnen DESSELBEN
    // Moments, während schreibeKommentar für GENAU DIESEN Moment noch
    // lief: Senden → Sheet schliessen, bevor die Antwort da ist → sofort
    // wieder öffnen (derselbe Moment ist weiterhin aktiv) → der
    // Senden-Knopf wäre wieder aktiv gewesen, OBWOHL die erste Anfrage noch
    // läuft, ein zweiter Tipp hätte einen zweiten, überlappenden Versand
    // ausgelöst. Vor Runde 1 war das nicht möglich (dort wurde nie
    // zurückgesetzt), Runde 1 hat also eine neue Regression eingeführt.
    // Ein Wechsel zu einem ANDEREN Moment ist dagegen eine echte neue
    // Sitzung: die alte, noch laufende Sendung gehört zu einem jetzt
    // irrelevanten Moment, ihre späte Antwort trifft ohnehin auf den
    // Stale-Guard in kommentarAbsenden (kommentarMomentIdRef zeigt dann
    // schon hierher) und würde `setKommentarSendetLaeuft(false)` sonst nie
    // mehr erreichen.
    if (vorherigerMomentId !== momentId) {
      setKommentarSendetLaeuft(false);
    }
    setKommentare([]);
    setKommentareFehler(null);
    setKommentareLaden(true);
    // Der Screen verwaltet `pausiert` selbst (playerLogic fasst es bewusst
    // nicht an), solange das Sheet offen ist, läuft weder Timer noch Video.
    // `kommentarOffen` (Render-Zeile oben) ist AUS `stand.pausiert`
    // abgeleitet, es gibt also nur diesen einen Schreibzugriff, keinen
    // separaten `setKommentarOffen`-Aufruf mehr.
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'kommentare') }));

    void fetchKommentare(momentId).then(({ data, error }) => {
      // Das Sheet wurde inzwischen für einen ANDEREN Moment neu geöffnet
      // (schliessen → weiter → wieder öffnen, während diese Antwort noch
      // unterwegs war), eine späte Antwort für den ALTEN Moment darf den
      // inzwischen frischeren Zustand nicht überschreiben.
      if (!aktiv.current || kommentarMomentIdRef.current !== momentId) return;
      setKommentareLaden(false);
      setKommentare(data);
      setKommentareFehler(error);
    });
  };

  const schliesseKommentare = () => {
    // Nimmt AUSSCHLIESSLICH den eigenen Grund zurück (Phase-5-Final-Review,
    // Punkt 1), bleibt der Player aus einem ANDEREN Grund pausiert (z.B.
    // eine Halten-Geste, die währenddessen begonnen hätte), bleibt er das
    // auch nach dem Schliessen des Sheets.
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'kommentare') }));
  };

  // Task 7: «In Galerie sichern» für den gerade aktiven Moment, exportApi
  // sichert IMMER url.medium_url (volle Auflösung), nie das Thumbnail.
  // Ohne Berechtigung: NIE ein stiller Fehlschlag (Brief, wörtlich), ein
  // Alert erklärt die Ursache und bietet den Weg in die Einstellungen an,
  // statt nur eine kleine Pille zu zeigen, die leicht übersehen wird. Ein
  // sonstiger Fehlschlag (Netzwerk, Galerie-Fehler) bekommt dieselbe kleine
  // Hinweis-Pille wie `reaktionFehler`, sichtbares, aber nicht blockierendes
  // Feedback, passend zur Schwere eines einzelnen fehlgeschlagenen Exports.
  const sichereAktuellenMoment = async () => {
    const moment = aktivMoment;
    if (!moment) return;
    const url = urls.get(moment.id);
    if (!url) return;
    const momentId = moment.id;
    setExportLaeuft(true);
    setExportHinweis(null);
    const ergebnis = await sichereMomentInGalerie(moment, url);
    if (!aktiv.current || aktivIdRef.current !== momentId) return;
    setExportLaeuft(false);
    if (!ergebnis.ok) {
      if (ergebnis.grund === 'keine_berechtigung') {
        Alert.alert('Kein Zugriff auf die Fotobibliothek', ergebnis.text, [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Einstellungen öffnen', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      setExportHinweis(ergebnis.text);
      return;
    }
    setExportHinweis('In der Fotobibliothek gesichert.');
  };

  const kommentarAbsenden = () => {
    const postId = kommentarMomentId;
    if (!postId || kommentarSendetLaeuft) return;
    setKommentarSendetLaeuft(true);
    setKommentarSendenFehler(null);
    void schreibeKommentar(postId, kommentarText).then(({ error }) => {
      if (!aktiv.current || kommentarMomentIdRef.current !== postId) return;
      setKommentarSendetLaeuft(false);
      if (error) {
        setKommentarSendenFehler(error);
        return;
      }
      setKommentarText('');
      // Bewusst NICHT optimistisch (anders als Reaktionen, Brief): ein
      // erneutes fetchKommentare zeigt den serverseitig zugewiesenen
      // Autorennamen/Zeitstempel, ohne dass der Player das Profil der
      // angemeldeten Person selbst kennen müsste.
      setKommentareLaden(true);
      void fetchKommentare(postId).then(({ data, error: ladeFehler }) => {
        if (!aktiv.current || kommentarMomentIdRef.current !== postId) return;
        setKommentareLaden(false);
        setKommentare(data);
        setKommentareFehler(ladeFehler);
      });
    });
  };

  // Task 8, Phase 6: langes Tippen (siehe onLongPress an den Tipp-Zonen
  // unten) ruft dies auf, gleiches Grundmuster wie oeffneKommentare: eigener
  // State pro Moment, plus der strukturelle Pausier-Grund 'melden'. Anders
  // als Kommentare braucht Melden keinen Ladezustand (nichts wird vorab
  // geholt), das Formular startet sofort leer. Bewusst OHNE eigene Haptik
  // (anders als z.B. der Auslöser): DESIGN-LANGUAGE §5 kennt ein festes
  // Vokabular an Anlässen, „Sheet öffnen" gehört nicht dazu, oeffneKommentare
  // (dieselbe Geste-öffnet-Sheet-Handlung) hat aus demselben Grund ebenfalls
  // keine.
  const oeffneMelden = () => {
    const moment = aktivMoment;
    if (!moment) return;
    const momentId = moment.id;
    // Eager wie kommentarMomentIdRef (siehe dortiger Kommentar), ein
    // schnelles erneutes Öffnen darf nicht auf den alten Ref-Wert treffen.
    meldenMomentIdRef.current = momentId;
    setMeldenMomentId(momentId);
    setMeldenGrund('');
    setMeldenSendenFehler(null);
    setMeldenBestaetigt(false);
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'melden') }));
  };

  const schliesseMelden = () => {
    // Nimmt AUSSCHLIESSLICH den eigenen Grund zurück (gleiches Prinzip wie
    // schliesseKommentare), ein aus einem anderen Grund pausierter Player
    // bleibt das auch nach dem Schliessen dieses Sheets.
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'melden') }));
  };

  // Der Moment bleibt in JEDEM Fall unverändert sichtbar (Brief, wörtlich:
  // "Melden ist kein Verstecken"), dieser Aufruf ändert nichts an
  // spielliste/urls, nur den Sheet-Zustand selbst.
  const meldenAbsenden = () => {
    const postId = meldenMomentId;
    if (!postId || meldenSendetLaeuft) return;
    setMeldenSendetLaeuft(true);
    setMeldenSendenFehler(null);
    void meldeMoment(postId, meldenGrund).then(({ error }) => {
      // Stale-Guard: das Sheet kann inzwischen für einen ANDEREN Moment neu
      // geöffnet worden sein (gleiches Prinzip wie kommentarAbsenden).
      if (!aktiv.current || meldenMomentIdRef.current !== postId) return;
      setMeldenSendetLaeuft(false);
      if (error) {
        setMeldenSendenFehler(error);
        return;
      }
      setMeldenBestaetigt(true);
    });
  };

  const pruefeUndErneuereVorratImHintergrund = useCallback(async () => {
    if (erneuerungLaeuftRef.current) return;
    if (!laeuftBaldAb({ urls, gueltigBis, ausgelassen: ausgelassenAnzahl }, Date.now())) return;
    erneuerungLaeuftRef.current = true;
    try {
      const { vorrat } = await holeVorrat(tripId);
      if (vorrat && aktiv.current) {
        setUrls(vorrat.urls);
        setGueltigBis(vorrat.gueltigBis);
      }
    } finally {
      erneuerungLaeuftRef.current = false;
    }
  }, [tripId, urls, gueltigBis, ausgelassenAnzahl]);

  // Programmatisches Weiterschalten (Timer-Ablauf ODER Video-Ende), beide
  // münden hier. Vertrag 4: `weiter()` lässt `pausiert` unangetastet, ein
  // programmatischer Aufruf MUSS `MOMENTWECHSEL_GRUENDE` hier selbst
  // zurücknehmen, sonst bliebe der NÄCHSTE Moment nach einer vorherigen
  // Halten-Geste lautlos stehen (genau der Fall, den
  // `blockiertAutomatischenVorschub` in videoZuEnde unten für `'halten'`
  // bewusst DURCHLÄSST). Final-Review Phase-5-Nachbesserung: `'neuversuch'`
  // gehört ebenfalls hierher, ohne diese Zeile blieb es unentfernbar
  // gesetzt, wenn eine Person während eines laufenden Neuversuchs
  // weitertippte (die Stale-Guard in `beiLadefehler` verhindert dann, dass
  // dessen EIGENE, verspätete Antwort den Grund noch zurücknimmt). `'halten'`
  // ist ohnehin schon leer, wenn `weiterAutomatisch` über `videoZuEnde` oder
  // den Auto-Vorschub-Timer erreicht wird (siehe dort), `ohneGruende` bleibt
  // dafür ein sicheres No-Op. `'zwischenkarte'`/`'kommentare'` bleiben
  // unangetastet, siehe Kommentar bei `MOMENTWECHSEL_GRUENDE`.
  const weiterAutomatisch = useCallback(() => {
    void pruefeUndErneuereVorratImHintergrund();
    const ergebnis = weiter(stand, spielliste.length);
    if (ergebnis === 'ende') {
      setPhase('ende');
      return;
    }
    setStand({ ...ergebnis, pausiert: ohneGruende(ergebnis.pausiert, MOMENTWECHSEL_GRUENDE) });
  }, [stand, spielliste.length, pruefeUndErneuereVorratImHintergrund]);
  // Ref-Indirektion (gleiches Muster wie Versiegelung.tsx/onFertigRef): der
  // Auto-Vorschub-Timer und das Video-Ende-Event rufen IMMER die neueste
  // Fassung auf, ohne dass ihre eigenen Effekte bei jedem Render neu
  // aufgesetzt werden müssten.
  const weiterAutomatischRef = useRef(weiterAutomatisch);
  weiterAutomatischRef.current = weiterAutomatisch;

  // Wichtig 2 (Review-Fund): dieselbe Stale-Guard wie beiLadefehler. Der
  // `playToEnd`-Listener eines VideoMoment ist an dessen `player`-Instanz
  // gebunden (Effekt-Deps `[player]`, siehe dort) und bleibt darum bis zum
  // Unmount an genau DIESEN Moment gekoppelt, trifft das Event aus Native
  // erst ein, NACHDEM der Player bereits auf den nächsten Moment committed
  // hat (aber bevor React die Abmeldung des alten Listeners tatsächlich
  // ausgeführt hat), darf es kein zweites Mal weiterschalten. Der
  // verlässliche Schutz ist NICHT das Effekt-Cleanup (dessen Zeitpunkt
  // relativ zu einem spät eintreffenden Native-Event nicht garantiert ist),
  // sondern dieser explizite Abgleich mit dem tatsächlich aktiven Moment.
  const videoZuEnde = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    // Phase-5-Final-Review, Punkt 1: EIN Guard statt zwei separater Refs
    // (frühere Fassung: `zwischenkarteRef`/`kommentarOffenRef`, siehe
    // Kommentar bei `pausiertRef` oben). `blockiertAutomatischenVorschub`
    // (playerLogic.ts) lässt genau `'halten'` durch (Vertrag 4, ein
    // während einer Halten-Geste eintreffendes `playToEnd` MUSS trotzdem
    // weiterschalten, siehe `weiterAutomatisch`) und blockiert jeden
    // anderen Grund: steht die Zwischenkarte (eigener Zeitgeber,
    // ZWISCHENKARTE_DAUER_MS, ein Event, das trotzdem eintrifft, darf sie
    // nicht überholen), ist das Kommentar-Sheet offen (`oeffneKommentare`
    // setzt den Grund SYNCHRON, aber VideoMoments eigener Pause-Effekt
    // committet erst im NÄCHSTEN Durchlauf, siehe VideoMoment oben, Deps
    // `[pausiert, player]`, trifft `playToEnd` GENAU in diesem schmalen
    // Fenster ein, würde der Player sonst unsichtbar unter dem offenen
    // Sheet weiterlaufen), oder läuft gerade ein stiller Neuversuch nach
    // einem Ladefehler.
    if (blockiertAutomatischenVorschub(pausiertRef.current)) return;
    weiterAutomatischRef.current();
  }, []);

  // Auto-Vorschub: EIN Timer für Fotos UND Videos (dauerFuer liefert für
  // beide eine sinnvolle Dauer, siehe playerLogic.ts), für ein Video ist das
  // zugleich der Rückfall, falls es nie lädt (Netz weg): der Timer schaltet
  // trotzdem nach spätestens dauerFuer(moment) weiter, das echte
  // `playToEnd`-Event (VideoMoment) kommt bei einem normal ladenden Video
  // meist etwas früher und schaltet dann stattdessen weiter, React hebt den
  // hier gesetzten Timer in diesem Fall automatisch per Cleanup auf, sobald
  // `stand.index` sich dadurch ändert (kein doppeltes Weiterschalten).
  useEffect(() => {
    // `stand.pausiert.size > 0` deckt ALLE Gründe ab, inklusive `'halten'`
    // und `'zwischenkarte'` (anders als `blockiertAutomatischenVorschub` in
    // videoZuEnde oben), der reguläre Pro-Moment-Timer ist kein Event, das
    // eine Halten-Geste ausnahmsweise durchlassen müsste, er darf während
    // JEDES Grundes schlicht nicht laufen.
    if (phase !== 'bereit' || stand.pausiert.size > 0) return;
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const rest = Math.max(0, dauer - stand.fortschritt);
    segmentStartRef.current = Date.now() - stand.fortschritt;
    const timer = setTimeout(() => weiterAutomatischRef.current(), rest);
    return () => clearTimeout(timer);
  }, [phase, stand.pausiert, stand.index, stand.fortschritt, spielliste]);

  // Tages-Zwischenkarte: erscheint VOR dem ersten Moment eines neuen Tages
  // (tagWechselt aus Task 7) und steht 1,5 s, bevor sie selbst weiterschaltet.
  //
  // Phase-5-Final-Review, Punkt 1: dieser Effekt hat die Deps `[phase,
  // spielliste, startDate, stand.index]`, `ueberspringen()` (Tipp auf die
  // Karte) ändert KEINE davon, Cleanup/Neulauf bleiben also aus, wenn die
  // Karte per Tipp übersprungen wird. Der hier gesetzte Timer bleibt in dem
  // Fall bis zu seinem regulären Ablauf verwaist stehen und feuert dann
  // trotzdem noch, das ist bewusst hingenommen, nicht wegdesignt (ein
  // zusätzlicher Ref/State allein für "wurde diese Karte schon
  // übersprungen" wäre mehr Zustand für denselben Fall). Was den früheren
  // Bug ausmachte, war NICHT der verwaiste Timer selbst, sondern dass sein
  // Rumpf `pausiert` BEDINGUNGSLOS zurücksetzte, statt nur den eigenen
  // Grund: `ohneGrund(..., 'zwischenkarte')` ist bei einer bereits (per
  // Tipp) entfernten Zwischenkarte ein sicheres No-Op (siehe playerLogic.ts),
  // ein inzwischen aus einem GANZ ANDEREN Grund (z.B. offenes
  // Kommentar-Sheet) pausierter Player bleibt davon unberührt.
  useEffect(() => {
    if (phase !== 'bereit') return;
    if (!tagWechselt(spielliste, startDate, stand.index)) {
      // Kleinigkeit (Final-Review-Nachbesserung): dieser Zweig läuft bei
      // JEDEM Indexwechsel, der KEIN Tageswechsel ist, der ganz normale
      // Regelfall. `ohneGrund` selbst ist zwar No-Op-sicher (liefert
      // dieselbe Set-Referenz), aber `setStand` bekäme trotzdem bei JEDEM
      // Aufruf ein NEUES `stand`-Objekt (`{...s, pausiert: sameRef}`) und
      // löste damit immer einen Render aus, selbst wenn 'zwischenkarte'
      // ohnehin schon fehlt. Der explizite `.has()`-Check davor lässt
      // `setStand` in diesem, häufigsten, Fall ganz aus, React bailt dann
      // vollständig aus (dieselbe `s`-Referenz zurückgegeben).
      setStand((s) => (s.pausiert.has('zwischenkarte') ? { ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') } : s));
      return;
    }
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'zwischenkarte') }));
    const timer = setTimeout(() => {
      setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') }));
    }, ZWISCHENKARTE_DAUER_MS);
    return () => clearTimeout(timer);
  }, [phase, spielliste, startDate, stand.index]);

  // Vorladen der nächsten drei FOTOS (V8), Videos werden nicht vorgeladen,
  // das verlangt der Brief nicht und expo-video puffert selbst beim Mounten.
  useEffect(() => {
    if (phase !== 'bereit') return;
    const kommendeUrls = spielliste
      .slice(stand.index + 1, stand.index + 1 + VORLADEN_ANZAHL)
      .filter((m) => m.type === 'photo')
      .map((m) => urls.get(m.id)?.medium_url)
      .filter((u): u is string => !!u);
    if (kommendeUrls.length > 0) void Image.prefetch(kommendeUrls);
  }, [phase, stand.index, spielliste, urls]);

  // Ein Tipp UNTERSPRINGT die Zwischenkarte, schaltet aber NICHT gleichzeitig
  // zum nächsten Moment weiter (das war die Frage aus dem Auftrag): die Karte
  // ist die einzige `Pressable` an dieser Stelle des Bildschirms, sie wird
  // (siehe JSX unten) ALS LETZTES gerendert und liegt damit strukturell über
  // den beiden Tipp-Zonen darunter, ein Touch währenddessen erreicht rein
  // physisch/strukturell nur ihren eigenen onPress-Handler, niemals auch den
  // der Tipp-Zonen. Es ist also kein Flag-Check, der das verhindert, sondern
  // die Render-Reihenfolge selbst.
  const ueberspringen = () => {
    // Nimmt AUSSCHLIESSLICH den eigenen Grund zurück (Phase-5-Final-Review,
    // Punkt 1), siehe der lange Kommentar beim Zwischenkarten-Effekt oben.
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') }));
  };

  const beiLadefehler = useCallback(
    (postId: string) => {
      // Ein verspätetes Fehler-Event eines längst verlassenen Moments darf
      // den (inzwischen anderen) aktiven Moment nicht pausieren.
      if (aktivIdRef.current !== postId) return;
      if (versuchtRef.current.has(postId)) {
        setFehlgeschlagen((s) => new Set(s).add(postId));
        return;
      }
      versuchtRef.current.add(postId);
      // Der einmalige, unsichtbare Neuversuch (V10): den Player anhalten,
      // während im Hintergrund neu signiert wird, "das darf man nicht
      // sehen" heisst hier: kein Fehlertext, nur ein kurzes, stilles Warten.
      setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'neuversuch') }));
      void (async () => {
        const { vorrat } = await holeVorrat(tripId);
        if (aktiv.current && vorrat) {
          setUrls(vorrat.urls);
          setGueltigBis(vorrat.gueltigBis);
        }
        // Nimmt AUSSCHLIESSLICH den eigenen Grund zurück (Phase-5-Final-
        // Review, Punkt 1). Zusätzliche Stale-Guard (gleiches Prinzip wie
        // videoZuEnde/Wichtig 2): der Player kann inzwischen längst zu einem
        // ANDEREN Moment weitergeschaltet haben (Tipp, Auto-Vorschub),
        // dessen eigenen, unabhängig gesetzten Pausier-Zustand (z.B. ein
        // neues Halten) darf diese verspätete Antwort nicht überschreiben.
        //
        // Final-Review Phase-5-Nachbesserung: GENAU diese Stale-Guard machte
        // 'neuversuch' unentfernbar, wenn währenddessen weitergetippt wurde,
        // die Bedingung schlägt dann für immer fehl, und keine andere
        // Stelle nahm bis zu dieser Korrektur je 'neuversuch' zurück. Der
        // Ausweg liegt bewusst NICHT hier (ein bedingungsloses Zurücknehmen
        // hätte bei mehreren gleichzeitig scheiternden Momenten den GRUND
        // eines fremden, noch laufenden Neuversuchs mitreissen können,
        // 'neuversuch' ist EIN Set-Eintrag ohne Bezug zu einem bestimmten
        // Moment, mehrere Momente können ihn sich "teilen"), sondern in
        // MOMENTWECHSEL_GRUENDE: jeder TATSÄCHLICHE Indexwechsel
        // (beendeBeruehrung/weiterAutomatisch) nimmt 'neuversuch' selbst
        // zurück, bevor diese verspätete Antwort überhaupt eintrifft.
        if (aktiv.current && aktivIdRef.current === postId) {
          setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'neuversuch') }));
        }
      })();
    },
    [tripId]
  );

  const onPressIn = () => {
    // Neue Berührung, ein evtl. von der VORHERIGEN Berührung übernommener
    // Wisch darf diese hier nicht mehr betreffen.
    wischUebernommenRef.current = false;
    beruehrungStartRef.current = Date.now();
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const vergangen = Math.min(dauer, Math.max(0, Date.now() - segmentStartRef.current));
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'halten'), fortschritt: vergangen }));
  };

  const beendeBeruehrung = (seite: 'links' | 'rechts') => {
    // Klein (Review-Fund): RN-Pressability feuert onPressOut auf einer
    // Tipp-Zone AUCH DANN, wenn der PanResponder den Touch währenddessen per
    // Responder-Terminierung übernommen hat (Beginn eines echten Wischs),
    // das ist kein echtes Loslassen. Ohne diese Sperre navigierte JEDER
    // Wisch nach unten zusätzlich, und ein erfolgreicher Schliess-Wisch riefe
    // schliessen() UND weiter()/zurueck() gleichzeitig.
    if (wischUebernommenRef.current) return;
    const gehalten = Date.now() - beruehrungStartRef.current;
    if (gehalten < TAP_SCHWELLE_MS) {
      if (seite === 'rechts') {
        void pruefeUndErneuereVorratImHintergrund();
        const ergebnis = weiter(stand, spielliste.length);
        if (ergebnis === 'ende') {
          setPhase('ende');
          return;
        }
        // Ein echter Indexwechsel per Tipp: nimmt `MOMENTWECHSEL_GRUENDE`
        // zurück, nicht nur `'halten'` (Final-Review Phase-5-Nachbesserung,
        // siehe Kommentar dort, `'neuversuch'` gehört ebenfalls zum
        // VERLASSENEN Moment und darf den neuen nicht blockieren).
        setStand({ ...ergebnis, pausiert: ohneGruende(ergebnis.pausiert, MOMENTWECHSEL_GRUENDE) });
        return;
      }
      // Klein (Review-Fund): V10 gilt in BEIDE Richtungen ("vor jedem
      // Weiter" schliesst ein zurueck() nicht aus, auch dabei bleibt der
      // Player sichtbar auf demselben Vorrat angewiesen).
      void pruefeUndErneuereVorratImHintergrund();
      const ergebnisZurueck = zurueck(stand);
      setStand({ ...ergebnisZurueck, pausiert: ohneGruende(ergebnisZurueck.pausiert, MOMENTWECHSEL_GRUENDE) });
      return;
    }
    // Halten, dann losgelassen: "und weiter beim Loslassen" (Brief) heisst
    // hier fortsetzen, NICHT zum nächsten Moment springen.
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'halten') }));
  };

  const schliessen = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  const [pan] = useState(() => new Animated.ValueXY());
  // Klein (Review-Fund): true, sobald der PanResponder den Touch tatsächlich
  // übernommen hat (onPanResponderGrant feuert nur bei echter Übernahme,
  // anders als das bloss ANFRAGENDE onMoveShouldSetPanResponderCapture),
  // beendeBeruehrung() liest das, um ein von RN-Pressability trotzdem
  // ausgelöstes onPressOut als das zu erkennen, was es ist: kein Loslassen,
  // sondern der Beginn eines Wischs.
  const wischUebernommenRef = useRef(false);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        wischUebernommenRef.current = true;
      },
      onPanResponderMove: Animated.event([null, { dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > SCHLIESSEN_SCHWELLE_PX) {
          schliessen();
          return;
        }
        Animated.spring(pan.y, { toValue: 0, useNativeDriver: false, ...motion.spring }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan.y, { toValue: 0, useNativeDriver: false, ...motion.spring }).start();
      },
    })
  ).current;

  if (phase === 'laedt') {
    return (
      <View testID="player-laedt" style={styles.screen}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  if (phase === 'fehler') {
    return (
      <View testID="player-fehler" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>{fehler?.text}</Text>
        <View style={{ marginTop: spacing.xl, gap: spacing.base, alignItems: 'center' }}>
          {/* Nur wo ein zweiter Versuch etwas ausrichten kann
              (features/recap/urlVorrat.ts). Unter «Diese Reise ist noch
              versiegelt.» stand der Knopf bis hierher ebenfalls, und drücken
              konnte man ihn beliebig oft. Der Rückweg darunter bleibt in
              jedem Fall, er ist dann die einzige Handlung, die es gibt. */}
          {fehler?.nochmalHilft && (
            <KinoButton label="Nochmal versuchen" onPress={() => void laden()} />
          )}
          <TextLink label="Zurück zur Übersicht" onPress={schliessen} />
        </View>
      </View>
    );
  }

  if (phase === 'leer') {
    return (
      <View testID="player-leer" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>Diese Reise ist leer geblieben.</Text>
        <View style={{ marginTop: spacing.xl }}>
          <TextLink label="Zurück zur Übersicht" onPress={schliessen} />
        </View>
      </View>
    );
  }

  if (phase === 'ende') {
    return (
      <View testID="player-ende" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>Das war der Recap.</Text>
        {(pendingAnzahl > 0 || ausgelassenAnzahl > 0) && (
          <View style={{ marginTop: spacing.base, gap: spacing.xs, alignItems: 'center' }}>
            {pendingAnzahl > 0 && (
              <Text style={[type.secondary, styles.zentrierterTextSekundaer]}>{unterwegsText(pendingAnzahl)}</Text>
            )}
            {ausgelassenAnzahl > 0 && (
              <Text style={[type.secondary, styles.zentrierterTextSekundaer]}>{ausgelassenText(ausgelassenAnzahl)}</Text>
            )}
          </View>
        )}
        <View style={{ marginTop: spacing.xl }}>
          <KinoButton label="Zurück zur Übersicht" onPress={schliessen} />
        </View>
      </View>
    );
  }

  // phase === 'bereit', aktivMoment ist damit garantiert gesetzt (die Liste
  // ist an dieser Stelle nie leer, siehe laden()).
  if (!aktivMoment) return null;
  const url = urls.get(aktivMoment.id);
  const ortZeitText = aktivMoment.place_name
    ? `${aktivMoment.place_name} · ${zeitInZone(aktivMoment.captured_at, aktivMoment.captured_tz)}`
    : zeitInZone(aktivMoment.captured_at, aktivMoment.captured_tz);

  return (
    <View testID="player-bereit" style={styles.screen}>
      <Animated.View style={[styles.inhalt, { transform: pan.getTranslateTransform() }]} {...panResponder.panHandlers}>
        <MomentAnzeige
          key={aktivMoment.id}
          moment={aktivMoment}
          url={url}
          fehlgeschlagen={fehlgeschlagen.has(aktivMoment.id)}
          // Wichtig 1 (Review-Fund): auch die Zwischenkarte muss das Video
          // wirklich pausieren, sie ist vollflächig-opak, ohne diese
          // Verknüpfung liefe ein Video darunter unbeirrt weiter (Bild UND
          // Ton) und könnte sogar unter der Karte zu Ende laufen, sodass der
          // Moment, den die Karte gerade ankündigt, nie gezeigt würde.
          // `gestoppt` = irgendein Grund aus `stand.pausiert` ist gesetzt
          // (Halten, Kommentar-Sheet, Zwischenkarte oder Neuversuch), an
          // DIESER Stelle interessiert bewusst nur "läuft/läuft nicht", nicht
          // welcher Grund es ist (siehe Render-Zeile oben).
          pausiert={gestoppt}
          onVideoEnde={() => videoZuEnde(aktivMoment.id)}
          onFehler={() => beiLadefehler(aktivMoment.id)}
        />

        <View
          testID="player-kopf-bereich"
          style={[styles.kopfBereich, { top: oberkante }]}
          pointerEvents="box-none"
        >
          <Fortschrittsbalken
            anzahl={spielliste.length}
            aktivIndex={stand.index}
            dauerMs={dauerFuer(aktivMoment)}
            vergangenMs={stand.fortschritt}
            pausiert={gestoppt}
          />
          <View style={styles.kopfReihe}>
            <Pille style={styles.namePille}>
              {/* 32 statt Avatars Default 36: unteres Ende der DESIGN-LANGUAGE-§4-Spanne
                  (32–44 px), passend zur kompakten Kopf-Pille — dieselbe Grösse, die
                  die gelöschte lokale AvatarInitiale-Kopie vor Task 9 hier trug. */}
              <Avatar name={aktivMoment.autor_name} avatarKey={aktivMoment.autor_avatar_key} kino size={32} />
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{aktivMoment.autor_name}</Text>
            </Pille>
            <Pille style={styles.infoPille}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
            </Pille>
          </View>
        </View>

        <View
          testID="player-sozial-bereich"
          style={[styles.sozialBereich, { bottom: unterkante }]}
          pointerEvents="box-none"
        >
          {aktivMoment.caption && (
            <Pille testID="player-caption" style={styles.captionPille} pointerEvents="none">
              <Text style={[type.body, { color: cinema['text-1'] }]}>{aktivMoment.caption}</Text>
            </Pille>
          )}
          <AndereReaktionenPille emojis={andereEmojis} />
          <View style={styles.reaktionsReihe}>
            {EMOJI_LEISTE.map((r) => (
              <EmojiPille
                key={r.id}
                id={r.id}
                emoji={r.emoji}
                label={r.label}
                aktiv={eigeneEmojis.has(r.emoji)}
                onPress={() => tippeEmoji(r.emoji)}
              />
            ))}
            <PressScale
              testID="player-kommentare-oeffnen"
              accessibilityRole="button"
              accessibilityLabel="Kommentare öffnen"
              onPress={oeffneKommentare}
            >
              <Pille style={styles.kommentarKnopf}>
                <MessageCircle size={20} color={cinema['text-1']} strokeWidth={1.75} />
              </Pille>
            </PressScale>
            {/* Nur sichtbar, wenn es für DIESEN Moment überhaupt eine URL
                gibt (siehe MomentAnzeige), ein Moment, der gerade nicht
                lädt, hat nichts, das sich sichern liesse. */}
            {url && (
              <PressScale
                testID="player-sichern"
                accessibilityRole="button"
                accessibilityLabel="In Galerie sichern"
                accessibilityState={{ disabled: exportLaeuft }}
                onPress={() => {
                  if (!exportLaeuft) void sichereAktuellenMoment();
                }}
              >
                <Pille style={styles.kommentarKnopf}>
                  {exportLaeuft ? (
                    <ActivityIndicator testID="player-sichern-laedt" color={cinema['text-1']} size="small" />
                  ) : (
                    <Download size={20} color={cinema['text-1']} strokeWidth={1.75} />
                  )}
                </Pille>
              </PressScale>
            )}
          </View>
          {reaktionFehler && (
            <Pille style={styles.reaktionFehlerPille}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{reaktionFehler}</Text>
            </Pille>
          )}
          {exportHinweis && (
            <Pille testID="player-export-hinweis" style={styles.reaktionFehlerPille}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{exportHinweis}</Text>
            </Pille>
          )}
        </View>

        {/* Task 8, Phase 6: `onLongPress`/`delayLongPress` hängen auf GENAU
            derselben Pressable wie die bestehende Tipp-Navigation, kein
            zusätzlicher, potenziell verdeckter Bedienbereich (der
            zIndex-Bug aus Phase 5 entstand durch eine ZWEITE, konkurrierende
            Fläche; hier gibt es keine zweite Fläche, nur einen zweiten
            Event-Handler auf der bereits nachweislich obersten/erreichbaren
           , siehe die zIndex-Tests unten). RN-Pressability liefert
            onPressIn/onPressOut/onLongPress nebeneinander, ohne dass sie
            sich gegenseitig unterdrücken: onPressIn pausiert weiterhin
            SOFORT bei Berührungsbeginn (Halten = Pause, unverändert), erst
            NACH LANGES_TIPPEN_MS kommt zusätzlich das Melden-Sheet dazu.
            Löst die Berührung sich vorher (Tipp oder normales Halten unter
            500 ms), feuert onLongPress nie, beendeBeruehrung entscheidet
            wie bisher allein über die Haltedauer. */}
        <Pressable
          testID="player-links"
          accessibilityRole="button"
          accessibilityLabel="Zurück zum vorherigen Moment"
          style={styles.tapZoneLinks}
          onPressIn={onPressIn}
          onPressOut={() => beendeBeruehrung('links')}
          onLongPress={oeffneMelden}
          delayLongPress={LANGES_TIPPEN_MS}
        />
        <Pressable
          testID="player-rechts"
          accessibilityRole="button"
          accessibilityLabel="Weiter zum nächsten Moment"
          style={styles.tapZoneRechts}
          onPressIn={onPressIn}
          onPressOut={() => beendeBeruehrung('rechts')}
          onLongPress={oeffneMelden}
          delayLongPress={LANGES_TIPPEN_MS}
        />

        <PressScale
          testID="player-schliessen"
          accessibilityRole="button"
          accessibilityLabel="Schliessen"
          onPress={schliessen}
          style={[styles.schliessenWrap, { top: oberkante }]}
        >
          <Pille style={styles.schliessenPille}>
            <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pille>
        </PressScale>

        {zwischenkarte && (
          <Pressable testID="player-zwischenkarte" style={styles.zwischenkarte} onPress={ueberspringen}>
            <Text style={[type.h1, styles.zentrierterText]}>
              {aktuellerTag ? tagesueberschrift(aktuellerTag) : 'Ein neuer Tag beginnt.'}
            </Text>
          </Pressable>
        )}
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.kinoFade, { opacity: kinoFade }]}
      />

      {/* GESCHWISTER des Animated.View mit den Pan-Handlern, nicht sein Kind
          (gleiches Muster wie reise/[id]/index.tsx), das Sheet muss über
          allem liegen, inklusive der Tipp-Zonen. */}
      <Sheet sichtbar={kommentarOffen} titel="Kommentare" onSchliessen={schliesseKommentare} kino>
        {kommentareLaden ? (
          <ActivityIndicator testID="kommentare-laedt" color={cinema['text-1']} />
        ) : kommentareFehler ? (
          <Text style={[type.secondary, { color: cinema['text-2'] }]}>{kommentareFehler}</Text>
        ) : kommentare.length === 0 ? (
          <Text style={[type.secondary, { color: cinema['text-2'] }]}>
            Noch keine Kommentare. Schreib den ersten.
          </Text>
        ) : (
          <ScrollView testID="kommentar-liste" style={styles.kommentarListe}>
            {kommentare.map((k) => (
              <KommentarZeile key={k.id} kommentar={k} />
            ))}
          </ScrollView>
        )}
        <View style={styles.kommentarEingabeReihe}>
          <View style={{ flex: 1 }}>
            <Input
              testID="kommentar-eingabe"
              label="Kommentar schreiben"
              value={kommentarText}
              onChangeText={setKommentarText}
              error={kommentarSendenFehler ?? undefined}
              maxLength={KOMMENTAR_MAX_LAENGE}
              // Phase-5-Final-Review, Punkt 4: ohne diesen Schalter zieht
              // `Input` über `useTheme()` zwingend die Licht-Palette (siehe
              // dort), eine weisse Box mitten im Kinosaal.
              kino
            />
          </View>
          <PressScale
            testID="kommentar-senden"
            accessibilityRole="button"
            accessibilityLabel="Kommentar senden"
            disabled={kommentarSendetLaeuft || kommentarText.trim().length === 0}
            accessibilityState={{ disabled: kommentarSendetLaeuft || kommentarText.trim().length === 0 }}
            onPress={() => {
              if (kommentarText.trim().length === 0 || kommentarSendetLaeuft) return;
              kommentarAbsenden();
            }}
          >
            <View style={styles.kommentarSendenKnopf}>
              {kommentarSendetLaeuft ? (
                <ActivityIndicator color={palette['on-accent']} size="small" />
              ) : (
                <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Senden</Text>
              )}
            </View>
          </PressScale>
        </View>
      </Sheet>

      {/* Task 8, Phase 6: gleiches GESCHWISTER-Prinzip wie das Kommentar-
          Sheet direkt darüber, über allem, inklusive der Tipp-Zonen. */}
      <Sheet sichtbar={meldenOffen} titel="Diesen Moment melden" onSchliessen={schliesseMelden} kino>
        {meldenBestaetigt ? (
          <View style={{ gap: spacing.base }}>
            <Text testID="melden-bestaetigung" style={[type.body, { color: cinema['text-1'] }]}>
              Danke. Die Person, die diese Reise angelegt hat, sieht deine Meldung.
            </Text>
            <KinoButton label="Schliessen" onPress={schliesseMelden} />
          </View>
        ) : (
          <View style={{ gap: spacing.base }}>
            {/* Brief, wörtlich: "Der Moment bleibt sichtbar, Melden ist
                kein Verstecken." Steht hier, BEVOR jemand abschickt, nicht
                erst danach. */}
            <Text style={[type.secondary, { color: cinema['text-2'] }]}>
              Der Moment bleibt für alle sichtbar. Die Person, die diese Reise angelegt hat,
              entscheidet, was als Nächstes passiert.
            </Text>
            <Input
              testID="melden-grund"
              label="Was stimmt nicht?"
              value={meldenGrund}
              onChangeText={setMeldenGrund}
              error={meldenSendenFehler ?? undefined}
              maxLength={MELDEN_MAX_LAENGE}
              // Gleicher Grund wie beim Kommentar-Eingabefeld oben.
              kino
            />
            <PressScale
              testID="melden-senden"
              accessibilityRole="button"
              accessibilityLabel="Meldung senden"
              disabled={meldenSendetLaeuft || meldenGrund.trim().length === 0}
              accessibilityState={{ disabled: meldenSendetLaeuft || meldenGrund.trim().length === 0 }}
              onPress={() => {
                if (meldenGrund.trim().length === 0 || meldenSendetLaeuft) return;
                meldenAbsenden();
              }}
            >
              <View style={styles.kommentarSendenKnopf}>
                {meldenSendetLaeuft ? (
                  <ActivityIndicator color={palette['on-accent']} size="small" />
                ) : (
                  <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Melden</Text>
                )}
              </View>
            </PressScale>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  inhalt: { flex: 1 },
  mitte: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen },
  zentrierterText: { color: cinema['text-1'], textAlign: 'center' },
  zentrierterTextSekundaer: { color: cinema['text-2'], textAlign: 'center' },
  kinoFade: { backgroundColor: cinema['bg-0'] },
  kinoButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  textLink: { color: cinema['text-1'], textDecorationLine: 'underline' },
  kopfBereich: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.screen,
    right: spacing.screen,
    gap: spacing.base,
  },
  kopfReihe: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.s },
  namePille: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  infoPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  // Kein `position:absolute` mehr (anders als vor Task 12): die Pille ist
  // jetzt ein normales Flow-Kind von `sozialBereich`, das seinerseits
  // GENAU EINMAL vom unteren Rand aus positioniert ist, Caption,
  // "Reaktionen anderer" und die Emoji-Leiste stapeln sich darin per `gap`,
  // ohne sich je zu überlappen, unabhängig davon, wie viele Zeilen die
  // Caption braucht.
  captionPille: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.control,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // M5/Klein (Review-Fund): die Stapel-Reihenfolge hing bisher allein an der
  // Render-Reihenfolge im JSX ("später gerendert = oben"), fragil, weil sie
  // sich unbemerkt umkehren liess (ein RNTL-`fireEvent.press` prüft keine
  // Geometrie/Stapelung, jede Verschiebung im Baum blieb also unbemerkt
  // grün). Jetzt ein expliziter, von der Reihenfolge unabhängiger zIndex:
  // Tipp-Zonen unten, die Zwischenkarte darüber (blockiert sie strukturell),
  // die Schliessen-Pille ganz oben (bleibt auch WÄHREND der Karte bedienbar,
  // sonst liesse sich der Player während der 1,5 s der Karte nicht
  // verlassen).
  tapZoneLinks: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', zIndex: 1 },
  tapZoneRechts: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', zIndex: 1 },
  schliessenWrap: { position: 'absolute', top: spacing.xl, right: spacing.screen, zIndex: 3 },
  schliessenPille: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ladeHinweisWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.xxl },
  ladeHinweisPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  zwischenkarte: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: cinema['bg-0'],
    zIndex: 2,
  },
  // Fix-Runde 1, Blocker 1: ohne zIndex lag dieser Bereich UNTER den
  // Tipp-Zonen (zIndex 1, siehe tapZoneLinks/tapZoneRechts unten), jeder
  // Tipp auf ein Emoji oder den Kommentar-Knopf traf physisch player-links/
  // -rechts und blätterte nur weiter, statt zu reagieren bzw. das Sheet zu
  // öffnen. zIndex 2 hebt ihn über die Tipp-Zonen; bleibt unter der
  // Zwischenkarte (ebenfalls zIndex 2, aber SPÄTER im Baum, bei gleichem
  // zIndex gewinnt in React Native das später gerenderte Geschwister,
  // gleiches Prinzip wie beim tapZoneLinks/-Rechts-Kommentar unten), die
  // Karte deckt die Leiste also weiterhin vollständig ab, während sie steht.
  //
  // Fix-Runde 2 (Review-Korrektur): entgegen einer früheren, FALSCHEN Notiz
  // hier ist das sehr wohl testbar, player.test.tsx prüft `zIndex` direkt
  // über `StyleSheet.flatten(...props.style)` (Muster aus der
  // Task-11-Fixrunde für die Zwischenkarte, siehe dort), nicht über echtes
  // Hit-Testing. Siehe "die Reaktionen/der Kommentar-Knopf liegen per zIndex
  // über den Tipp-Zonen" in player.test.tsx.
  sozialBereich: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    gap: spacing.base,
    zIndex: 2,
  },
  // Fix-Runde 1, Klein 6: sechs 44-px-Pillen + fünf 8-px-Lücken sind 304 px,
  // auf einem 320-pt-Gerät bleiben zwischen den 24-px-Screen-Rändern nur
  // 272 px. `flexWrap` lässt die letzte Pille (den Kommentar-Knopf) in eine
  // zweite Zeile umbrechen, statt über den Rand hinauszulaufen; `gap` gilt
  // in React Native für beide Achsen, auch für die umgebrochene Zeile.
  reaktionsReihe: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.s },
  emojiPille: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiPilleAktiv: { backgroundColor: cinema['text-1'] },
  emojiZeichen: { fontSize: 20 },
  kommentarKnopf: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  andereReaktionenPille: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  reaktionFehlerPille: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  kommentarListe: { maxHeight: 320 },
  kommentarZeile: {
    gap: spacing.xs,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: cinema['bg-0'],
  },
  kommentarEingabeReihe: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.s },
  kommentarSendenKnopf: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: palette.accent,
  },
});
