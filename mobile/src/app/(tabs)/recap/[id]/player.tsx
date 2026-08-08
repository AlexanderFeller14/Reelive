import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Fortschrittsbalken } from '@/components/Fortschrittsbalken';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { fetchTrip } from '@/features/trips/tripsApi';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { RecapMoment, RecapTag } from '@/features/recap/types';
import { holeVorrat, laeuftBaldAb, type MedienUrl } from '@/features/recap/urlVorrat';
import { dauerFuer, tagWechselt, weiter, zurueck, type PlayerStand } from '@/features/recap/playerLogic';

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
function VideoMoment({ url, onEnde, onFehler }: { url: string; onEnde: () => void; onFehler: () => void }) {
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
  moment, url, fehlgeschlagen, onVideoEnde, onFehler,
}: {
  moment: RecapMoment;
  url: MedienUrl | undefined;
  fehlgeschlagen: boolean;
  onVideoEnde: () => void;
  onFehler: () => void;
}) {
  // Kein Ladefehler bekannt und eine URL vorhanden: normal anzeigen.
  if (!fehlgeschlagen && url) {
    return moment.type === 'video' ? (
      <VideoMoment url={url.medium_url} onEnde={onVideoEnde} onFehler={onFehler} />
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

  // Erstes (und einziges) useMemo dieser Codebase (Vertrag 1): `tage` hängt
  // nur an der referenzstabilen `spielliste` + `startDate`, muss also nicht
  // bei jedem Fortschritts-Tick neu berechnet werden — dieselbe
  // Performance-Überlegung wie tagWechselt.
  const tage = useMemo(() => gruppiereNachTagen(spielliste, startDate), [spielliste, startDate]);
  const aktuellerTag = useMemo(() => {
    if (!aktivMoment) return null;
    return tage.find((t) => t.momente.some((m) => m.id === aktivMoment.id)) ?? null;
  }, [tage, aktivMoment]);

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
        // zurückgesetzt werden.
        if (aktiv.current) setStand((s) => ({ ...s, pausiert: false }));
      })();
    },
    [tripId]
  );

  const onPressIn = () => {
    beruehrungStartRef.current = Date.now();
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const vergangen = Math.min(dauer, Math.max(0, Date.now() - segmentStartRef.current));
    setStand((s) => ({ ...s, pausiert: true, fortschritt: vergangen }));
  };

  const beendeBeruehrung = (seite: 'links' | 'rechts') => {
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
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
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
          onVideoEnde={() => weiterAutomatischRef.current()}
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

        {aktivMoment.caption && (
          <View style={styles.captionPille} pointerEvents="none">
            <Text style={[type.body, { color: cinema['text-1'] }]}>{aktivMoment.caption}</Text>
          </View>
        )}

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
  avatarKreis: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['bg-1'],
  },
  captionPille: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    borderRadius: radius.control,
    backgroundColor: cinema['overlay-pill'],
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  tapZoneLinks: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%' },
  tapZoneRechts: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%' },
  schliessenWrap: { position: 'absolute', top: spacing.xl, right: spacing.screen },
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
  },
});
