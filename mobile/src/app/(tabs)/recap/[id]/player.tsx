import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { MessageCircle, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Fortschrittsbalken } from '@/components/Fortschrittsbalken';
import { Sheet } from '@/components/Sheet';
import { Input } from '@/components/Input';
import { cinema, motion, palette, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { Kommentar, Reaktion, RecapMoment, RecapTag } from '@/features/recap/types';
import { holeVorrat, laeuftBaldAb, type MedienUrl } from '@/features/recap/urlVorrat';
import { dauerFuer, tagWechselt, weiter, zurueck, type PlayerStand } from '@/features/recap/playerLogic';
import {
  entferneReaktion,
  fetchKommentare,
  fetchReaktionen,
  KOMMENTAR_MAX_LAENGE,
  schreibeKommentar,
  setzeReaktion,
} from '@/features/recap/sozialApi';

// Die nächsten drei Fotos werden per expo-image vorgeladen (V8) — beim
// Weitertippen darf nichts schwarz blitzen.
const VORLADEN_ANZAHL = 3;
// Tages-Zwischenkarte steht 1,5 Sekunden, dann geht es von selbst weiter
// (Task-11-Brief, Schritt 4).
const ZWISCHENKARTE_DAUER_MS = 1500;
// Unterhalb dieser Haltedauer zählt eine Berührung als "Tipp" (navigiert),
// darüber als "Halten" (pausiert nur und setzt beim Loslassen fort, ohne zu
// navigieren) — Snapchat/Instagram-Story-Konvention, siehe Bericht.
const TAP_SCHWELLE_MS = 250;
// Wisch nach unten weiter als diese Schwelle schliesst den Player.
const SCHLIESSEN_SCHWELLE_PX = 120;
// DESIGN-LANGUAGE §5: „hell → Kino = Fade durch Dunkel 350 ms" — der
// inszenierte Übergang beim Betreten des Players ("das Licht geht aus").
const KINO_FADE_DAUER_MS = 350;
const KINO_FADE_REDUZIERT_MS = 200;

// Feste kleine Emoji-Leiste (Task-12-Brief: kein Picker, kein neues Paket).
// `id` ist der stabile Schlüssel für testID/React-key (ein Emoji-Glyph kann
// aus mehreren Codepoints bestehen, z.B. Herz + Variationsselektor — als
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
// erfinden") — hier bewusst als eigene, kleine Kopie statt eines Imports:
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
// (Task-11-Brief, Schritt 3) — anders als preview.tsx (dort ist Moment- und
// Gerätezeit dieselbe, weil dort live aufgenommen wird) braucht das hier
// zwingend Intl.DateTimeFormat mit `timeZone`, es gibt dafür keinen
// Intl-freien Weg. Ein ungültiger/unbekannter Zonenname (siehe tage.ts,
// gleiches Verteidigungsprinzip) wirft dort einen RangeError — lieber eine
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
// AUCH im Vorrat eine URL haben, in der Reihenfolge von fetchRecapMomente —
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

// Medien-Screen (DESIGN-LANGUAGE v2 §1): feste Kino-Palette, kein useTheme()
// — gleiches Muster wie aufnehmen/index.tsx und preview.tsx.
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
// `cinema['text-1']` — derselbe Ton, den `KinoButton` bereits für "solide
// Fläche auf Kino-Hintergrund" benutzt, kein neuer Wert. 44×44: minimales
// Touch-Target (DESIGN-LANGUAGE v2 §8).
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
      <View style={[styles.emojiPille, aktiv && styles.emojiPilleAktiv]}>
        <Text style={styles.emojiZeichen}>{emoji}</Text>
      </View>
    </PressScale>
  );
}

