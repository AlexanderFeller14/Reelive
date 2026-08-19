import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/Avatar';
import { PressScale } from '@/components/PressScale';
import { ProgressBar } from '@/components/ProgressBar';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { resolveToken, DEAD_LINK_TEXT, type SharedMoment } from '@/features/sharing/shareApi';
import { sortMoments } from '@/features/recap/days';
import {
  blocksAutoAdvance,
  durationFor,
  withReason,
  withoutReason,
  dayChanges,
  advance,
  goBack,
  type PauseReason,
  type PlayerState,
} from '@/features/recap/playerLogic';
import { groupByDays } from '@/features/recap/days';
import type { RecapMoment, RecapDay } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';
import { viewportFor } from '@/features/map/viewport';
import { MapSurface } from '@/features/map/MapSurface';
import { cluster } from '@/features/map/clustering';
import { zoomExhausted, zoomTarget, type ZoomAttempt } from '@/features/map/clusterTap';
import { toMapPoints } from '@/features/map/mapPoints';
import {
  ClusterSheetContent,
  MomentSheetContent,
  pinImageUrl,
  sheetImageUrl,
  type SheetForm,
} from '@/features/map/MomentSheet';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapPoint,
} from '@/features/map/types';

// Öffentlicher, schreibgeschützter Web-Player (Task-5-Brief, Spec §5.2):
// zeigt dieselbe Story wie mobile/src/app/(tabs)/recap/[id]/player.tsx,
// Kino-Palette, Fortschrittsbalken, Tages-Trenner, Autor, Zeit, Ort,
// Caption. OHNE Emoji-Leiste, OHNE Kommentare, OHNE Melden, OHNE Login. Wird
// als EIGENER, kleinerer Screen gebaut statt den 1532-Zeilen-Player zu
// kopieren oder mit einem `nurAnschauen`-Schalter zu verbiegen, siehe
// Bericht für die Begründung. Wiederverwendet werden die fertigen,
// gereviewten Bausteine: Fortschrittsbalken, playerLogic (dauerFuer, weiter,
// zurueck, tagWechselt, PauseGrund/mitGrund/ohneGrund/
// blockiertAutomatischenVorschub) und tage.ts (gruppiereNachTagen,
// sortiereMomente), UNVERÄNDERT, kein Import aus recapApi.ts/sozialApi.ts/
// AuthProvider (W4: nichts davon soll im Modulgraph dieses Screens
// überhaupt AUFTAUCHEN, nicht nur ungenutzt bleiben, siehe
// teilen/__tests__/modulgraph.test.ts).
//
// Bewusste Vereinfachungen gegenüber dem nativen Player (jeweils begründet
// im Bericht):
// - Kein Schliessen-Knopf, kein Wisch-nach-unten: es gibt keine "vorherige"
//   Route, zu der man zurückkehren könnte, die Seite IST die ganze
//   Web-Erfahrung (istWebGesperrt in guard.ts sperrt alles andere).
// - Kein Kino-Fade-Übergang beim Betreten: der bildet "das Licht geht aus"
//   beim Wechsel von einem HELLEN Screen ab, hier gibt es keinen
//   vorangehenden hellen Screen innerhalb dieser Sitzung, der Browser-Tab
//   lädt direkt in den Kinosaal.
// - Ein fehlgeschlagenes Foto/Video zeigt SOFORT die Hinweis-Pille (kein
//   unsichtbarer Neuversuch/V10-URL-Erneuerung wie im nativen Player): der
//   Vorrat kommt hier aus EINEM Aufruf ohne Session, ein zweiter,
//   still-nachsignierender Hintergrundaufruf wäre zusätzliche Komplexität
//   für einen Anwendungsfall (eine typischerweise binnen Minuten
//   durchgespielte Story), den der Task-Auftrag nicht verlangt.
//
// Seit Task 15 trägt derselbe Screen die ZWEITE Lesart des Recaps: die Karte
// (Spec §5.10). Sie ersetzt den Player, statt eine eigene Route zu bekommen,
// ein geteilter Link ist EINE URL, und eine zweite Route wäre eine, die
// niemand teilen kann und die ohne Vorgeschichte aufgerufen würde. Die
// Kartenfläche selbst ist dieselbe wie in der App (features/karte/
// KartenFlaeche.tsx nativ, .web.tsx im Browser); dieser Screen liefert ihr
// Nadeln, Linie und Kamera und entscheidet, was ein Tipp auslöst.
const VORLADEN_ANZAHL = 3;
const ZWISCHENKARTE_DAUER_MS = 1500;
const TAP_SCHWELLE_MS = 250;

// Die beiden Lesarten (Spec §5.10, wortgleiche Segment-Zeile wie in der
// Übersicht der App, dort «Nach Tagen · Auf der Karte»). Beide
// Beschriftungen stehen immer da; nur welche Hälfte der Knopf ist, wechselt.
const ANSEHEN_LABEL = 'Ansehen';
const KARTE_LABEL = 'Auf der Karte';
// Was die Sheets dieser Seite von denen der App-Karte unterscheidet
// (features/karte/MomentSheet.tsx), und sonst nichts: der Knopf heisst hier
// anders, weil es keinen Recap-Player gibt, in den gesprungen würde, sondern
// den geteilten Player auf DIESEM Screen (Spec §5.10).
const SHEET_FORM: SheetForm = { buttonLabel: 'Ab hier ansehen', prefix: 'teilen-' };
// Höhe der Segment-Zeile (36 + 2 × 4 Polster), dieselben 44 Punkte wie jede
// andere Pille dieses Projekts. Als Konstante, weil der Kopfbereich des
// Players darunter rutscht, sobald es die Zeile gibt.
const SEGMENT_HOEHE = 44;

type LadePhase = 'laedt' | 'fehler' | 'leer' | 'bereit' | 'ende';
type MedienLink = { medium_url: string; thumb_url: string | null };

