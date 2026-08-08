import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { PressScale } from '@/components/PressScale';
import { Fortschrittsbalken } from '@/components/Fortschrittsbalken';
import { Pille } from '@/components/Pille';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { loeseTokenAuf, LINK_TOT_TEXT, type GeteiltesMoment } from '@/features/teilen/shareApi';
import { sortiereMomente } from '@/features/recap/tage';
import {
  blockiertAutomatischenVorschub,
  dauerFuer,
  mitGrund,
  ohneGrund,
  tagWechselt,
  weiter,
  zurueck,
  type PauseGrund,
  type PlayerStand,
} from '@/features/recap/playerLogic';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { RecapMoment, RecapTag } from '@/features/recap/types';

// Öffentlicher, schreibgeschützter Web-Player (Task-5-Brief, Spec §5.2):
// zeigt dieselbe Story wie mobile/src/app/(tabs)/recap/[id]/player.tsx —
// Kino-Palette, Fortschrittsbalken, Tages-Trenner, Autor, Zeit, Ort,
// Caption. OHNE Emoji-Leiste, OHNE Kommentare, OHNE Melden, OHNE Login. Wird
// als EIGENER, kleinerer Screen gebaut statt den 1532-Zeilen-Player zu
// kopieren oder mit einem `nurAnschauen`-Schalter zu verbiegen — siehe
// Bericht für die Begründung. Wiederverwendet werden die fertigen,
// gereviewten Bausteine: Fortschrittsbalken, playerLogic (dauerFuer, weiter,
// zurueck, tagWechselt, PauseGrund/mitGrund/ohneGrund/
// blockiertAutomatischenVorschub) und tage.ts (gruppiereNachTagen,
// sortiereMomente) — UNVERÄNDERT, kein Import aus recapApi.ts/sozialApi.ts/
// AuthProvider (W4: nichts davon soll im Modulgraph dieses Screens
// überhaupt AUFTAUCHEN, nicht nur ungenutzt bleiben — siehe
// teilen/__tests__/modulgraph.test.ts).
//
// Bewusste Vereinfachungen gegenüber dem nativen Player (jeweils begründet
// im Bericht):
// - Kein Schliessen-Knopf, kein Wisch-nach-unten: es gibt keine "vorherige"
//   Route, zu der man zurückkehren könnte — die Seite IST die ganze
//   Web-Erfahrung (istWebGesperrt in guard.ts sperrt alles andere).
// - Kein Kino-Fade-Übergang beim Betreten: der bildet "das Licht geht aus"
//   beim Wechsel von einem HELLEN Screen ab — hier gibt es keinen
//   vorangehenden hellen Screen innerhalb dieser Sitzung, der Browser-Tab
//   lädt direkt in den Kinosaal.
// - Ein fehlgeschlagenes Foto/Video zeigt SOFORT die Hinweis-Pille (kein
//   unsichtbarer Neuversuch/V10-URL-Erneuerung wie im nativen Player): der
//   Vorrat kommt hier aus EINEM Aufruf ohne Session, ein zweiter,
//   still-nachsignierender Hintergrundaufruf wäre zusätzliche Komplexität
//   für einen Anwendungsfall (eine typischerweise binnen Minuten
//   durchgespielte Story), den der Task-Auftrag nicht verlangt.
const VORLADEN_ANZAHL = 3;
const ZWISCHENKARTE_DAUER_MS = 1500;
const TAP_SCHWELLE_MS = 250;

type LadePhase = 'laedt' | 'fehler' | 'leer' | 'bereit' | 'ende';
type MedienLink = { medium_url: string; thumb_url: string | null };

// Bildet die schareApi-Antwort auf die RecapMoment-Form ab, damit
// dauerFuer/gruppiereNachTagen/tagWechselt/sortiereMomente UNVERÄNDERT
// wiederverwendbar bleiben (sie sind auf RecapMoment[] typisiert). Die
// hier aufgefüllten Felder (id, trip_id, author_id, lat, lng,
// upload_status) liest KEINE der wiederverwendeten Funktionen jemals — id
// dient nur als stabiler Schlüssel (aus post_id), die übrigen sind reine
// Platzhalter, um die Form zu erfüllen. GeteiltesMoment führt lat/lng
// (noch) nicht mit — die Karte auf dieser Seite ist ein eigener, späterer
// Task.
function zuRecapMoment(m: GeteiltesMoment): RecapMoment {
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
    lat: null,
    lng: null,
    upload_status: 'uploaded',
    autor_name: m.autor_name,
  };
}