// Reaktionen ANDERER Personen auf den aktiven Moment — dezent, nur die
// Emojis, ohne Namen und ohne Zähler (Task-12-Brief, Schritt 4: "nicht als
// Zählerbalken").
function AndereReaktionenPille({ emojis }: { emojis: string[] }) {
  if (emojis.length === 0) return null;
  return (
    <View
      testID="player-reaktionen-andere"
      style={styles.andereReaktionenPille}
      accessibilityLabel={`Weitere Reaktionen: ${emojis.join(', ')}`}
    >
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{emojis.join(' ')}</Text>
    </View>
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

// Initiale statt echtem Bild (Avatar.tsx macht dasselbe für die helle
// Palette) — hier lokal statt importiert, weil Avatar.tsx über useTheme()
// die HELLE Palette zieht und auf einem Kino-Screen falsch aussähe.
function AvatarInitiale({ name }: { name: string }) {
  return (
    <View style={styles.avatarKreis}>
      <Text style={[type.label, { color: cinema['text-1'] }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

function LadeHinweisPille({ text }: { text: string }) {
  return (
    <View style={styles.ladeHinweisPille}>
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{text}</Text>
    </View>
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

// Videoende erkennen: das `playToEnd`-Event des Players (nicht ein Timer) —
// der uniforme dauerFuer-Timer im Elternteil läuft trotzdem als Rückfall
// weiter (siehe dort) und schaltet notfalls auch bei einem Video weiter, das
// wegen fehlendem Netz nie lädt. `statusChange` mit status==='error' meldet
// genau diesen Ladefehlschlag an den Elternteil (V10: einmal still neu
// versuchen, bevor irgendetwas sichtbar wird).
//
// `pausiert` steuert player.pause()/play() direkt: "Halten = Pause" darf sich
// nicht auf das Einfrieren des Fortschrittsbalkens beschränken — sonst liefe
// Bild UND Ton eines Videos unbeirrt weiter, während die Anzeige stillstünde.
// Genau dieser Fall (gehalten, während das Video währenddessen zu Ende
// liefe) ist auch der Grund, warum `weiterAutomatisch` `pausiert` beim
// Vorschub explizit auf `false` setzt (Vertrag 4): ohne echtes player.pause()
// könnte `playToEnd` sogar während einer Halten-Geste feuern.
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
  // sein Thumbnail plus Hinweis — Weitertippen bleibt möglich (die Tap-Zonen
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
  const { userId } = useAuth();

  const [phase, setPhase] = useState<LadePhase>('laedt');
  const [fehlerText, setFehlerText] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  // Referenzstabil ab dem Moment, in dem laden() sie einmal setzt (Vertrag 1
  // der Vorgänger-Tasks: tagWechselt memoisiert über die ARRAY-REFERENZ,
  // nicht über Inhalt/Länge — diese Liste wird darum NIE inline neu gebaut,
  // sondern genau einmal pro erfolgreichem Laden per setState ersetzt).
  const [spielliste, setSpielliste] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MedienUrl>>(new Map());
  const [gueltigBis, setGueltigBis] = useState(0);
  const [pendingAnzahl, setPendingAnzahl] = useState(0);
  const [ausgelassenAnzahl, setAusgelassenAnzahl] = useState(0);

  const [stand, setStand] = useState<PlayerStand>({ index: 0, pausiert: false, fortschritt: 0 });
  const [zwischenkarte, setZwischenkarte] = useState(false);
  const [fehlgeschlagen, setFehlgeschlagen] = useState<Set<string>>(new Set());

  // Reaktionen (Task 12): `reaktionen` trägt den OPTIMISTISCHEN Zustand — ein
  // Tipp schreibt hier sofort, bevor die Antwort von setzeReaktion/
  // entferneReaktion da ist (siehe tippeEmoji unten).
  const [reaktionen, setReaktionen] = useState<Record<string, Reaktion[]>>({});
  const [reaktionFehler, setReaktionFehler] = useState<string | null>(null);

  const [kommentarOffen, setKommentarOffen] = useState(false);
  const [kommentarMomentId, setKommentarMomentId] = useState<string | null>(null);
  const [kommentare, setKommentare] = useState<Kommentar[]>([]);
  const [kommentareLaden, setKommentareLaden] = useState(false);
  const [kommentareFehler, setKommentareFehler] = useState<string | null>(null);
  const [kommentarText, setKommentarText] = useState('');
  const [kommentarSendetLaeuft, setKommentarSendetLaeuft] = useState(false);
  const [kommentarSendenFehler, setKommentarSendenFehler] = useState<string | null>(null);

  const aktiv = useRef(true);
  // Wandzeit, zu der das aktuelle Segment (bei fortschritt=0) begonnen hätte
  // — daraus lässt sich beim Berühren (Halten-Geste) exakt zurückrechnen,
  // wie viel von diesem Moment schon "gesehen" wurde, ohne einen zweiten,
  // separat tickenden Zähler zu pflegen (dieselbe Trennung von Optik/Zeitgeber
  // wie Versiegelung.tsx: die Animation läuft für sich, der eigentliche
  // Zeitpunkt kommt aus Date.now()).
  const segmentStartRef = useRef(0);
  const beruehrungStartRef = useRef(0);
  const erneuerungLaeuftRef = useRef(false);
  // Pro Moment höchstens EIN automatischer, unsichtbarer Neuversuch (V10) —
  // scheitert der auch, gilt der Moment als endgültig fehlgeschlagen.
  const versuchtRef = useRef<Set<string>>(new Set());
  const aktivIdRef = useRef<string | undefined>(undefined);
  // Für videoZuEnde (Wichtig 1/Zusatz-Verteidigung): ob die Zwischenkarte
  // gerade steht — siehe dort.
  const zwischenkarteRef = useRef(false);
  // Schlüssel `${postId}:${emoji}` — verhindert, dass ein schneller
  // Doppeltipp auf dasselbe Emoji zwei sich widersprechende Anfragen lostritt
  // (Frage aus dem Task-12-Auftrag). Ein Ref statt ein State-Flag: Prüfen und
  // Setzen müssen SYNCHRON im selben Tastendruck passieren, bevor der
  // nächste Tipp überhaupt eintrifft — React committed einen State-Wechsel
  // erst beim nächsten Renderzyklus, ein zweiter, sehr schneller Tipp könnte
  // ihn also noch mit dem alten Wert lesen.
  const pendingReaktionenRef = useRef<Set<string>>(new Set());
  // Für welchen Moment das Kommentar-Sheet zuletzt geöffnet/geladen hat — mit
  // dem State `kommentarMomentId` synchron gehalten, damit eine spät
  // eintreffende Antwort (Sheet inzwischen für einen ANDEREN Moment neu
  // geöffnet) das dann aktuellere Ergebnis nicht überschreibt.
  const kommentarMomentIdRef = useRef<string | null>(null);

  const laden = useCallback(async () => {
    setPhase('laedt');
    setFehlerText(null);
    const [{ data: trip, error: tFehler }, { data: momente, error: mFehler }, { vorrat, error: vFehler }] =
      await Promise.all([fetchTrip(tripId), fetchRecapMomente(tripId), holeVorrat(tripId)]);
    if (!aktiv.current) return;

    // Priorität Reise vor Vorrat vor Momenten — gleiche Reihenfolge wie in
    // uebersicht.tsx: eine kaputte Reise-Abfrage macht die anderen beiden
    // ohnehin bedeutungslos.
    const gemeinsamerFehler = tFehler ?? vFehler ?? mFehler ?? null;
    if (gemeinsamerFehler || !trip) {
      setFehlerText(gemeinsamerFehler ?? 'Diese Reise gibt es nicht mehr.');
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
    // Klein (Review-Fund): ein frisches Laden ist ein frischer Anlauf — ein
    // Moment, der beim VORHERIGEN Anlauf zweimal scheiterte, bekommt sonst
    // nie wieder einen stillen Neuversuch und zeigt dauerhaft die
    // Hinweispille, auch wenn das zugrunde liegende Problem (z.B. eine
    // einzelne kaputte Signatur) längst behoben ist.
    // Klein (Review-Fund): ein frisches Laden ist ein frischer Anlauf — ein
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
    setStand({ index: parseStartIndex(startParam, mitBild.length), pausiert: false, fortschritt: 0 });
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
  // des Players (DESIGN-LANGUAGE §5) — ein einmaliger Einstiegs-Übergang,
  // keine Reaktion auf spätere Zustandswechsel, daher bewusst ohne weitere
  // Abhängigkeiten.
  const kinoFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(kinoFade, {
      toValue: 0,
      duration: reducedMotion ? KINO_FADE_REDUZIERT_MS : KINO_FADE_DAUER_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aktivMoment = spielliste[stand.index];
  aktivIdRef.current = aktivMoment?.id;
  // Für videoZuEnde unten — direkt in der Render-Zeile aktuell gehalten
  // (gleiches Muster wie aktivIdRef, siehe dort).
  zwischenkarteRef.current = zwischenkarte;
  kommentarMomentIdRef.current = kommentarMomentId;

  // Erstes (und einziges) useMemo dieser Codebase (Vertrag 1): `tage` hängt
  // nur an der referenzstabilen `spielliste` + `startDate`, muss also nicht
  // bei jedem Fortschritts-Tick neu berechnet werden — dieselbe
  // Performance-Überlegung wie tagWechselt.
  const tage = useMemo(() => gruppiereNachTagen(spielliste, startDate), [spielliste, startDate]);
  const aktuellerTag = useMemo(() => {
    if (!aktivMoment) return null;
    return tage.find((t) => t.momente.some((m) => m.id === aktivMoment.id)) ?? null;
  }, [tage, aktivMoment]);

  // EIN fetchReaktionen()-Aufruf für die GANZE Spielliste (Brief: nicht pro
  // Moment — bei 200 Momenten der Unterschied zwischen "lädt" und "lädt
  // nicht"), sobald sie feststeht. `spielliste` ist referenzstabil (Vertrag
  // 1 aus Task 11), der Effekt feuert also genau einmal pro erfolgreichem
  // Laden, nicht bei jedem Momentwechsel.
  useEffect(() => {
    if (spielliste.length === 0) return;
    let lebt = true;
    void fetchReaktionen(spielliste.map((m) => m.id)).then(({ data }) => {
      if (lebt && aktiv.current) setReaktionen(data);
    });
    return () => {
      lebt = false;
    };
  }, [spielliste]);

  // Eine stehengebliebene Fehlermeldung vom vorherigen Moment darf nicht auf
  // dem neuen weiterhängen.
  useEffect(() => {
    setReaktionFehler(null);
  }, [aktivMoment?.id]);

  const eigeneEmojis = useMemo(() => {
    if (!aktivMoment || !userId) return new Set<string>();
    const liste = reaktionen[aktivMoment.id] ?? [];
    return new Set(liste.filter((r) => r.user_id === userId).map((r) => r.emoji));
  }, [reaktionen, aktivMoment, userId]);

  // Nur die EMOJIS anderer Personen, dedupliziert — kein Name, kein Zähler
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
  // dieses Screens) — die Reaktion ändert sich sofort im UI, ohne auf die
  // Antwort von setzeReaktion/entferneReaktion zu warten. Scheitert der
  // Aufruf, macht der `.then()`-Zweig unten GENAU die entgegengesetzte
  // Änderung und zeigt die Ursache kurz an. Ein zweiter Tipp auf eine bereits
  // eigene Reaktion ENTFERNT sie (Toggle) — die einzige Deutung, die zu
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

    setReaktionen(warReagiert ? entfernen : hinzufuegen);
    const aufruf = warReagiert ? entferneReaktion(momentId, emoji) : setzeReaktion(momentId, emoji);
    void aufruf.then(({ error }) => {
      pendingReaktionenRef.current.delete(schluessel);
      if (!error || !aktiv.current) return;
      // Rücknahme: exakt die entgegengesetzte Änderung der optimistischen
      // oben — die Reaktion verschwindet wieder (bzw. taucht wieder auf).
      setReaktionen(warReagiert ? hinzufuegen : entfernen);
      // Nur anzeigen, wenn noch derselbe Moment aktiv ist — sonst würde ein
      // Fehler zu einem längst verlassenen Moment auf dem FALSCHEN,
      // inzwischen aktiven Moment aufblitzen.
      if (aktivIdRef.current === momentId) setReaktionFehler(error);
    });
  };

  // Öffnet das Kommentar-Sheet für den GERADE aktiven Moment und hält diesen
  // in einem eigenen State fest (`kommentarMomentId`), statt bei jedem
  // Zugriff `aktivMoment.id` neu zu lesen — schreibeKommentar bekommt so
  // IMMER den Moment, für den das Sheet geöffnet wurde, unabhängig davon, ob
  // währenddessen im Hintergrund der Vorrat erneuert wird (Frage aus dem
  // Auftrag). Der Player pausiert zusätzlich strukturell (unten), solange
  // das Sheet offen ist — der eigene State macht die Zusicherung aber
  // explizit statt sich allein darauf zu verlassen.
  const oeffneKommentare = () => {
    const moment = aktivMoment;
    if (!moment) return;
    const momentId = moment.id;
    // EAGER, synchron gesetzt — nicht erst über die Render-Zeile weiter
    // unten (`kommentarMomentIdRef.current = kommentarMomentId`). Löst
    // fetchKommentare unten schneller auf, als React den durch
    // setKommentarMomentId ausgelösten Re-Render committet (z.B. weil die
    // Antwort aus einem Cache kommt oder — wie im eigenen Test — synchron
    // aufgelöst ist), würde der Ref-Vergleich im `.then()` unten sonst noch
    // den ALTEN Wert sehen und die frische Antwort fälschlich verwerfen —
    // das Sheet bliebe dann für immer beim Ladespinner stehen.
    kommentarMomentIdRef.current = momentId;
    setKommentarMomentId(momentId);
    setKommentarText('');
    setKommentarSendenFehler(null);
    setKommentare([]);
    setKommentareFehler(null);
    setKommentareLaden(true);
    setKommentarOffen(true);
    // Der Screen verwaltet `pausiert` selbst (playerLogic fasst es bewusst
    // nicht an) — solange das Sheet offen ist, läuft weder Timer noch Video.
    setStand((s) => ({ ...s, pausiert: true }));

    void fetchKommentare(momentId).then(({ data, error }) => {
      // Das Sheet wurde inzwischen für einen ANDEREN Moment neu geöffnet
      // (schliessen → weiter → wieder öffnen, während diese Antwort noch
      // unterwegs war) — eine späte Antwort für den ALTEN Moment darf den
      // inzwischen frischeren Zustand nicht überschreiben.
      if (!aktiv.current || kommentarMomentIdRef.current !== momentId) return;
      setKommentareLaden(false);
      setKommentare(data);
      setKommentareFehler(error);
    });
  };

  const schliesseKommentare = () => {
    setKommentarOffen(false);
    // Vertrag 4 (Task 11, playerLogic): ein PROGRAMMATISCHES Zurücksetzen
    // muss `pausiert` explizit auf false setzen — sonst bliebe der Player
    // nach dem Schliessen lautlos stehen, ohne dass irgendetwas noch hält.
    setStand((s) => ({ ...s, pausiert: false }));
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

  // Programmatisches Weiterschalten (Timer-Ablauf ODER Video-Ende) — beide
  // münden hier. Vertrag 4: `weiter()` lässt `pausiert` unangetastet, ein
  // programmatischer Aufruf MUSS es hier selbst auf `false` setzen, sonst
  // bliebe der Player nach einer vorherigen Halten-Geste lautlos stehen.
  const weiterAutomatisch = useCallback(() => {
    void pruefeUndErneuereVorratImHintergrund();
    const ergebnis = weiter(stand, spielliste.length);
    if (ergebnis === 'ende') {
      setPhase('ende');
      return;
    }
    setStand({ ...ergebnis, pausiert: false });
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
  // Unmount an genau DIESEN Moment gekoppelt — trifft das Event aus Native
  // erst ein, NACHDEM der Player bereits auf den nächsten Moment committed
  // hat (aber bevor React die Abmeldung des alten Listeners tatsächlich
  // ausgeführt hat), darf es kein zweites Mal weiterschalten. Der
  // verlässliche Schutz ist NICHT das Effekt-Cleanup (dessen Zeitpunkt
  // relativ zu einem spät eintreffenden Native-Event nicht garantiert ist),
  // sondern dieser explizite Abgleich mit dem tatsächlich aktiven Moment.
  const videoZuEnde = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    // Zusätzliche Verteidigung zum physischen player.pause() (siehe
    // VideoMoment oben): steht die Zwischenkarte, hat sie ihren eigenen
    // Zeitgeber (ZWISCHENKARTE_DAUER_MS) — ein Event, das trotzdem
    // eintrifft (Timing-Lücke zwischen Commit und tatsächlichem Pausieren),
    // darf sie nicht überholen.
    if (zwischenkarteRef.current) return;
    weiterAutomatischRef.current();
  }, []);

  // Auto-Vorschub: EIN Timer für Fotos UND Videos (dauerFuer liefert für
  // beide eine sinnvolle Dauer, siehe playerLogic.ts) — für ein Video ist das
  // zugleich der Rückfall, falls es nie lädt (Netz weg): der Timer schaltet
  // trotzdem nach spätestens dauerFuer(moment) weiter, das echte
  // `playToEnd`-Event (VideoMoment) kommt bei einem normal ladenden Video
  // meist etwas früher und schaltet dann stattdessen weiter — React hebt den
  // hier gesetzten Timer in diesem Fall automatisch per Cleanup auf, sobald
  // `stand.index` sich dadurch ändert (kein doppeltes Weiterschalten).
  useEffect(() => {
    if (phase !== 'bereit' || zwischenkarte || stand.pausiert) return;
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const rest = Math.max(0, dauer - stand.fortschritt);
    segmentStartRef.current = Date.now() - stand.fortschritt;
    const timer = setTimeout(() => weiterAutomatischRef.current(), rest);
    return () => clearTimeout(timer);
  }, [phase, zwischenkarte, stand.pausiert, stand.index, stand.fortschritt, spielliste]);

  // Tages-Zwischenkarte: erscheint VOR dem ersten Moment eines neuen Tages
  // (tagWechselt aus Task 7) und steht 1,5 s, bevor sie selbst weiterschaltet.
  useEffect(() => {
    if (phase !== 'bereit') return;
    if (!tagWechselt(spielliste, startDate, stand.index)) {
      setZwischenkarte(false);
      return;
    }
    setZwischenkarte(true);
    const timer = setTimeout(() => {
      setZwischenkarte(false);
      // Vertrag 4: eine ABGELAUFENE Zwischenkarte ist ein programmatischer
      // Vorschub — pausiert muss explizit zurückgesetzt werden.
      setStand((s) => ({ ...s, pausiert: false }));
    }, ZWISCHENKARTE_DAUER_MS);
    return () => clearTimeout(timer);
  }, [phase, spielliste, startDate, stand.index]);

  // Vorladen der nächsten drei FOTOS (V8) — Videos werden nicht vorgeladen,
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
  // den beiden Tipp-Zonen darunter — ein Touch währenddessen erreicht rein
  // physisch/strukturell nur ihren eigenen onPress-Handler, niemals auch den
  // der Tipp-Zonen. Es ist also kein Flag-Check, der das verhindert, sondern
  // die Render-Reihenfolge selbst.
  const ueberspringen = () => {
    setZwischenkarte(false);
    setStand((s) => ({ ...s, pausiert: false }));
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
      // während im Hintergrund neu signiert wird — "das darf man nicht
      // sehen" heisst hier: kein Fehlertext, nur ein kurzes, stilles Warten.
      setStand((s) => ({ ...s, pausiert: true }));
      void (async () => {
        const { vorrat } = await holeVorrat(tripId);
        if (aktiv.current && vorrat) {
          setUrls(vorrat.urls);
          setGueltigBis(vorrat.gueltigBis);
        }
        // Vertrag 4: programmatische Erneuerung — pausiert muss explizit
        // zurückgesetzt werden. Zusätzliche Stale-Guard (gleiches Prinzip
        // wie videoZuEnde/Wichtig 2): der Player kann inzwischen längst zu
        // einem ANDEREN Moment weitergeschaltet haben (Tipp, Auto-Vorschub)
        // — dessen eigenen, unabhängig gesetzten Pausiert-Zustand (z.B. ein
        // neues Halten) darf diese verspätete Antwort nicht überschreiben.
        if (aktiv.current && aktivIdRef.current === postId) {
          setStand((s) => ({ ...s, pausiert: false }));
        }
      })();
    },
    [tripId]
  );

  const onPressIn = () => {
    // Neue Berührung — ein evtl. von der VORHERIGEN Berührung übernommener
    // Wisch darf diese hier nicht mehr betreffen.
    wischUebernommenRef.current = false;
    beruehrungStartRef.current = Date.now();
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const vergangen = Math.min(dauer, Math.max(0, Date.now() - segmentStartRef.current));
    setStand((s) => ({ ...s, pausiert: true, fortschritt: vergangen }));
  };

  const beendeBeruehrung = (seite: 'links' | 'rechts') => {
    // Klein (Review-Fund): RN-Pressability feuert onPressOut auf einer
    // Tipp-Zone AUCH DANN, wenn der PanResponder den Touch währenddessen per
    // Responder-Terminierung übernommen hat (Beginn eines echten Wischs) —
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
        setStand({ ...ergebnis, pausiert: false });
        return;
      }
      // Klein (Review-Fund): V10 gilt in BEIDE Richtungen ("vor jedem
      // Weiter" schliesst ein zurueck() nicht aus — auch dabei bleibt der
      // Player sichtbar auf demselben Vorrat angewiesen).
      void pruefeUndErneuereVorratImHintergrund();
      setStand({ ...zurueck(stand), pausiert: false });
      return;
    }
    // Halten, dann losgelassen: "und weiter beim Loslassen" (Brief) heisst
    // hier fortsetzen, NICHT zum nächsten Moment springen.
    setStand((s) => ({ ...s, pausiert: false }));
  };

  const schliessen = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  const pan = useRef(new Animated.ValueXY()).current;
  // Klein (Review-Fund): true, sobald der PanResponder den Touch tatsächlich
  // übernommen hat (onPanResponderGrant feuert nur bei echter Übernahme,
  // anders als das bloss ANFRAGENDE onMoveShouldSetPanResponderCapture) —
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
        <Text style={[type.h2, styles.zentrierterText]}>{fehlerText}</Text>
        <View style={{ marginTop: spacing.xl, gap: spacing.base, alignItems: 'center' }}>
          <KinoButton label="Nochmal versuchen" onPress={() => void laden()} />
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
          // wirklich pausieren — sie ist vollflächig-opak, ohne diese
          // Verknüpfung liefe ein Video darunter unbeirrt weiter (Bild UND
          // Ton) und könnte sogar unter der Karte zu Ende laufen, sodass der
          // Moment, den die Karte gerade ankündigt, nie gezeigt würde.
          pausiert={stand.pausiert || zwischenkarte}
          onVideoEnde={() => videoZuEnde(aktivMoment.id)}
          onFehler={() => beiLadefehler(aktivMoment.id)}
        />

        <View style={styles.kopfBereich} pointerEvents="box-none">
          <Fortschrittsbalken
            anzahl={spielliste.length}
            aktivIndex={stand.index}
            dauerMs={dauerFuer(aktivMoment)}
            vergangenMs={stand.fortschritt}
            pausiert={stand.pausiert || zwischenkarte}
          />
          <View style={styles.kopfReihe}>
            <View style={styles.namePille}>
              <AvatarInitiale name={aktivMoment.autor_name} />
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{aktivMoment.autor_name}</Text>
            </View>
            <View style={styles.infoPille}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sozialBereich} pointerEvents="box-none">
          {aktivMoment.caption && (
            <View testID="player-caption" style={styles.captionPille} pointerEvents="none">
              <Text style={[type.body, { color: cinema['text-1'] }]}>{aktivMoment.caption}</Text>
            </View>
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
              <View style={styles.kommentarKnopf}>
                <MessageCircle size={20} color={cinema['text-1']} strokeWidth={1.75} />
              </View>
            </PressScale>
          </View>
          {reaktionFehler && (
            <View style={styles.reaktionFehlerPille}>
              <Text style={[type.secondary, { color: cinema['text-1'] }]}>{reaktionFehler}</Text>
            </View>
          )}
        </View>

        <Pressable
          testID="player-links"
          accessibilityRole="button"
          accessibilityLabel="Zurück zum vorherigen Moment"
          style={styles.tapZoneLinks}
          onPressIn={onPressIn}
          onPressOut={() => beendeBeruehrung('links')}
        />
        <Pressable
          testID="player-rechts"
          accessibilityRole="button"
          accessibilityLabel="Weiter zum nächsten Moment"
          style={styles.tapZoneRechts}
          onPressIn={onPressIn}
          onPressOut={() => beendeBeruehrung('rechts')}
        />

        <PressScale
          testID="player-schliessen"
          accessibilityRole="button"
          accessibilityLabel="Schliessen"
          onPress={schliessen}
          style={styles.schliessenWrap}
        >
          <View style={styles.schliessenPille}>
            <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </View>
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
          (gleiches Muster wie reise/[id]/index.tsx) — das Sheet muss über
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
    backgroundColor: cinema['overlay-pill'],
  },
  infoPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
  },
  // Klein (Review-Fund): DESIGN-LANGUAGE §4 verlangt "rund, 32–44 px, 2 px
  // weisser Ring" — 32 px (unteres Ende der Spanne, passend zur kompakten
  // Kopf-Pille) mit 2 px Rand in `cinema['text-1']` (das hellste Kino-Token,
  // der nächste verfügbare Ersatz für "weiss" innerhalb der festen
  // Kino-Palette, die kein rohes #FFFFFF kennt).
  avatarKreis: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: cinema['text-1'],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['bg-1'],
  },
  // Kein `position:absolute` mehr (anders als vor Task 12): die Pille ist
  // jetzt ein normales Flow-Kind von `sozialBereich`, das seinerseits
  // GENAU EINMAL vom unteren Rand aus positioniert ist — Caption,
  // "Reaktionen anderer" und die Emoji-Leiste stapeln sich darin per `gap`,
  // ohne sich je zu überlappen, unabhängig davon, wie viele Zeilen die
  // Caption braucht.
  captionPille: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.control,
    backgroundColor: cinema['overlay-pill'],
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // M5/Klein (Review-Fund): die Stapel-Reihenfolge hing bisher allein an der
  // Render-Reihenfolge im JSX ("später gerendert = oben") — fragil, weil sie
  // sich unbemerkt umkehren liess (ein RNTL-`fireEvent.press` prüft keine
  // Geometrie/Stapelung, jede Verschiebung im Baum blieb also unbemerkt
  // grün). Jetzt ein expliziter, von der Reihenfolge unabhängiger zIndex:
  // Tipp-Zonen unten, die Zwischenkarte darüber (blockiert sie strukturell),
  // die Schliessen-Pille ganz oben (bleibt auch WÄHREND der Karte bedienbar
  // — sonst liesse sich der Player während der 1,5 s der Karte nicht
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
    backgroundColor: cinema['overlay-pill'],
  },
  ladeHinweisWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.xxl },
  ladeHinweisPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
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
  sozialBereich: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    gap: spacing.base,
  },
  reaktionsReihe: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  emojiPille: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['overlay-pill'],
  },
  emojiPilleAktiv: { backgroundColor: cinema['text-1'] },
  emojiZeichen: { fontSize: 20 },
  kommentarKnopf: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['overlay-pill'],
  },
  andereReaktionenPille: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
  },
  reaktionFehlerPille: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
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