// Bildet die shareApi-Antwort auf die RecapMoment-Form ab, damit
// dauerFuer/gruppiereNachTagen/tagWechselt/sortiereMomente/zuKartenPunkten
// UNVERÄNDERT wiederverwendbar bleiben (sie sind auf RecapMoment[]
// typisiert). Die hier aufgefüllten Felder (trip_id, author_id,
// upload_status) liest KEINE der wiederverwendeten Funktionen jemals, id
// dient als stabiler Schlüssel (aus post_id), die übrigen sind reine
// Platzhalter, um die Form zu erfüllen.
//
// lat/lng werden seit Task 15 DURCHGEREICHT statt auf null gesetzt: sie sind
// die Grundlage der Karte auf dieser Seite (Spec §5.10). shareApi.ts prüft
// sie beim Lesen auf eine endliche Zahl, hier kommt also entweder eine
// brauchbare Koordinate an oder `null`.
//
// autor_avatar_key wird seit Task 10 ebenso DURCHGEREICHT (vorher fest
// null, GeteiltesMoment trug damals noch keinen Bildschlüssel): der
// SCHLÜSSEL, nie eine fertige URL, `<Avatar>` baut die URL selbst über
// avatarUrl() (features/auth/avatar.ts).
function zuRecapMoment(m: SharedMoment): RecapMoment {
  return {
    id: m.post_id,
    trip_id: '',
    author_id: '',
    type: m.type,
    duration_s: m.duration_s,
    caption: m.caption,
    captured_at: m.captured_at,
    captured_tz: m.captured_tz,
    place_name: m.place_name,
    lat: m.lat,
    lng: m.lng,
    upload_status: 'uploaded',
    authorName: m.authorName,
    authorAvatarKey: m.authorAvatarKey,
  };
}