// Gleiche Formatierungen wie im nativen Player (player.tsx) — bewusst als
// eigene, kleine Kopie statt eines Imports: player.tsx exportiert diese
// Hilfsfunktionen nicht, und dieser Screen darf laut Auftrag nur seine
// eigenen Dateien anfassen, nicht player.tsx umbauen, um sie zu exportieren.
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

function KinoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}>
      <View style={styles.kinoButton}>
        <Text style={[type.bodyMedium, { color: cinema['bg-0'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

function AvatarInitiale({ name }: { name: string }) {
  return (
    <View style={styles.avatarKreis}>
      <Text style={[type.label, { color: cinema['text-1'] }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
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

// Dezenter Fussbereich (Brief: "unten dezent der Reelive-Wortzug und «Hol
// dir die App»", Konzept §5.9) — rein informativ, KEIN Knopf: es gibt noch
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
// Hinweis-Pille): hier zeigt der ERSTE Ladefehler direkt die Pille — siehe
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

export default function GeteilterRecapScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const [phase, setPhase] = useState<LadePhase>('laedt');
  const [fehlerText, setFehlerText] = useState<string | null>(null);
  const [reiseName, setReiseName] = useState('');
  const [startDate, setStartDate] = useState('');
  // Referenzstabil ab dem Moment, in dem laden() sie einmal setzt — tagWechselt
  // memoisiert über die ARRAY-REFERENZ, nicht über Inhalt/Länge (gleicher
  // Vertrag wie im nativen Player, playerLogic.ts).
  const [spielliste, setSpielliste] = useState<RecapMoment[]>([]);
  const [urls, setUrls] = useState<Map<string, MedienLink>>(new Map());
  const [stand, setStand] = useState<PlayerStand>({ index: 0, pausiert: new Set(), fortschritt: 0 });
  const [fehlgeschlagen, setFehlgeschlagen] = useState<Set<string>>(new Set());

  const aktiv = useRef(true);
  const segmentStartRef = useRef(0);
  const beruehrungStartRef = useRef(0);
  const aktivIdRef = useRef<string | undefined>(undefined);
  const pausiertRef = useRef<ReadonlySet<PauseGrund>>(new Set());

  const laden = useCallback(async () => {
    setPhase('laedt');
    setFehlerText(null);
    const { data, error } = await loeseTokenAuf(token);
    if (!aktiv.current) return;

    if (error || !data) {
      setFehlerText(error ?? LINK_TOT_TEXT);
      setPhase('fehler');
      return;
    }

    const liste = sortiereMomente(data.medien.map(zuRecapMoment));
    const urlMap = new Map<string, MedienLink>(
      data.medien.map((m) => [m.post_id, { medium_url: m.medium_url, thumb_url: m.thumb_url }])
    );
    setReiseName(data.reise.name);
    setStartDate(data.reise.start_date);
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

  // Medien-Screen (DESIGN-LANGUAGE v2 §1): feste Kino-Statusleiste — einmalig
  // beim Mount, kein useFocusEffect nötig (es gibt keine Geschwister-Route,
  // zu der man zurückkehren könnte, siehe Kopf-Kommentar).
  useEffect(() => {
    setStatusBarStyle('light');
  }, []);

  const aktivMoment = spielliste[stand.index];
  aktivIdRef.current = aktivMoment?.id;
  const zwischenkarte = stand.pausiert.has('zwischenkarte');
  const gestoppt = stand.pausiert.size > 0;
  pausiertRef.current = stand.pausiert;

  const tage = useMemo(() => gruppiereNachTagen(spielliste, startDate), [spielliste, startDate]);
  const aktuellerTag = useMemo(() => {
    if (!aktivMoment) return null;
    return tage.find((t) => t.momente.some((m) => m.id === aktivMoment.id)) ?? null;
  }, [tage, aktivMoment]);

  const weiterAutomatisch = useCallback(() => {
    const ergebnis = weiter(stand, spielliste.length);
    if (ergebnis === 'ende') {
      setPhase('ende');
      return;
    }
    // Ein echter Indexwechsel: 'halten' gehört zum VERLASSENEN Moment und
    // darf den neuen nicht blockieren (gleicher Vertrag wie im nativen
    // Player). 'zwischenkarte' bleibt unangetastet — der eigene Effekt
    // unten (Deps u.a. stand.index) verwaltet sie selbst.
    setStand({ ...ergebnis, pausiert: ohneGrund(ergebnis.pausiert, 'halten') });
  }, [stand, spielliste.length]);
  const weiterAutomatischRef = useRef(weiterAutomatisch);
  weiterAutomatischRef.current = weiterAutomatisch;

  const videoZuEnde = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    if (blockiertAutomatischenVorschub(pausiertRef.current)) return;
    weiterAutomatischRef.current();
  }, []);

  // Auto-Vorschub: EIN Timer für Fotos UND Videos (dauerFuer liefert für
  // beide eine sinnvolle Dauer) — für ein Video zugleich der Rückfall, falls
  // es nie lädt.
  useEffect(() => {
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
  // und steht 1,5 s, bevor sie selbst weiterschaltet.
  useEffect(() => {
    if (phase !== 'bereit') return;
    if (!tagWechselt(spielliste, startDate, stand.index)) {
      setStand((s) => (s.pausiert.has('zwischenkarte') ? { ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') } : s));
      return;
    }
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'zwischenkarte') }));
    const timer = setTimeout(() => {
      setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') }));
    }, ZWISCHENKARTE_DAUER_MS);
    return () => clearTimeout(timer);
  }, [phase, spielliste, startDate, stand.index]);

  // Vorladen der nächsten drei Fotos (Videos werden nicht vorgeladen, wie im
  // nativen Player — expo-video puffert selbst beim Mounten).
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
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'zwischenkarte') }));
  };

  const beiLadefehler = useCallback((postId: string) => {
    if (aktivIdRef.current !== postId) return;
    setFehlgeschlagen((s) => new Set(s).add(postId));
  }, []);

  const onPressIn = () => {
    beruehrungStartRef.current = Date.now();
    const moment = spielliste[stand.index];
    if (!moment) return;
    const dauer = dauerFuer(moment);
    const vergangen = Math.min(dauer, Math.max(0, Date.now() - segmentStartRef.current));
    setStand((s) => ({ ...s, pausiert: mitGrund(s.pausiert, 'halten'), fortschritt: vergangen }));
  };

  const beendeBeruehrung = (seite: 'links' | 'rechts') => {
    const gehalten = Date.now() - beruehrungStartRef.current;
    if (gehalten < TAP_SCHWELLE_MS) {
      if (seite === 'rechts') {
        const ergebnis = weiter(stand, spielliste.length);
        if (ergebnis === 'ende') {
          setPhase('ende');
          return;
        }
        setStand({ ...ergebnis, pausiert: ohneGrund(ergebnis.pausiert, 'halten') });
        return;
      }
      const ergebnisZurueck = zurueck(stand);
      setStand({ ...ergebnisZurueck, pausiert: ohneGrund(ergebnisZurueck.pausiert, 'halten') });
      return;
    }
    // Halten, dann losgelassen: fortsetzen, nicht zum nächsten Moment springen.
    setStand((s) => ({ ...s, pausiert: ohneGrund(s.pausiert, 'halten') }));
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

  if (phase === 'ende') {
    return (
      <View testID="teilen-ende" style={[styles.screen, styles.mitte]}>
        <Text style={[type.h2, styles.zentrierterText]}>
          {reiseName ? `Das war der Recap von „${reiseName}".` : 'Das war der Recap.'}
        </Text>
        <View style={{ marginTop: spacing.xl }}>
          <KinoButton label="Nochmal ansehen" onPress={nochmalAnsehen} />
        </View>
        <Fussleiste />
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

      <View style={styles.kopfBereich} pointerEvents="none">
        <Fortschrittsbalken
          anzahl={spielliste.length}
          aktivIndex={stand.index}
          dauerMs={dauerFuer(aktivMoment)}
          vergangenMs={stand.fortschritt}
          pausiert={gestoppt}
        />
        <View style={styles.kopfReihe}>
          <Pille style={styles.namePille}>
            <AvatarInitiale name={aktivMoment.autor_name} />
            <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>{aktivMoment.autor_name}</Text>
          </Pille>
          <Pille style={styles.infoPille}>
            <Text style={[type.secondary, { color: cinema['text-1'] }]}>{ortZeitText}</Text>
          </Pille>
        </View>
      </View>

      {aktivMoment.caption && (
        <Pille testID="teilen-caption" style={styles.captionPille} pointerEvents="none">
          <Text style={[type.body, { color: cinema['text-1'] }]}>{aktivMoment.caption}</Text>
        </Pille>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  mitte: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen },
  zentrierterText: { color: cinema['text-1'], textAlign: 'center' },
  kinoButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    backgroundColor: cinema['text-1'],
  },
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
  captionPille: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    // xxl statt xl (Task-Review): lässt Raum für die Fussleiste (Reelive-
    // Wortzug + "Hol dir die App"), die weiter unten fix bei bottom:xs sitzt
    // — die Pille wächst von ihrem `bottom`-Anker aus NACH OBEN, kollidiert
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
});