// Das Tagesdatum der Zwischenkarte, gleiche Formatierung wie im nativen
// Player (player.tsx), als eigene, kleine Kopie: player.tsx exportiert die
// Hilfsfunktion nicht, und dieser Screen baut sie nicht dort um.
//
// Die Uhrzeit lag bis Task 15 ebenso als Kopie hier. Sie kommt jetzt aus
// features/recap/uhrzeit.ts, das ist die Stelle, an die dieser Kommentar
// dort verweist («die beiden Screens umzustellen ist eine mechanische
// Nachfolgearbeit»), und die Datei liegt seit der Karte ohnehin im Modulgraph
// dieses Screens (features/karte/nadel.ts baut ihre Beschriftung daraus).
const MONATE_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
function formatTagesdatum(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONATE_LANG[m - 1]}`;
}
function tagesueberschrift(tag: RecapDay): string {
  const teile = [`Tag ${tag.nummer}`];
  if (tag.ort) teile.push(tag.ort);
  teile.push(formatTagesdatum(tag.datum));
  return teile.join(' · ');
}

function KinoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.kinoButton}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function LadeHinweisPille({ text }: { text: string }) {
  return (
    <Pill style={styles.ladeHinweisPille}>
      <Text style={[type.secondary, { color: cinema['text-1'] }]}>{text}</Text>
    </Pill>
  );
}

// Dezenter Fussbereich (Brief: "unten dezent der Reelive-Wortzug und «Hol
// dir die App»", Konzept §5.9), rein informativ, KEIN Knopf: es gibt noch
// keine Store-Verlinkung (Task 11 dieser Phase folgt erst), ein Link ins
// Nichts wäre schlechter als gar keiner. `pointerEvents="none"`: die Zeile
// liegt optisch über dem Foto/Video, darf aber nie eine Berührung abfangen,
// die eigentlich der Tipp-Zone darunter gilt.
function Fussleiste() {
  return (
    <View testID="teilen-fussleiste" style={styles.fussleiste} pointerEvents="none">
      <Text style={[type.label, { color: cinema['text-1'] }]}>Reelive</Text>
      <Text style={[type.secondary, { color: cinema['text-2'] }]}>Hol dir die App</Text>
    </View>
  );
}

function FotoMoment({ url, onFehler }: { url: string; onFehler: () => void }) {
  return (
    <Image
      testID="teilen-foto"
      source={{ uri: url }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      onError={onFehler}
    />
  );
}

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
      testID="teilen-video"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

// Anders als der native Player (V10, ein stiller Neuversuch vor der
// Hinweis-Pille): hier zeigt der ERSTE Ladefehler direkt die Pille, siehe
// Begründung im Kopf-Kommentar der Datei.
function MomentAnzeige({
  moment, url, fehlgeschlagen, pausiert, onVideoEnde, onFehler,
}: {
  moment: RecapMoment;
  url: MedienLink | undefined;
  fehlgeschlagen: boolean;
  pausiert: boolean;
  onVideoEnde: () => void;
  onFehler: () => void;
}) {
  if (!fehlgeschlagen && url) {
    return moment.type === 'video' ? (
      <VideoMoment url={url.medium_url} pausiert={pausiert} onEnde={onVideoEnde} onFehler={onFehler} />
    ) : (
      <FotoMoment url={url.medium_url} onFehler={onFehler} />
    );
  }
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

// ---------------------------------------------------------------------------
// Die Karte (Spec §5.10)
// ---------------------------------------------------------------------------

// Momente, die diese Seite gar nicht bekommen hat: die Function konnte für
// sie keine URL herausgeben (`ausgelassen`, share-link/aufloesung.ts). Sie
// fehlen im Player UND auf der Karte, ohne diesen Satz fehlten sie spurlos,
// und die Seite behauptete, sie zeige die ganze Reise.
//
// Wortgleich zu uebersicht.tsx und recap/[id]/karte.tsx: dieselbe Lage sagt
// überall dasselbe.
function ausgelassenText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Singular/Plural wie überall im Projekt: die Zahl bleibt auch im Singular
// stehen. Der Nachsatz ist ein eigener Satz und beginnt darum gross, die
// UI-Sprache kennt keine Gedankenstriche (DESIGN-LANGUAGE §6).
function ohneOrtText(anzahl: number): string {
  const wort = anzahl === 1 ? 'Moment' : 'Momente';
  const nachsatz = anzahl === 1 ? 'Er läuft' : 'Sie laufen';
  return `${anzahl} ${wort} ohne Ort. ${nachsatz} im Recap mit.`;
}

// Eine Hälfte der Segment-Zeile.
//
// Die AKTIVE Hälfte ist bewusst KEIN Knopf: sie zeigt, wo man gerade ist, und
// ein Tipp darauf täte nichts, ein Press-Feedback wäre eine Zusage, die
// niemand einlöst (gleiche Entscheidung wie in uebersicht.tsx). `accessible`
// bündelt Fläche und Text zu einem Element, damit VoiceOver den Stand als
// eine Auskunft vorliest statt als losen Text neben einem Knopf.
//
// Farben anders als in der Übersicht der App, aus einem Grund, der nicht
// Geschmack ist: dort liegt die Zeile auf Weiss, hier auf einer FREMDFLÄCHE
// (Foto oder Kartenkacheln). DESIGN-LANGUAGE §1 lässt darauf ausschliesslich
// die translucente Pille zu, die trägt deshalb die Spur, und die aktive
// Hälfte darin ist die helle Fläche des KinoButtons. Der passive Text steht
// in `cinema.text-1` und nicht in `text-2` (§4, Tab-Bar): §4 beschreibt die
// Tab-Leiste auf `bg-0`; hier ist der Untergrund halbdurchsichtig über einer
// hellen Karte, und der schwächere Ton wäre dort nicht mehr sicher lesbar.
// Den Unterschied trägt die Füllung, nicht die Textfarbe.
function SegmentHaelfte({
  label, aktiv, testID, onPress,
}: {
  label: string;
  aktiv: boolean;
  testID: string;
  onPress: () => void;
}) {
  if (aktiv) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${label}, aktuelle Ansicht`}
        testID={testID}
        style={styles.segmentAktiv}
      >
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    );
  }
  return (
    <PressScale accessibilityRole="button" testID={testID} onPress={onPress}>
      <View style={styles.segmentPassiv}>
        <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

// Der Einstieg in die Karte und der Weg zurück, EIN Element für beides, an
// EINER Stelle, in beiden Ansichten. Es steht bewusst ganz oben und nicht im
// Kopfbereich des Players: der Kopf gehört dem Player (Fortschritt, Autor,
// Ort/Zeit), diese Zeile gehört dem Screen. Und sie darf beim Umschalten
// nicht springen, sonst müsste man den Weg zurück suchen, statt ihn dort zu
// finden, wo man ihn gerade angetippt hat.
// `onWechsel` ohne Argument, obwohl es zwei Hälften gibt: die AKTIVE ist kein
// Knopf (siehe oben), es kann also immer nur die andere gedrückt werden, der
// Wechsel hat kein Ziel zu wählen. Ein `onWechsel(true|false)` läge nur
// scheinbar näher und wäre an beiden Aufrufstellen ein ignoriertes Argument.
function SegmentZeile({
  aufKarte, onWechsel, oben,
}: {
  aufKarte: boolean;
  onWechsel: () => void;
  /** Abstand zur Oberkante, aus `useOberkante`, siehe dort. */
  oben: number;
}) {
  return (
    // `box-none`: der Rahmen zieht sich über die volle Breite und dürfte
    // links und rechts der Pille keinen Tipp abfangen, im Player liegt
    // darunter die Tipp-Zone, auf der Karte die Karte selbst.
    <View style={[styles.segmentZeile, { top: oben }]} pointerEvents="box-none">
      <Pill style={styles.segmentSpur}>
        <SegmentHaelfte
          label={ANSEHEN_LABEL}
          aktiv={!aufKarte}
          testID="teilen-segment-ansehen"
          onPress={onWechsel}
        />
        <SegmentHaelfte
          label={KARTE_LABEL}
          aktiv={aufKarte}
          testID="teilen-segment-karte"
          onPress={onWechsel}
        />
      </Pill>
    </View>
  );
}

export default function GeteilterRecapScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const [phase, setPhase] = useState<LadePhase>('laedt');
  const [fehlerText, setFehlerText] = useState<string | null>(null);
  const [reiseName, setReiseName] = useState('');
  const [startDate, setStartDate] = useState('');
  // Wie viele Momente die Function gar nicht herausgeben konnte, siehe
  // `ausgelassenText`.
  const [ausgelassen, setAusgelassen] = useState(0);
  // Referenzstabil ab dem Moment, in dem laden() sie einmal setzt, tagWechselt
  // memoisiert über die ARRAY-REFERENZ, nicht über Inhalt/Länge (gleicher
  // Vertrag wie im nativen Player, playerLogic.ts).
  const [spielliste, setSpielliste] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MedienLink>>(new Map());
  const [stand, setStand] = useState<PlayerState>({ index: 0, pausiert: new Set(), fortschritt: 0 });
  const [fehlgeschlagen, setFehlgeschlagen] = useState<Set<string>>(new Set());
  // Welche der beiden Lesarten gerade zu sehen ist (Spec §5.10). Kein
  // `router.push`: der geteilte Recap ist EINE URL und bekommt keine zweite
  // Route.
  const [ansicht, setAnsicht] = useState<'player' | 'karte'>('player');
  // Der zuletzt GEMELDETE Kartenausschnitt, oder `null` für «die Karte hat
  // noch nichts gemeldet». Er ist die Grundlage der Gruppierung (sie rechnet
  // in Bildschirmpunkten und braucht den aktuellen Zoom), und zugleich der
  // Ausschnitt, mit dem die Karte beim nächsten Mal öffnet, siehe unten.
  const [ausschnitt, setAusschnitt] = useState<Viewport | null>(null);
  // Was das Moment-Sheet gerade zeigt, oder `null` für «keines offen». EIN
  // Zustand für beide Fälle, weil sie dieselbe Frage beantworten («welche
  // Momente stecken hinter dieser Nadel») und sich gegenseitig ausschliessen:
  // ein Punkt ist der einzelne Moment (Spec §5.7), mehrere sind die Liste
  // einer Gruppe, die sich nicht auseinanderzoomen lässt.
  const [sheet, setSheet] = useState<MapPoint[] | null>(null);

  const aktiv = useRef(true);
  const segmentStartRef = useRef(0);
  const beruehrungStartRef = useRef(0);
  const aktivIdRef = useRef<string | undefined>(undefined);
  const pausiertRef = useRef<ReadonlySet<PauseReason>>(new Set());
  // Die Segment-Zeile ist das oberste Element dieses Screens und trifft damit
  // als erstes die Dynamic Island. `spacing.xl` war der bisherige feste
  // Abstand des Player-Kopfs; `useOberkante` lässt ihn stehen, wo er reicht,
  // und weicht nur dort aus, wo das Gerät mehr wegnimmt.
  const oben = useTopInset(spacing.xl);
  const karte = useRef<MapSurfaceHandle>(null);
  // Der letzte Zoom-Versuch auf eine Gruppe, die Grundlage dafür, ob ein
  // weiterer noch etwas ausrichtet (features/karte/gruppenTipp.ts). Ein Ref
  // und kein State: der Wert ändert nichts am Bild, er beantwortet nur die
  // nächste Frage.
  const letzterZoom = useRef<ZoomAttempt | null>(null);

  const reducedMotion = useReducedMotion();
  // Die Fläche, auf der gruppiert wird: die Karte liegt als absoluteFill über
  // dem ganzen Screen, das Fenster ist also ihr Mass (gleiche Überlegung wie
  // in recap/[id]/karte.tsx).
  const { width: breite, height: hoehe } = useWindowDimensions();

  const laden = useCallback(async () => {
    setPhase('laedt');
    setFehlerText(null);
    // Alles, was zur VORHERIGEN Auflösung gehört, geht hier weg. Der Screen
    // bleibt bei einem Wechsel des Tokens gemountet (dieselbe Route, anderer
    // Parameter), und ein stehen gebliebenes Sheet trüge danach einen Moment
    // der vorherigen Reise, sein Knopf setzte den Player auf einen Index,
    // der in der neuen Reise auf einen ganz anderen Moment zeigt. Sichtbar
    // wäre das ohnehin nicht (die Phase steht ab dieser Zeile auf 'laedt',
    // und die zeigt nur den Ladeindikator), der Zustand soll trotzdem
    // eindeutig sein, statt an der Reihenfolge der Zweige unten zu hängen.
    setAnsicht('player');
    setSheet(null);
    setAusschnitt(null);
    setAusgelassen(0);
    letzterZoom.current = null;
    const { data, error } = await resolveToken(token);
    if (!aktiv.current) return;

    if (error || !data) {
      setFehlerText(error ?? DEAD_LINK_TEXT);
      setPhase('fehler');
      return;
    }

    const liste = sortMoments(data.medien.map(zuRecapMoment));
    const urlMap = new Map<string, MedienLink>(
      data.medien.map((m) => [m.post_id, { medium_url: m.medium_url, thumb_url: m.thumb_url }])
    );
    setReiseName(data.reise.name);
    setStartDate(data.reise.start_date);
    setAusgelassen(data.ausgelassen);
    setUrls(urlMap);
    setSpielliste(liste);
    setFehlgeschlagen(new Set());

    if (liste.length === 0) {
      setPhase('leer');
      return;
    }
    setStand({ index: 0, pausiert: new Set(), fortschritt: 0 });
    setPhase('bereit');
  }, [token]);

  useEffect(() => {
    aktiv.current = true;
    void laden();
    return () => {
      aktiv.current = false;
    };
  }, [laden]);

  // Die Statusleiste folgt der Ansicht, nicht dem Screen.
  //
  // Der Player ist ein Medien-Screen und damit Kino (DESIGN-LANGUAGE v2 §1),
  // helle Schrift. Die Karte ist es nicht: unter der Statusleiste liegen dann
  // Kartenkacheln, und die sind hell (Spec §5.3). Eine hell gelassene Uhrzeit
  // wäre dort schlicht nicht mehr zu lesen. Kein useFocusEffect nötig, es
  // gibt keine Geschwister-Route, zu der man zurückkehren könnte (siehe
  // Kopf-Kommentar).
  useEffect(() => {
    setStatusBarStyle(ansicht === 'karte' ? 'dark' : 'light');
  }, [ansicht]);

  const aktivMoment = spielliste[stand.index];
  aktivIdRef.current = aktivMoment?.id;
  const zwischenkarte = stand.pausiert.has('zwischenkarte');
  const gestoppt = stand.pausiert.size > 0;
  pausiertRef.current = stand.pausiert;

  const tage = useMemo(() => groupByDays(spielliste, startDate), [spielliste, startDate]);
  const aktuellerTag = useMemo(() => {
    if (!aktivMoment) return null;
    return tage.find((t) => t.momente.some((m) => m.id === aktivMoment.id)) ?? null;
  }, [tage, aktivMoment]);

  // -------------------------------------------------------------------------
  // Die Karte (Spec §5.10)
  // -------------------------------------------------------------------------

  // Nadeln und Nicht-Nadeln, aus GENAU DER LISTE, die der Player spielt.
  //
  // Das ist die eine Stelle, an der ein Fehler still bliebe: `punkt.index`
  // zählt in die Liste, die `zuKartenPunkten` hereinbekommt (typen.ts), und
  // genau dieser Wert setzt unten den Index des geteilten Players. `spielliste`
  // ist diese Liste, sie IST der Player (`spielliste[stand.index]` oben).
  // Eine andere Liste hereinzugeben (etwa `data.medien` in Antwortreihenfolge)
  // liesse die Nadeln weiterhin auf ihren Koordinaten sitzen, und der Sprung
  // landete beim falschen Moment; auffallen würde das nur beim Nachzählen.
  //
  // `zuKartenPunkten` sortiert selbst noch einmal über `sortiereMomente`,
  // dieselbe totale Ordnung, mit der `laden()` die Spielliste gebaut hat
  // (captured_at, id als zweites Kriterium). Zweimal angewandt kommt
  // zwangsläufig dieselbe Reihenfolge heraus, die Indizes zeigen also
  // nachweislich in die Spielliste.
  const { points, withoutPlace } = useMemo(() => toMapPoints(spielliste), [spielliste]);

  // Der Ausschnitt, in dem ALLE Momente mit Ort zu sehen sind (Spec K2),
  // `null`, wenn keiner einen hat. Genau daran hängt, ob es die Karte
  // überhaupt gibt.
  const startAusschnitt = useMemo(() => viewportFor(points), [points]);

  // Womit die Karte öffnet UND worauf gruppiert wird.
  //
  // Die Fläche wird beim Umschalten auf den Player ABGEBAUT und beim
  // Zurückschalten neu gemountet, nicht bloss versteckt. Zwei Gründe:
  //
  // - `initialerAusschnitt` wirkt nur beim Mounten (typen.ts). Eine dauerhaft
  //   gemountete Fläche müsste ihre Kamera über `zeige` nachgeführt bekommen;
  //   so fallen «wann die Karte sichtbar wird» und «wann der Ausschnitt gilt»
  //   von selbst zusammen, und es gibt keinen zweiten Weg, auf dem die Kamera
  //   gesetzt wird.
  // - Im Browser baut Leaflet die Karte in einen DOM-Knoten und rechnet den
  //   Zoom aus dessen GRÖSSE (`fitBounds` → `getBoundsZoom`,
  //   KartenFlaeche.web.tsx). Eine versteckte Fläche hat die Grösse 0 × 0, und
  //   die Fassung ruft nirgends `invalidateSize()`, «gemountet, aber
  //   unsichtbar» ist dort also gar keine Möglichkeit, sondern eine Karte, die
  //   auf einer sinnlosen Zoomstufe aufgeht.
  //
  // Damit die Karte beim Zurückschalten trotzdem nicht in die Ausgangslage
  // zurückspringt, öffnet sie mit dem zuletzt gemeldeten Ausschnitt. Beim
  // ersten Mal gibt es keinen, dann zeigt sie alles.
  const sichtbarerAusschnitt = ausschnitt ?? startAusschnitt;

  // Die Reise als Linie (Spec K3/§5.6). `punkte` kommt aus `zuKartenPunkten`
  // bereits nach `captured_at` sortiert, hier wird bewusst NICHT noch einmal
  // sortiert: die Linie zeigt, in welcher Reihenfolge aufgenommen wurde, nie,
  // in welcher hochgeladen wurde.
  const linie = useMemo(
    () => points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [points]
  );

  // Nadeln, die einander sonst verdecken, teilen sich eine (Spec §5.5).
  // Gruppiert wird nach dem Abstand auf DEM GERADE SICHTBAREN Ausschnitt,
  // beim Hineinzoomen fällt eine Gruppe damit von selbst auseinander.
  const gruppen = useMemo(
    () => (sichtbarerAusschnitt ? cluster(points, sichtbarerAusschnitt, breite, hoehe) : []),
    [points, sichtbarerAusschnitt, breite, hoehe]
  );

  // Das Bild einer Nadel, als Nachschlagefunktion statt als fertige Liste:
  // die Fläche fragt für den Anker jeder Gruppe nach, und welche Gruppen es
  // gibt, weiss sie selbst besser als dieser Screen.
  const thumbFuer = useCallback((postId: string) => pinImageUrl(urls, postId), [urls]);

  const merkeAusschnitt = useCallback((sichtbar: Viewport) => setAusschnitt(sichtbar), []);

  // Die Kamera bewegt DIE FLÄCHE, nicht dieser Screen. Dort sitzt auch die
  // Reduced-Motion-Weiche, sie gehört zur Technik der jeweiligen Karte
  // (animateToRegion/setRegion nativ, flyTo/setView im Browser).
  const zeige = useCallback((ziel: Viewport) => karte.current?.flyTo(ziel), []);

  // Was ein Tipp auf eine Gruppe zusätzlich wissen muss, in einem Ref statt
  // in den Abhängigkeiten von `aufGruppe`. Hinge die Funktion am Ausschnitt,
  // bekäme jede Nadel bei JEDER Kartenbewegung ein neues `onPress`, und das
  // `memo` am Marker (KartenNadel.tsx) wäre wirkungslos.
  //
  // `useLayoutEffect`, nicht `useEffect`: ein passiver Effekt läuft erst NACH
  // dem Commit, und in dem Fenster dazwischen läse ein Tipp noch den alten
  // Stand, die Karte kommt aus einer Fahrt, und der Tipp auf die eben
  // erschienene Nadel rechnete mit dem Zoom von davor.
  const kartenStand = useRef<Viewport | null>(sichtbarerAusschnitt);
  useLayoutEffect(() => {
    kartenStand.current = sichtbarerAusschnitt;
  }, [sichtbarerAusschnitt]);

  // Ein Tipp auf eine Gruppe fährt in sie hinein, solange das etwas ausrichtet
  // (Spec §5.5): wer auf der Karte sucht, will die Karte benutzen. Erst wo
  // Zoomen nichts mehr bringt, eine einzelne Nadel, oder mehrere Momente auf
  // exakt derselben Koordinate, öffnet sich das Sheet. Wortgleich zu
  // recap/[id]/karte.tsx, samt der Begründung dort.
  const aufGruppe = useCallback(
    (gruppe: Cluster) => {
      const sichtbar = kartenStand.current;

      // Unerreichbar, aber für den Typ nötig: `gruppen` wird nur berechnet,
      // wenn der Ausschnitt steht, ohne ihn gäbe es gar keine Nadel.
      if (!sichtbar) return;

      // Die Entscheidung «zoomen oder Sheet» liegt in
      // features/karte/gruppenTipp.ts, gemeinsam mit dem Kartenscreen der App,
      // samt der Begründung, warum bitgleiche Koordinaten dafür nicht
      // reichen: die Karte hat eine letzte Zoomstufe, und drei bis acht Meter
      // GPS-Versatz trennt sie dort nicht mehr.
      if (zoomExhausted(gruppe, sichtbar, letzterZoom.current)) {
        setSheet(gruppe.points);
        return;
      }

      const ziel = zoomTarget(gruppe, sichtbar);
      // Unerreichbar (eine Gruppe hat mindestens einen Punkt), aber der Typ
      // von `ausschnittFuer` verlangt die Behandlung.
      if (!ziel) return;

      // Was diese Fahrt VERSUCHT hat, die Grundlage der Antwort beim nächsten
      // Tipp auf dieselbe Gruppe.
      letzterZoom.current = { anchorId: gruppe.anchor.moment.id, before: sichtbar };

      // DESIGN-LANGUAGE §5 nennt für «Zoom» selection-Haptik. `.catch`, weil
      // ein abgelehntes Promise aus einem nativen Modul sonst als unbehandelte
      // Ablehnung zählt, im Browser gibt es keine Haptik, dort ist der Aufruf
      // ein No-Op.
      void Haptics.selectionAsync().catch(() => {});

      zeige(ziel);
    },
    [zeige]
  );

  // Was der Tipp auf diese Gruppe tun WIRD, für die Beschriftung, die
  // VoiceOver vorliest. Dieselbe Frage und dieselbe Antwort wie oben, nur ohne
  // die Folgen; wortgleich zu recap/[id]/karte.tsx, samt der Begründung dort,
  // warum die Fläche das nicht selbst rechnen kann und warum der Ausschnitt
  // hier NICHT aus `kartenStand` kommt: diese Frage wird beim Rendern
  // gestellt, das Ref zieht erst im Layout-Effekt danach nach.
  const oeffnetSheet = useCallback(
    (gruppe: Cluster) => {
      if (!sichtbarerAusschnitt) return false;
      return zoomExhausted(gruppe, sichtbarerAusschnitt, letzterZoom.current);
    },
    [sichtbarerAusschnitt]
  );

  // «Ab hier ansehen» (Spec §5.10). KEIN `router.push`: der geteilte Recap ist
  // EINE URL, der Player steht auf demselben Screen, der Sprung setzt also
  // seinen Index und schaltet die Ansicht um.
  //
  // Das Sheet geht dabei zu, anders als in der App: dort schiebt sich der
  // Player als eigene Route darüber und das offene Sheet bleibt für den
  // Rückweg stehen. Hier läge es über dem Player, den es gerade gestartet hat.
  //
  // `eintrag.index` zählt über die SPIELLISTE (siehe `punkte` oben), nie die
  // Stelle innerhalb von `punkte` (die überspringt jeden Moment ohne Ort) und
  // nie die innerhalb der Gruppe: beide sässen scheinbar richtig und starteten
  // den Player beim falschen Moment.
  const abHier = useCallback((eintrag: MapPoint) => {
    setStand({ index: eintrag.index, pausiert: new Set(), fortschritt: 0 });
    // Auch aus der Ende-Phase heraus: die Karte ist von dort erreichbar, und
    // «Ab hier ansehen» soll dann wieder abspielen, nicht auf dem Abspann
    // stehen bleiben.
    setPhase('bereit');
    setSheet(null);
    setAnsicht('player');
  }, []);

  // Der Wechsel zwischen den beiden Lesarten, beide Richtungen über EINE
  // Stelle, und zwar wegen des Sheets.
  //
  // Die Segment-Zeile liegt per zIndex ÜBER dem Sheet und ist damit auch dann
  // antippbar, wenn ein Moment-Sheet offen steht (das ist gewollt: der Weg
  // zurück in den Player darf von nichts verdeckt werden). Räumte «Ansehen»
  // das Sheet nicht mit ab, öffnete die Karte beim nächsten Mal mit einem
  // Sheet, das niemand angetippt hat, mit `abHier` gab es diesen Weg schon,
  // über die Segment-Zeile blieb er offen.
  const wechsleAnsicht = useCallback((ziel: 'player' | 'karte') => {
    setSheet(null);
    setAnsicht(ziel);
  }, []);

  // Ob es die Karte auf dieser Seite überhaupt gibt (Spec K9): ohne einen
  // einzigen Ort führte der Einstieg auf eine leere Fläche über dem Atlantik.
  // Anders als in der App braucht es dafür keinen erklärenden Leer-Screen,
  // der Einstieg entsteht schlicht nicht, und der Player steht ungestört da.
  const kannKarte = sichtbarerAusschnitt !== null;

  const weiterAutomatisch = useCallback(() => {
    const ergebnis = advance(stand, spielliste.length);
    if (ergebnis === 'ende') {
      setPhase('ende');
      return;
    }
    // Ein echter Indexwechsel: 'halten' gehört zum VERLASSENEN Moment und
    // darf den neuen nicht blockieren (gleicher Vertrag wie im nativen
    // Player). 'zwischenkarte' bleibt unangetastet, der eigene Effekt
    // unten (Deps u.a. stand.index) verwaltet sie selbst.
    setStand({ ...ergebnis, pausiert: withoutReason(ergebnis.pausiert, 'halten') });
  }, [stand, spielliste.length]);
  const weiterAutomatischRef = useRef(weiterAutomatisch);
  weiterAutomatischRef.current = weiterAutomatisch;

  const videoZuEnde = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    if (blocksAutoAdvance(pausiertRef.current)) return;
    weiterAutomatischRef.current();
  }, []);

  // Auto-Vorschub: EIN Timer für Fotos UND Videos (dauerFuer liefert für
  // beide eine sinnvolle Dauer), für ein Video zugleich der Rückfall, falls
  // es nie lädt.
  //
  // `ansicht` steht in der Bedingung, seit der Screen die Karte trägt: der
  // Player bleibt beim Umschalten als ZUSTAND bestehen (nur seine Ansicht ist
  // weg), und ohne diese Zeile liefe die Story hinter der offenen Karte
  // weiter. Wer eine halbe Minute auf der Karte sucht, käme auf «Ansehen»
  // sechs Momente später wieder heraus, oder im Abspann.
  useEffect(() => {
    if (phase !== 'bereit' || ansicht !== 'player' || stand.pausiert.size > 0) return;
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = durationFor(moment);
    const rest = Math.max(0, dauer - stand.fortschritt);
    segmentStartRef.current = Date.now() - stand.fortschritt;
    const timer = setTimeout(() => weiterAutomatischRef.current(), rest);
    return () => clearTimeout(timer);
  }, [phase, ansicht, stand.pausiert, stand.index, stand.fortschritt, spielliste]);

  // Tages-Zwischenkarte: erscheint VOR dem ersten Moment eines neuen Tages
  // und steht 1,5 s, bevor sie selbst weiterschaltet.
  //
  // `ansicht` steht in den Abhängigkeiten, obwohl der Effekt sie nirgends
  // liest, und das ist keine Nachlässigkeit, sondern die Zusicherung selbst:
  // die Ansage ist eine Ansage des PLAYERS. Läuft ihre Frist ab, während die
  // Karte offen ist, wäre der Tag beim Zurückkommen bereits angesagt, ohne
  // dass ihn jemand gelesen hat. So läuft der Effekt bei jedem Wechsel der
  // Ansicht neu und beginnt die anderthalb Sekunden von vorn.
  //
  // Ein zusätzliches `ansicht !== 'player'` im Rumpf stand hier kurz und ist
  // wieder rausgeflogen: es war nachweislich nicht zu beobachten (der Effekt
  // baut den Stand beim Zurückkommen ohnehin neu auf), genau die Art
  // Bedingung, die später niemand mehr prüfen kann.
  useEffect(() => {
    if (phase !== 'bereit') return;
    if (!dayChanges(spielliste, startDate, stand.index)) {
      setStand((s) => (s.pausiert.has('zwischenkarte') ? { ...s, pausiert: withoutReason(s.pausiert, 'zwischenkarte') } : s));
      return;
    }
    setStand((s) => ({ ...s, pausiert: withReason(s.pausiert, 'zwischenkarte') }));
    const timer = setTimeout(() => {
      setStand((s) => ({ ...s, pausiert: withoutReason(s.pausiert, 'zwischenkarte') }));
    }, ZWISCHENKARTE_DAUER_MS);
    return () => clearTimeout(timer);
  }, [phase, ansicht, spielliste, startDate, stand.index]);

  // Vorladen der nächsten drei Fotos (Videos werden nicht vorgeladen, wie im
  // nativen Player, expo-video puffert selbst beim Mounten).
  useEffect(() => {
    if (phase !== 'bereit') return;
    const kommendeUrls = spielliste
      .slice(stand.index + 1, stand.index + 1 + VORLADEN_ANZAHL)
      .filter((m) => m.type === 'photo')
      .map((m) => urls.get(m.id)?.medium_url)
      .filter((u): u is string => !!u);
    if (kommendeUrls.length > 0) void Image.prefetch(kommendeUrls);
  }, [phase, stand.index, spielliste, urls]);

  const ueberspringen = () => {
    setStand((s) => ({ ...s, pausiert: withoutReason(s.pausiert, 'zwischenkarte') }));
  };

  const beiLadefehler = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    setFehlgeschlagen((s) => new Set(s).add(postId));
  }, []);

  const onPressIn = () => {
    beruehrungStartRef.current = Date.now();
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = durationFor(moment);
    const vergangen = Math.min(dauer, Math.max(0, Date.now() - segmentStartRef.current));
    setStand((s) => ({ ...s, pausiert: withReason(s.pausiert, 'halten'), fortschritt: vergangen }));
  };

  const beendeBeruehrung = (seite: 'links' | 'rechts') => {
    const gehalten = Date.now() - beruehrungStartRef.current;
    if (gehalten < TAP_SCHWELLE_MS) {
      if (seite === 'rechts') {
        const ergebnis = advance(stand, spielliste.length);
        if (ergebnis === 'ende') {
          setPhase('ende');
          return;
        }
        setStand({ ...ergebnis, pausiert: withoutReason(ergebnis.pausiert, 'halten') });
        return;
      }
      const ergebnisZurueck = goBack(stand);
      setStand({ ...ergebnisZurueck, pausiert: withoutReason(ergebnisZurueck.pausiert, 'halten') });
      return;
    }
    // Halten, dann losgelassen: fortsetzen, nicht zum nächsten Moment springen.
    setStand((s) => ({ ...s, pausiert: withoutReason(s.pausiert, 'halten') }));
  };

  const nochmalAnsehen = () => {
    setStand({ index: 0, pausiert: new Set(), fortschritt: 0 });
    setPhase('bereit');
  };

  if (phase === 'laedt') {
    return (
      <View testID="teilen-laedt" style={styles.screen}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  if (phase === 'fehler') {
    return (
      <View testID="teilen-fehler" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>{fehlerText}</Text>
        <View style={{ marginTop: spacing.xl }}>
          <KinoButton label="Nochmal versuchen" onPress={() => void laden()} />
        </View>
        <Fussleiste />
      </View>
    );
  }

  if (phase === 'leer') {
    return (
      <View testID="teilen-leer" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>
          {reiseName ? `${reiseName} ist leer geblieben.` : 'Dieser Recap ist leer geblieben.'}
        </Text>
        <Fussleiste />
      </View>
    );
  }

  // Die Karte steht VOR der Ende-Phase: sie ist von dort aus erreichbar (die
  // Segment-Zeile steht auch über dem Abspann), und wer sie öffnet, will sie
  // sehen und nicht «Das war der Recap». `sichtbarerAusschnitt` ist die
  // einzige Bedingung, sie ist zugleich die, die der Typ verlangt, und die,
  // die den Einstieg überhaupt erst entstehen lässt (`kannKarte`).
  if (ansicht === 'karte' && sichtbarerAusschnitt) {
    return (
      // KEINE Kino-Fläche darunter: die Karte ist wie in der App ein helles
      // Werkzeug zum Finden, kein Medien-Vollbild (Spec §5.3). Die Kacheln
      // bringen ihre eigenen Farben mit, sie sind Inhalt wie ein Foto, nicht
      // Interface (Entscheid R2); bindend bleibt, was DARAUF liegt.
      <View testID="teilen-karte" style={styles.flaeche}>
        <MapSurface
          ref={karte}
          initialViewport={sichtbarerAusschnitt}
          clusters={gruppen}
          line={linie}
          thumbFor={thumbFuer}
          onCluster={aufGruppe}
          opensSheet={oeffnetSheet}
          onViewportChange={merkeAusschnitt}
          reducedMotion={reducedMotion}
        />

        {/* Die Momente, die keine Nadel tragen können (Spec K6). Eine Karte,
            auf der drei Momente einfach fehlen, ohne dass es jemand erfährt,
            lügt über die Reise.
            Anders als in der App eine reine AUSKUNFT ohne Sheet: dort ist die
            Karte ein eigener Screen, und ohne die Kachel-Liste wären diese
            Momente von dort aus gar nicht zu erreichen. Hier liegt der Weg zu
            ihnen eine Pillenbreite daneben, «Ansehen» spielt die ganze
            Reise, diese Momente eingeschlossen. Deshalb `pointerEvents:
            none`: die Zeile sagt etwas, sie verspricht nichts. */}
        {(withoutPlace.length > 0 || ausgelassen > 0) && (
          <View style={styles.leiste} pointerEvents="none">
            {/* Zwei verschiedene Lagen, deshalb zwei Sätze: «ohne Ort» sind
                Momente, die im Recap laufen, aber keine Nadel tragen können;
                «ausgelassen» sind Momente, die diese Seite gar nicht bekommen
                hat. Ohne den zweiten Satz ergäben Nadeln plus erste Zeile
                weniger als die Reise hat, und niemand sähe warum. */}
            {ausgelassen > 0 && (
              <Pill testID="teilen-ausgelassen" style={styles.leistePille}>
                <Text style={[type.secondary, { color: cinema['text-1'] }]}>
                  {ausgelassenText(ausgelassen)}
                </Text>
              </Pill>
            )}
            {withoutPlace.length > 0 && (
              <Pill style={styles.leistePille}>
                <Text style={[type.secondary, { color: cinema['text-1'] }]}>
                  {ohneOrtText(withoutPlace.length)}
                </Text>
              </Pill>
            )}
          </View>
        )}

        {/* Erst gemountet, wenn es etwas zu zeigen gibt: `Sheet` bringt seine
            Eintrittsanimation im Effekt mit (spring-ui, DESIGN-LANGUAGE §4),
            ein frisch gemountetes öffnet damit jedes Mal von unten. */}
        {sheet !== null && (
          <Sheet
            visible
            // Die Liste bekommt eine Überschrift, der einzelne Moment nicht:
            // dort ist das Bild der Kopf (Spec §5.7). Mehr als ein Punkt
            // heisst hier immer «alle auf derselben Koordinate», «an diesem
            // Ort» ist also wörtlich wahr.
            title={sheet.length > 1 ? `${sheet.length} Momente an diesem Ort` : undefined}
            onClose={() => setSheet(null)}
          >
            {sheet.length === 1 ? (
              <MomentSheetContent
                point={sheet[0]}
                imageUrl={sheetImageUrl(urls, sheet[0].moment.id)}
                form={SHEET_FORM}
                onView={abHier}
              />
            ) : (
              <ClusterSheetContent
                points={sheet}
                urls={urls}
                form={SHEET_FORM}
                onView={abHier}
              />
            )}
          </Sheet>
        )}

        {/* Zuletzt im Baum und mit dem höchsten zIndex: der Weg zurück in den
            Player darf von nichts verdeckt werden. */}
        <SegmentZeile aufKarte onWechsel={() => wechsleAnsicht('player')} oben={oben} />
      </View>
    );
  }

  if (phase === 'ende') {
    return (
      <View testID="teilen-ende" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>
          {reiseName ? `Das war der Recap von „${reiseName}".` : 'Das war der Recap.'}
        </Text>
        {/* «Das war der Recap» ist genau die Stelle, an der eine unvollständige
            Filmrolle es sagen muss, sonst behauptet der Abspann etwas, was
            nicht stimmt. */}
        {ausgelassen > 0 && (
          <Text style={[type.secondary, styles.zentrierterHinweis]}>{ausgelassenText(ausgelassen)}</Text>
        )}
        <View style={{ marginTop: spacing.xl }}>
          <KinoButton label="Nochmal ansehen" onPress={nochmalAnsehen} />
        </View>
        <Fussleiste />
        {kannKarte && (
          <SegmentZeile aufKarte={false} onWechsel={() => wechsleAnsicht('karte')} oben={oben} />
        )}
      </View>
    );
  }

  // phase === 'bereit', aktivMoment ist damit garantiert gesetzt (die Liste
  // ist an dieser Stelle nie leer, siehe laden()).
  if (!aktivMoment) return null;
  const url = urls.get(aktivMoment.id);
  const ortZeitText = aktivMoment.place_name
    ? `${aktivMoment.place_name} · ${timeInZone(aktivMoment.captured_at, aktivMoment.captured_tz)}`
    : timeInZone(aktivMoment.captured_at, aktivMoment.captured_tz);

  return (
    <View testID="teilen-bereit" style={styles.screen}>
      <MomentAnzeige
        key={aktivMoment.id}
        moment={aktivMoment}
        url={url}
        fehlgeschlagen={fehlgeschlagen.has(aktivMoment.id)}
        pausiert={gestoppt}
        onVideoEnde={() => videoZuEnde(aktivMoment.id)}
        onFehler={() => beiLadefehler(aktivMoment.id)}
      />

      {/* Der Kopf des PLAYERS rutscht unter die Segment-Zeile, sobald es sie
          gibt: die Zeile gehört dem Screen und steht deshalb oben, der
          Fortschritt und die Auskunft zum Moment gehören dem Player und
          stehen darunter. Ohne Karte bleibt alles, wo es war. */}
      <View
        style={[
          styles.kopfBereich,
          { top: kannKarte ? oben + SEGMENT_HOEHE + spacing.base : oben },
        ]}
        pointerEvents="none"
      >
        <ProgressBar
          count={spielliste.length}
          activeIndex={stand.index}
          durationMs={durationFor(aktivMoment)}
          elapsedMs={stand.fortschritt}
          paused={gestoppt}
        />
        <View style={styles.kopfReihe}>
          <Pill style={styles.namePille}>
            {/* 32 statt Avatars Default 36: unteres Ende der DESIGN-LANGUAGE-§4-
                Spanne (32–44 px), passend zur kompakten Kopf-Pille — dieselbe
                Grösse wie im nativen Player (player.tsx), dieselbe Grösse, die
                die gelöschte lokale AvatarInitiale-Kopie hier trug. */}
            <Avatar name={aktivMoment.authorName} avatarKey={aktivMoment.authorAvatarKey} cinemaMode size={32} />
            <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{aktivMoment.authorName}</Text>
          </Pill>
          <Pill style={styles.infoPille}>
            <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
          </Pill>
        </View>
      </View>

      {aktivMoment.caption && (
        <Pill testID="teilen-caption" style={styles.captionPille} pointerEvents="none">
          <Text style={[type.body, { color: cinema['text-1'] }]}>{aktivMoment.caption}</Text>
        </Pill>
      )}

      <Pressable
        testID="teilen-links"
        accessibilityRole="button"
        accessibilityLabel="Zurück zum vorherigen Moment"
        style={styles.tapZoneLinks}
        onPressIn={onPressIn}
        onPressOut={() => beendeBeruehrung('links')}
      />
      <Pressable
        testID="teilen-rechts"
        accessibilityRole="button"
        accessibilityLabel="Weiter zum nächsten Moment"
        style={styles.tapZoneRechts}
        onPressIn={onPressIn}
        onPressOut={() => beendeBeruehrung('rechts')}
      />

      {zwischenkarte && (
        <Pressable testID="teilen-zwischenkarte" style={styles.zwischenkarte} onPress={ueberspringen}>
          <Text style={[type.h1, styles.zentrierterText]}>
            {aktuellerTag ? tagesueberschrift(aktuellerTag) : 'Ein neuer Tag beginnt.'}
          </Text>
        </Pressable>
      )}

      <Fussleiste />

      {/* Zuletzt im Baum und mit dem höchsten zIndex, auch über der
          Tages-Zwischenkarte: der Wechsel auf die Karte soll nicht davon
          abhängen, ob gerade ein Tag anbricht. */}
      {kannKarte && (
        <SegmentZeile aufKarte={false} onWechsel={() => wechsleAnsicht('karte')} oben={oben} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  // Die Kartenansicht, ohne Kino-Hintergrund: darunter liegen die Kacheln,
  // und in der kurzen Spanne, bis sie da sind, soll kein schwarzer Kinosaal
  // aufblitzen (Spec §5.3: die Karte ist hell).
  flaeche: { flex: 1 },
  mitte: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen },
  zentrierterText: { color: cinema['text-1'], textAlign: 'center' },
  zentrierterHinweis: { color: cinema['text-2'], textAlign: 'center', marginTop: spacing.m },
  kinoButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
  // `top` kommt aus dem JSX: der Kopf des Players rutscht unter die
  // Segment-Zeile, sobald diese Reise eine Karte hat.
  kopfBereich: {
    position: 'absolute',
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
  captionPille: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    // xxl statt xl (Task-Review): lässt Raum für die Fussleiste (Reelive-
    // Wortzug + "Hol dir die App"), die weiter unten fix bei bottom:xs sitzt,
    // die Pille wächst von ihrem `bottom`-Anker aus NACH OBEN, kollidiert
    // also mit keiner Fusszeilen-Höhe, solange deren Gesamthöhe unter der
    // Differenz (xxl − xs) bleibt.
    bottom: spacing.xxl,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.control,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  tapZoneLinks: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', zIndex: 1 },
  tapZoneRechts: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', zIndex: 1 },
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
  fussleiste: {
    position: 'absolute',
    bottom: spacing.xs,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },

  // --- Die Karte (Spec §5.10) ---------------------------------------------

  // zIndex 3: über den Tipp-Zonen (1) UND über der Tages-Zwischenkarte (2).
  // Die Segment-Zeile ist der einzige Weg zwischen den beiden Lesarten, sie
  // darf von nichts verdeckt werden, was der Player gerade einblendet.
  // `top` kommt aus dem JSX (useOberkante).
  segmentZeile: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 3 },
  // Die Spur trägt das Polster, die Hälften darin ihre eigene Höhe: 36 + 2 × 4
  // ergibt die 44 Punkte, die auch Zurück-, Filter- und Namens-Pille haben.
  segmentSpur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.pill,
  },
  segmentAktiv: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cinema['text-1'],
  },
  segmentPassiv: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Die Auskunft über die Momente ohne Ort, mittig unten, dieselbe Stelle wie
  // die Leiste der App-Karte. Der Abstand nach unten ist der Screen-Rand
  // (DESIGN-LANGUAGE §3); die Namensnennung der Kacheln sitzt im Browser
  // darunter rechts (K14) und kommt sich mit einer zentrierten Pille nicht in
  // die Quere.
  leiste: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    alignItems: 'center',
    gap: spacing.s,
  },
  // Radius 12 statt Pille: hier stehen ganze Sätze, die zweizeilig umbrechen
  // dürfen, eine 999er-Rundung um zwei Textzeilen sieht aus wie ein Fehler.
  leistePille: {
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.control,
  },
});
