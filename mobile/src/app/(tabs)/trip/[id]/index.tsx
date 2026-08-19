import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, useWindowDimensions, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Flag, Share2, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Avatar, AvatarGroup } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { TripCover } from '@/components/TripCover';
import { RevealSequence } from '@/components/RevealSequence';
import { Sheet, SHEET_SCROLL_RATIO } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteTrip, fetchMembers, fetchTrip, removeMember } from '@/features/trips/tripsApi';
import { formatRange, todaysCalendarDay, tripDay, tripLength } from '@/features/trips/tripDay';
import type { Trip, TripMember } from '@/features/trips/types';
import { ownMomentCount } from '@/features/moments/counter';
import * as queueDb from '@/features/moments/queueDb';
import { pendingCount } from '@/features/moments/queueLogic';
import type { QueueJob, DiscardedMoment } from '@/features/moments/types';
import { revealTrip } from '@/features/recap/recapApi';
import { markRevealSeen, hasSeenReveal } from '@/features/recap/seen';
import { getPool } from '@/features/recap/urlPool';
import { removeMoment, fetchReports, dismissReport, type Report } from '@/features/recap/reportApi';
import { isRecapShared } from '@/features/sharing/linkManagementApi';
import { LINK_REACH_TEXT } from '@/features/sharing/texts';

// DESIGN-LANGUAGE §5: destruktive Dialoge kündigen sich haptisch an (warning).
// Sparsam eingesetzt, nur die drei Dialoge dieses Screens. Ein fehlender
// Vibrationsmotor (Simulator, Web) darf den Dialog nie aufhalten, deshalb wird
// das Versprechen bewusst verworfen statt abgewartet.
function warnhaptik() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

// Task 10: die dezente Zeile unter dem Zähler, nur sichtbar, solange die
// Warteschlange für diese Reise nicht leer ist (siehe Render-Guard unten).
function wartendText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

// Final-Review, Important 9: Spec §8 verspricht, ein nach dem Reveal
// aufgenommener Moment werde «mit Erklärung verworfen». Bis zur Fix-Welle
// löschte der Worker den Job und schrieb eine Konsolenzeile, die betroffene
// Person erfuhr nie, dass ihre Aufnahme weg ist. Hier ist die Erklärung: neben
// dem Zähler und der Warten-Zeile, also dort, wo der Upload-Zustand dieser
// Reise ohnehin steht (Spec §7). Sie bleibt stehen, bis sie quittiert wird,
// eine Meldung, die von selbst verschwindet, ist keine Erklärung.
// Feste Referenz statt eines jedes Mal neuen Literals: `laden()` läuft bei
// jedem Fokussieren, und ein neues Array würde setVerworfen() jedes Mal einen
// Rerender auslösen, obwohl sich nichts geändert hat.
const KEINE_VERWORFENEN: DiscardedMoment[] = [];

function verworfenTitel(anzahl: number): string {
  return anzahl === 1 ? 'Ein Moment konnte nicht mehr eingesendet werden' : `${anzahl} Momente konnten nicht mehr eingesendet werden`;
}

// Review Important 1: die Zahl bleibt im Singular NICHT stehen, anders als bei
// wartendText oben («1 Moment ist …») folgt diese Zeile der Konvention von
// verworfenTitel(1) («Ein Moment …») weiter oben in dieser Datei: «Dein 1
// wartender Moment» ist grammatisch schief, «Dein wartender Moment» nicht.
// «Reveal» ersetzt durch «Aufdeckung» (DESIGN-LANGUAGE §6: Deutsch; dieselbe
// Formulierung steht schon in postsApi.ts/uploadWorker.ts/VERWORFEN_GRUND).
function wartendeMomenteBeruhigung(anzahl: number): string {
  return anzahl === 1
    ? 'Dein wartender Moment kommt noch durch, er ist vor der Aufdeckung entstanden.'
    : `Deine ${anzahl} wartenden Momente kommen noch durch, sie sind vor der Aufdeckung entstanden.`;
}

// Task 8, Phase 6: Moderation. Gleiche Singular/Plural-Konvention wie oben
// («Ein Moment …», nicht «1 Moment …»).
function meldungenText(anzahl: number): string {
  return anzahl === 1 ? 'Ein gemeldeter Moment' : `${anzahl} gemeldete Momente`;
}

// Zeitpunkt DER MELDUNG (reports.created_at), in Gerätezeit, anders als
// player.tsx/zeitInZone geht es hier nicht um den Moment selbst (dessen
// captured_tz), sondern darum, WANN die Owner-Person meldete. Ein
// unparsbarer Wert zeigt lieber nichts als abzustürzen (gleiches
// Verteidigungsprinzip wie player.tsx/zeitInZone).
function formatMeldezeit(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
}

// Eine Zeile der Moderationsliste: Vorschaubild, Grund, Zeitpunkt (Brief,
// wörtlich), dazu die zwei Aktionen. `laeuft` deckt BEIDE Aktionen ab (eine
// laufende Anfrage für diese Meldung, gleich welche), ersetzt die
// Aktionsreihe durch einen einzigen Ladeindikator, statt zu raten, welcher
// der beiden Knöpfe ihn zeigen sollte.
function MeldungZeile({
  meldung, vorschauUrl, laeuft, fehler, onEntfernen, onVerwerfen,
}: {
  meldung: Report;
  vorschauUrl: string | null;
  laeuft: boolean;
  fehler: string | undefined;
  onEntfernen: () => void;
  onVerwerfen: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View testID={`meldung-${meldung.id}`} style={[styles.meldungZeile, { borderBottomColor: colors.line }]}>
      <View style={styles.meldungKopf}>
        {vorschauUrl ? (
          <Image
            testID={`meldung-vorschau-${meldung.id}`}
            source={{ uri: vorschauUrl }}
            style={[styles.meldungBild, { backgroundColor: colors['bg-1'] }]}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.meldungBild, { backgroundColor: colors['bg-1'] }]} />
        )}
        <View style={styles.meldungText}>
          <Text style={[type.body, { color: colors['text-1'] }]}>{meldung.reason}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{formatMeldezeit(meldung.created_at)}</Text>
        </View>
      </View>
      {fehler && <Text style={[type.secondary, { color: colors.danger }]}>{fehler}</Text>}
      {laeuft ? (
        <ActivityIndicator testID={`meldung-laedt-${meldung.id}`} color={colors['text-1']} />
      ) : (
        <View style={styles.meldungAktionen}>
          <PressScale accessibilityRole="button" onPress={onVerwerfen}>
            <Text style={[type.bodyMedium, styles.meldungAktionText, { color: colors['text-1'] }]}>
              Meldung verwerfen
            </Text>
          </PressScale>
          <PressScale accessibilityRole="button" onPress={onEntfernen}>
            <Text style={[type.bodyMedium, styles.meldungAktionText, { color: colors.danger }]}>
              Moment entfernen
            </Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

// Kein Kasten und keine Warnfarbe: das ist kein Alarm, sondern eine fehlende
// Auskunft. Sie nennt Ursache und Weg, ohne sich zu entschuldigen
// (DESIGN-LANGUAGE §6).
const GETEILT_UNBEKANNT =
  'Ob dieser Recap geteilt ist, liess sich gerade nicht prüfen. Schau gleich nochmal rein.';

// Die Facepile zeigt nur Kreise, ein Screenreader hat daran nichts zu lesen.
// Das Label nennt deshalb beides: wozu sie da ist und wie viele es sind.
function mitreisendeLabel(anzahl: number): string {
  return `Wer dabei ist, ${anzahl} ${anzahl === 1 ? 'Person' : 'Personen'}`;
}

export default function ReiseDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  // Kein Header ueber diesem Screen: der Scroll-Inhalt begann bei den
  // gestalteten 24 und lag damit hinter Statusleiste und Insel.
  const oberkante = useTopInset(spacing.screen);
  // Deckelt die Mitreisenden-Liste im Sheet. Ohne Grenze wüchse sie bis an den
  // 85-%-Deckel des Panels und verlöre ihre letzten Zeilen ersatzlos, bei
  // einer grossen Reise ausgerechnet die zuletzt Beigetretenen (siehe
  // SHEET_SCROLL_ANTEIL in Sheet.tsx).
  const { height: fensterHoehe } = useWindowDimensions();
  // `cover` ist kein Datenparameter, sondern der Platz, den die angetippte
  // Karte in ihrer Liste hatte: Er sorgt dafür, dass hier dasselbe
  // Platzhalter-Bild steht wie auf der Karte (platzhalterCover.ts). Wer ohne
  // ihn hier landet — Deep Link, gerade angelegte Reise —, bekommt das erste
  // Bild. `Number(undefined)` ist NaN, deshalb der Rückfall auf 0.
  const { id, cover } = useLocalSearchParams<{ id: string; cover?: string }>();
  const coverPlatz = Number(cover) || 0;
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [mitglieder, setMitglieder] = useState<TripMember[]>([]);
  // Gleiche Dreiteilung wie in der Liste, [id]/einladen.tsx und join/[code].tsx:
  // `geladen` trennt «lädt noch» von «fertig», `fehler` trennt «nicht geladen»
  // von «gibt es nicht mehr». Ohne diese Trennung blieb bei einem Lesefehler
  // ein leerer weisser Screen ohne Erklärung und ohne Rückweg stehen, der
  // Stack hat keinen Header.
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [mitgliederFehler, setMitgliederFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // Task 10: der grosse Zähler zählt künftig den Serverstand PLUS wartende
  // Momente derselben Reise (eigenerZaehler statt trip.my_post_count), sonst
  // bliebe er nach einer Offline-Aufnahme stehen. `wartend` zählt separat nur
  // die Warteschlange dieser Reise, für die dezente Zeile darunter.
  const [zaehler, setZaehler] = useState(0);
  const [wartend, setWartend] = useState(0);
  const [verworfen, setVerworfen] = useState<DiscardedMoment[]>([]);
  // Task 8, Phase 6: Melden und Moderation. `meldungenAnzahl` ist ein weicher
  // Beiwert wie `zaehler`/`wartend` oben (RLS filtert für Nicht-Owner-Personen
  // ohnehin auf null Zeilen, ein Fehler hier degradiert still auf 0 statt den
  // ganzen Screen zu blockieren, siehe laden()). Die eigentliche Liste
  // (`meldungen`) lädt ERST beim Öffnen des Sheets, mit eigenem Fehlerzustand,
  // gleiches Prinzip wie TeilenSheetInhalt.
  const [meldungenAnzahl, setMeldungenAnzahl] = useState(0);
  // Die Mitreisenden-Verwaltung hinter der Facepile. Anders als beim
  // Moderations-Sheet gibt es hier nichts nachzuladen: `mitglieder` steht seit
  // laden() bereit, das Sheet zeigt nur, was der Screen ohnehin schon hat.
  const [mitgliederSichtbar, setMitgliederSichtbar] = useState(false);
  const [moderationSichtbar, setModerationSichtbar] = useState(false);
  const [moderationPhase, setModerationPhase] = useState<'laedt' | 'bereit' | 'fehler'>('laedt');
  const [moderationFehler, setModerationFehler] = useState<string | null>(null);
  const [meldungen, setMeldungen] = useState<Report[]>([]);
  // post_id -> Vorschau-URL (Thumbnail aus demselben Vorrat wie der Player,
  // holeVorrat/media-urls). `null` heisst "kein Thumbnail vorhanden", nicht
  // "noch nicht geladen", die Sheet-Phase trägt das Ladestadium bereits.
  const [vorschauUrls, setVorschauUrls] = useState<Map<string, string | null>>(new Map());
  // Die report_id der Meldung, für die GERADE eine Aktion läuft (verwerfen
  // ODER entfernen, gleich welche), deckt beide Knöpfe der Zeile ab, siehe
  // MeldungZeile oben.
  const [aktionLaeuftFuer, setAktionLaeuftFuer] = useState<string | null>(null);
  const [aktionFehler, setAktionFehler] = useState<Record<string, string>>({});
  // Task 8: Bestätigungs-Sheet für «Reise abschliessen». revealFehler bleibt
  // eigens vom Lade-`fehler` oben getrennt, ein gescheiterter Reveal darf den
  // Screen nicht so behandeln, als wäre die Reise nicht mehr ladbar.
  const [bestaetigenSichtbar, setBestaetigenSichtbar] = useState(false);
  const [revealLaedt, setRevealLaedt] = useState(false);
  const [revealFehler, setRevealFehler] = useState<string | null>(null);
  // Task 9, Reveal-Entdeckung (Versprechen V6: der Recap muss ohne Push
  // erreichbar sein). `laden()` prüft bei jedem Fokussieren selbst, ob die
  // Reise nicht mehr aktiv ist und die Inszenierung für sie schon gezeigt
  // wurde (gesehen.ts, persistiert). `inszenierungSichtbar` steuert nur die
  // Optik; `revealBereit` schaltet den Primär-Button «Recap starten» frei,
  // getrennt, weil eine schon gesehene Reise `revealBereit` sofort bekommt,
  // eine frische erst NACH der Inszenierung (siehe inszenierungFertig unten).
  const [inszenierungSichtbar, setInszenierungSichtbar] = useState(false);
  const [revealBereit, setRevealBereit] = useState(false);
  // Zwei getrennte Wächter statt einem (Review Important 3 am ursprünglichen
  // einzelnen Ref): `revealPruefungLaeuftRef` schützt nur den Moment WÄHREND
  // `revealGesehen()` noch aussteht, er verhindert, dass zwei überlappende
  // `laden()`-Aufrufe (z. B. ein zweiter durch `entfernen()`, während der
  // erste noch auf AsyncStorage wartet) den Speicher beide gleichzeitig
  // befragen. `revealEntschiedenRef` wird ERST gesetzt, NACHDEM eine
  // Entscheidung tatsächlich angewendet wurde (`setRevealBereit`/
  // `setInszenierungSichtbar`), genau DAS, nicht der In-Flight-Zustand, ist
  // was künftige `laden()`-Aufrufe von einem erneuten Check abhalten soll.
  //
  // Der ursprüngliche einzelne Ref wurde VOR dem `await revealGesehen(id)`
  // gesetzt (richtig gegen Nebenläufigkeit) und im Abbruchpfad
  // (`if (!aktiv.current) return`) NIE zurückgenommen: verlor der Screen
  // während des AsyncStorage-Lesens den Fokus (Tab-Wechsel, ein `push` auf
  // `/trip/[id]/invite`, der Screen bleibt dabei gemountet), blieb er
  // für den Rest dieses Mounts auf "true" hängen, ohne dass je `revealBereit`
  // oder `inszenierungSichtbar` gesetzt worden wäre, eine aufgedeckte Reise
  // hätte dann WEDER die Inszenierung NOCH «Recap starten» gezeigt. Mit der
  // Aufteilung bleibt nur `revealPruefungLaeuftRef` (unten wieder auf
  // `false` gesetzt, sobald `revealGesehen()` zurückkommt, VOR dem
  // `aktiv`-Check) über den Abbruch hinaus gesetzt; `revealEntschiedenRef`
  // bleibt `false`, ein späterer `laden()`-Aufruf (echtes Refokussieren)
  // versucht es also erneut.
  const revealPruefungLaeuftRef = useRef(false);
  const revealEntschiedenRef = useRef(false);
  // Schirmt setState nach Blur/Unmount ab, gleiches Muster wie in der
  // Listen-Schwesterdatei (reise/index.tsx): jeder Fokus-Zyklus bekommt seinen
  // eigenen Wächter, der beim Verlassen des Screens auf false gesetzt wird, damit
  // eine spät auflösende Ladeoperation keinen State mehr auf einen weggeklickten
  // Screen schreibt.
  const aktiv = useRef(true);

  // Ob der Recap gerade geteilt ist, fuer ALLE Mitreisenden sichtbar.
  //
  // Drei Werte, nicht zwei: `null` heisst «wir wissen es gerade nicht» und ist
  // ausdruecklich NICHT dasselbe wie `false`. Ein Netzfehler darf sich nicht
  // als Entwarnung ausgeben, das ist die eine Richtung, in die diese Auskunft
  // nie irren darf.
  const [geteilt, setGeteilt] = useState<boolean | null>(false);

  const laden = useCallback(async () => {
    const [t, m, z, jobs, abgelehnt, meldungenErgebnis] = await Promise.all([
      fetchTrip(id),
      fetchMembers(id),
      // Anders als fetchTrip/fetchMembers sind eigenerZaehler und
      // queueDb.alleJobs nicht garantiert werfensicher, sie lesen aus der
      // lokalen SQLite-Warteschlange, die bei einer beschädigten Datenbank
      // ablehnen kann (siehe queueDb.ts). Ohne dieses .catch() liesse eine
      // solche Ablehnung das ganze Promise.all scheitern, `geladen` würde
      // nie `true`, und der Screen bliebe dauerhaft leer, obwohl Reise und
      // Mitglieder längst da wären (Fix-Runde 1). Fällt einer der beiden
      // aus, zeigt der Screen eben den reinen Serverstand ohne Warten-Zeile
      // statt gar nichts.
      ownMomentCount(id).catch(() => null),
      queueDb.allJobs().catch((): QueueJob[] => []),
      // Gleicher Grund für das .catch() wie oben: eine beschädigte lokale
      // Datenbank darf den Screen nicht leer stehen lassen. Ohne userId gibt
      // es nichts abzufragen, verworfene Momente gehören immer einer Person.
      userId
        ? queueDb.discardedMoments(id, userId).catch(() => KEINE_VERWORFENEN)
        : Promise.resolve(KEINE_VERWORFENEN),
      // Task 8: ungefiltert nach Owner-Rolle aufgerufen, reports_select_owner
      // (RLS) liefert einer Nicht-Owner-Person ohnehin still null Zeilen,
      // kein Fehler. Der Einstiegspunkt unten rendert nur bei istOwner UND
      // meldungenAnzahl > 0, ein falsch positiver Treffer ist also
      // ausgeschlossen. fetchMeldungen wirft nie (gleicher Vertrag wie
      // fetchTrip/fetchMembers), kein .catch() nötig.
      fetchReports(id),
    ]);
    if (!aktiv.current) return;
    setTrip(t.data);
    setFehler(t.error);
    setMitglieder(m.data);
    setMitgliederFehler(m.error);
    setZaehler(z ?? t.data?.my_post_count ?? 0);
    setWartend(pendingCount(jobs.filter((job) => job.trip_id === id)));
    setVerworfen(abgelehnt);
    // Ein Ladefehler degradiert still auf 0 (Beiwert-Prinzip, siehe
    // Kommentar am State oben), das offene Moderation-Sheet (falls gerade
    // sichtbar) hat seinen EIGENEN, prominenten Fehlerzustand.
    setMeldungenAnzahl(meldungenErgebnis.error ? 0 : meldungenErgebnis.data.length);
    setGeladen(true);

    // Erst NACH dem Laden der Reise, und nur wenn sie ueberhaupt aufgedeckt
    // ist: vor dem Reveal entsteht gar kein Link (share-link/verwaltung.ts
    // lehnt ab), die Abfrage koennte also nur `false` liefern. Sie steht
    // deshalb bewusst nicht im Promise.all darueber, das fuer jede laufende
    // Reise eine Abfrage mehr bedeutete, die nie etwas sagt.
    if (t.data && t.data.status !== 'active') {
      const geteiltErgebnis = await isRecapShared(id);
      if (!aktiv.current) return;
      setGeteilt(geteiltErgebnis.data);
    } else {
      setGeteilt(false);
    }

    // Reveal-Entdeckung (V6): keine Benachrichtigung, kein Deep-Link, nur
    // die Tatsache, dass diese Reise beim (Wieder-)Öffnen nicht mehr 'active'
    // ist. Das trifft die Owner-Person direkt nach einem erfolgreichen
    // abschliessen() (derselbe laden()-Aufruf, siehe dort) genauso wie jedes
    // andere Mitglied, das die Reise irgendwann später wieder aufmacht, mit
    // oder ohne Push.
    if (
      t.data &&
      t.data.status !== 'active' &&
      !revealEntschiedenRef.current &&
      !revealPruefungLaeuftRef.current
    ) {
      revealPruefungLaeuftRef.current = true;
      const gesehen = await hasSeenReveal(id);
      // VOR dem aktiv-Check zurückgesetzt: der In-Flight-Zustand endet hier
      // so oder so, ob der Screen inzwischen den Fokus verloren hat oder
      // nicht, sonst bliebe er bei einem Abbruch hängen und würde jeden
      // späteren laden()-Aufruf blockieren (siehe Kommentar bei den Refs).
      revealPruefungLaeuftRef.current = false;
      if (!aktiv.current) return;
      // Ab hier gilt die Entscheidung als getroffen, erst JETZT, nicht
      // schon vor dem await, damit ein Abbruch oben sie erneut versuchen
      // lässt statt sie für den Rest dieses Mounts zu verhindern.
      revealEntschiedenRef.current = true;
      if (gesehen) {
        setRevealBereit(true);
      } else {
        setInszenierungSichtbar(true);
      }
    }
  }, [id, userId]);

  // Läuft, sobald die Inszenierung ihre volle Dauer gespielt hat (siehe
  // RevealInszenierung, success-Haptik und Timing sind dort schon
  // abgesichert). `id` statt `trip?.id`: stabile Referenz, unabhängig davon,
  // ob `trip` zwischen Start und Ende der Animation neu geladen wurde.
  const inszenierungFertig = useCallback(() => {
    setInszenierungSichtbar(false);
    setRevealBereit(true);
    void markRevealSeen(id);
  }, [id]);

  const zumRecap = () => {
    // Phase-5-Final-Review, Punkt 7: der Cast war eine Übergangslösung, so
    // lange `/recap/[id]/overview` in der generierten (gitignorten)
    // Routen-Liste fehlte, Task 11 hat die Route angelegt, `tsc` ist ohne
    // Cast sauber (siehe dasselbe Muster in recap/[id]/uebersicht.tsx:
    // `zumPlayer`, das exakt diese Begründung schon für `/recap/[id]/player`
    // dokumentiert).
    router.push({ pathname: '/recap/[id]/overview', params: { id } });
  };

  // Erst wenn die Erklärung tatsächlich gesehen und bestätigt wurde. Der
  // lokale Zustand geht sofort mit, damit die Meldung nicht bis zum nächsten
  // Laden stehen bleibt.
  const verworfeneQuittieren = useCallback(() => {
    if (!userId) return;
    setVerworfen(KEINE_VERWORFENEN);
    void queueDb.acknowledgeDiscarded(id, userId).catch(() => {});
  }, [id, userId]);

  // `laedt` hängt am Knopf, nicht am Fokus-Lauf: sichtbares Warten gehört nur
  // dorthin, wo jemand getippt hat. Zurückgesetzt wird es IMMER, auch wenn der
  // Screen zwischendurch den Fokus verliert, sonst käme der Knopf mit einem
  // toten Spinner und deaktiviert zurück. Ein `aktiv`-Guard ist dafür anders als
  // in `laden` nicht nötig: setState nach Unmount ist seit React 18 folgenlos.
  const nochmal = useCallback(async () => {
    setLaedt(true);
    await laden();
    setLaedt(false);
  }, [laden]);

  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  // Task-8-Brief §Der Reveal ist unumkehrbar: die Function ist idempotent, ein
  // zweiter Versuch nach einem Fehlschlag ist immer erlaubt, nichts wird
  // gesperrt, das Sheet bleibt bedienbar.
  const abschliessenOeffnen = () => {
    setRevealFehler(null);
    warnhaptik();
    setBestaetigenSichtbar(true);
  };

  const abschliessenSchliessen = () => {
    setBestaetigenSichtbar(false);
  };

  const abschliessen = async () => {
    setRevealLaedt(true);
    setRevealFehler(null);
    const { error } = await revealTrip(id);
    if (error) {
      setRevealFehler(error);
      setRevealLaedt(false);
      return;
    }
    setRevealLaedt(false);
    setBestaetigenSichtbar(false);
    // Reise neu laden: `trip.status` wechselt danach auf 'revealed', genau die
    // Vorbedingung, die Task 9 (Reveal-Entdeckung) an dieser Stelle prüft, um
    // seine Inszenierung auszulösen. Diese Datei kennt Task 9 noch nicht (er
    // läuft nach diesem Task), der Reload ist der Teil davon, der hier hingehört.
    void laden();
  };

  if (!geladen) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  if (!trip) {
    return (
      <View style={[styles.leer, { backgroundColor: colors['bg-0'] }]}>
        <Text style={[type.body, { color: colors.danger }]}>
          {fehler ?? 'Diese Reise gibt es nicht mehr.'}
        </Text>
        {fehler && (
          <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />
        )}
        <Button variant="text" label="Zu meinen Reisen" onPress={() => router.replace('/trip')} />
      </View>
    );
  }

  const istOwner = trip.owner_id === userId;
  const laeuft = trip.status === 'active';
  const heute = todaysCalendarDay();
  const tag = tripDay(trip.start_date, heute);
  const laenge = tripLength(trip.start_date, trip.end_date);
  // Task-8-Brief §Wo der Knopf sitzt: ab dem Enddatum (inklusive) rückt
  // «Reise abschliessen» nach oben. Beide Enden sind reine 'YYYY-MM-DD'-Daten,
  // ein Stringvergleich reicht (gleiches Prinzip wie in tripDay.ts).
  const reiseZuEnde = heute >= trip.end_date;
  const zeigtAbschliessen = istOwner && laeuft;

  // Zwei Wege führen hierher: der Knopf am Screen-Ende und der im
  // Mitreisenden-Sheet. Das Schliessen davor gilt für beide, es kostet den
  // Screen-Weg nichts (dort ist ohnehin nichts offen) und verhindert, dass
  // beim Zurückkommen vom Einladen-Screen ein Sheet über der Reise liegt,
  // das niemand mehr aufgemacht hat.
  const einladen = () => {
    setMitgliederSichtbar(false);
    router.push(`/trip/${id}/invite`);
  };

  const entfernen = (m: TripMember) => {
    warnhaptik();
    Alert.alert(`${m.display_name} entfernen?`, 'Bereits eingesendete Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void removeMember(id, m.user_id).then(({ error }) => {
            if (error) return Alert.alert('Nicht entfernt', error);
            void laden();
          });
        },
      },
    ]);
  };

  const verlassen = () => {
    warnhaptik();
    Alert.alert('Reise verlassen?', 'Deine bereits eingesendeten Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () => {
          if (!userId) return;
          void removeMember(id, userId).then(({ error }) => {
            if (error) return Alert.alert('Nicht verlassen', error);
            router.replace('/trip');
          });
        },
      },
    ]);
  };

  const loeschen = () => {
    warnhaptik();
    Alert.alert('Reise löschen?', 'Die Reise und alle Momente darin verschwinden für alle.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          void deleteTrip(id).then(({ error }) => {
            if (error) return Alert.alert('Nicht gelöscht', error);
            router.replace('/trip');
          });
        },
      },
    ]);
  };

  // Task 8, Phase 6: öffnet das Moderations-Sheet und lädt die Liste FRISCH
  // (nicht den bereits vorhandenen Zähler aus laden(), der könnte veraltet
  // sein, z.B. nachdem eine andere Sitzung längst etwas erledigt hat).
  // holeVorrat liefert die Vorschaubilder über denselben Vorrat wie der
  // Player (media-urls), ein Fehlschlag dort ist Beiwerk (leere/graue
  // Vorschau statt eines blockierenden Fehlers): die eigentliche Liste
  // (Grund, Zeitpunkt, Aktionen) bleibt davon unberührt.
  const moderationOeffnen = () => {
    setModerationSichtbar(true);
    setModerationPhase('laedt');
    setModerationFehler(null);
    setAktionFehler({});
    void Promise.all([fetchReports(id), getPool(id)]).then(([{ data: liste, error }, { vorrat }]) => {
      if (!aktiv.current) return;
      if (error) {
        setModerationFehler(error);
        setModerationPhase('fehler');
        return;
      }
      setMeldungen(liste);
      setMeldungenAnzahl(liste.length);
      const urls = new Map<string, string | null>();
      for (const m of liste) urls.set(m.post_id, vorrat?.urls.get(m.post_id)?.thumb_url ?? null);
      setVorschauUrls(urls);
      setModerationPhase('bereit');
    });
  };

  const moderationSchliessen = () => setModerationSichtbar(false);

  const meldungVerwerfen = (meldung: Report) => {
    setAktionLaeuftFuer(meldung.id);
    setAktionFehler((f) => {
      if (!(meldung.id in f)) return f;
      const naechste = { ...f };
      delete naechste[meldung.id];
      return naechste;
    });
    void dismissReport(meldung.id).then(({ error }) => {
      if (!aktiv.current) return;
      setAktionLaeuftFuer(null);
      if (error) {
        setAktionFehler((f) => ({ ...f, [meldung.id]: error }));
        return;
      }
      setMeldungen((liste) => liste.filter((m) => m.id !== meldung.id));
      setMeldungenAnzahl((n) => Math.max(0, n - 1));
    });
  };

  // Destruktiv (Alert.alert mit warnhaptik, gleiches Muster wie entfernen/
  // verlassen/loeschen oben), anders als «Meldung verwerfen» lässt sich
  // dies nicht rückgängig machen: der Moment verschwindet für ALLE
  // Mitreisenden, nicht nur aus der Moderationsliste.
  const momentEntfernen = (meldung: Report) => {
    warnhaptik();
    Alert.alert(
      'Moment entfernen?',
      'Der Moment verschwindet für alle Mitreisenden. Das lässt sich nicht rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            setAktionLaeuftFuer(meldung.id);
            void removeMoment(meldung.post_id).then(({ error }) => {
              if (!aktiv.current) return;
              setAktionLaeuftFuer(null);
              if (error) {
                setAktionFehler((f) => ({ ...f, [meldung.id]: error }));
                return;
              }
              // reports.post_id -> posts ist ON DELETE CASCADE (siehe
              // meldenApi.ts), die Meldung ist serverseitig bereits mit
              // verschwunden. Die Liste hier zieht clientseitig sofort nach.
              setMeldungen((liste) => liste.filter((m) => m.id !== meldung.id));
              setMeldungenAnzahl((n) => Math.max(0, n - 1));
            });
          },
        },
      ]
    );
  };

  return (
    // Fragment statt eines einzelnen Wurzelelements: das Sheet muss als
    // GESCHWISTER der ScrollView stehen, nicht als deren Kind, innerhalb der
    // ScrollView würde sein StyleSheet.absoluteFill sich auf die (potenziell
    // scrollbare, höhere) Inhaltsfläche beziehen statt auf den festen Screen.
    <>
    <ScrollView
      style={{ backgroundColor: colors['bg-0'] }}
      contentContainerStyle={[styles.inhalt, { paddingTop: oberkante }]}
    >
      <TripCover position={coverPlatz} sealed={laeuft} />

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {formatRange(trip.start_date, trip.end_date)}
        </Text>
        {laeuft && tag > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{`Tag ${tag} von ${laenge}`}</Text>
        )}

        {/* Wer mitfährt, direkt unter dem Zeitraum: drei Gesichter, der Rest
            wird gezählt (AvatarGroup). Ein Tipp öffnet die Liste, für die
            Owner-Person mitsamt Verwaltung.
            Der Ladefehler tritt an DIESE Stelle, nicht an eine andere: ohne
            ihn stünde hier stumm nichts, und der Screen behauptete, die Reise
            habe keine Mitreisenden. */}
        {mitgliederFehler ? (
          <Text style={[type.body, { color: colors.danger, marginTop: spacing.m }]}>{mitgliederFehler}</Text>
        ) : mitglieder.length > 0 ? (
          <PressScale
            testID="mitreisende-oeffnen"
            accessibilityRole="button"
            accessibilityLabel={mitreisendeLabel(mitglieder.length)}
            onPress={() => setMitgliederSichtbar(true)}
          >
            <View style={{ marginTop: spacing.m, alignSelf: 'flex-start' }}>
              <AvatarGroup
                faces={mitglieder.map((m) => ({ name: m.display_name, avatarKey: m.avatar_key }))}
              />
            </View>
          </PressScale>
        ) : null}
      </View>

      {/* Task-8-Brief §Wo der Knopf sitzt: ab dem Enddatum rückt der Auslöser
          hierher nach oben, mit einer ankündigenden Zeile davor. Vor dem
          Enddatum steht er stattdessen unten bei den anderen Aktionen. */}
      {zeigtAbschliessen && reiseZuEnde && (
        <View style={{ gap: spacing.m }}>
          <Text style={[type.body, { color: colors['text-2'] }]}>
            Eure Reise ist zu Ende. Zeit für den Recap.
          </Text>
          {/* Review-Nachtrag zu Task 8 (Important 3/M4 dieser Runde): solange
              das Sheet offen ist, trägt SEIN «Abschliessen» die Akzentfarbe,
              dieser Knopf hier tritt zurück, sonst stünden zwei Akzentflächen
              gleichzeitig im Baum (§7). */}
          <Button
            variant={bestaetigenSichtbar || mitgliederSichtbar ? 'secondary' : 'primary'}
            label="Reise abschliessen"
            onPress={abschliessenOeffnen}
          />
        </View>
      )}

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.display, { color: colors['text-1'] }]}>{String(zaehler)}</Text>
        <Text style={[type.body, { color: colors['text-2'] }]}>
          Momente eingefangen, bis zum Recap versiegelt.
        </Text>
        {wartend > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{wartendText(wartend)}</Text>
        )}
      </View>

      {/* Was jede mitreisende Person wissen sollte: der Recap steht gerade
          hinter einer oeffentlichen URL, und die zeigt seit Phase 7 auch die
          Orte, an denen die Momente entstanden sind. Bis hierher wusste das
          nur die Owner-Person, die den Link erstellt hat.
          Fuer ALLE sichtbar, nicht nur fuer Mitreisende: auch die
          Owner-Person soll die Lage im Screen ihrer Reise sehen und nicht
          erst im Teilen-Sheet nachschauen muessen. */}
      {geteilt === true && (
        <View testID="geteilt-hinweis" style={[styles.geteiltBox, { backgroundColor: colors['bg-1'] }]}>
          <Share2 size={20} color={colors['text-1']} strokeWidth={1.75} />
          <View style={styles.geteiltText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Dieser Recap ist geteilt</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{LINK_REACH_TEXT}</Text>
          </View>
        </View>
      )}

      {/* Und der Fall, in dem die Auskunft ausbleibt. Er bekommt eine eigene,
          zurueckhaltende Zeile statt gar nichts: «nicht geteilt» und «wir
          wissen es gerade nicht» sind zwei verschiedene Dinge, und das
          zweite als das erste auszugeben waere die eine Richtung, in die
          diese Zeile nie irren darf. */}
      {geteilt === null && (
        <Text testID="geteilt-unbekannt" style={[type.secondary, { color: colors['text-2'] }]}>
          {GETEILT_UNBEKANNT}
        </Text>
      )}

      {verworfen.length > 0 && (
        <View style={[styles.verworfenBox, { backgroundColor: colors['bg-1'] }]}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>
            {verworfenTitel(verworfen.length)}
          </Text>
          {/* Der Grund kommt aus der Policy-Ablehnung (postsApi) und ist schon
              deutscher Klartext nach DESIGN-LANGUAGE §6, Ursache statt Code. */}
          {verworfen.map((v) => (
            <Text key={v.id} style={[type.secondary, { color: colors['text-2'] }]}>
              {v.grund}
            </Text>
          ))}
          <Button variant="secondary" label="Verstanden" onPress={verworfeneQuittieren} />
        </View>
      )}

      {/* Task 8, Phase 6: nur für die Owner-Person, nur solange es etwas zu
          bearbeiten gibt, dieselbe Sichtbarkeitsregel wie verworfenBox
          oben (kein leerer Hinweis über nichts). */}
      {istOwner && meldungenAnzahl > 0 && (
        <PressScale
          testID="moderation-oeffnen"
          accessibilityRole="button"
          accessibilityLabel={meldungenText(meldungenAnzahl)}
          onPress={moderationOeffnen}
        >
          <View style={[styles.meldungenBox, { backgroundColor: colors['bg-1'] }]}>
            <Flag size={20} color={colors['text-1']} strokeWidth={1.75} />
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{meldungenText(meldungenAnzahl)}</Text>
          </View>
        </PressScale>
      )}

      {/* Die Aktionen sind EIN Block, nicht vier. Der Screen-Gap (spacing.xl)
          trennt Blöcke voneinander: Cover, Titel, Zähler, Hinweise. Zwischen
          Knöpfen, die zusammengehören, ist er zu viel, sie lasen sich dadurch
          als vier unabhängige Abschnitte. Innen deshalb spacing.m, aussen
          bleibt der grosse Abstand, der die Gruppe vom Zähler darüber und vom
          destruktiven Link darunter absetzt (§3: Flächentrennung über
          Weissraum, und der ist gestuft, nicht überall gleich). */}
      <View style={styles.aktionen}>
      {/* Review-Entscheidung zu §7 (genau EIN Primär-Button, nicht zwingend
          GENAU einer): vor dem Enddatum bleibt «Freunde einladen» primär,
          das ist die Aktion, die eine LAUFENDE Reise wirklich braucht, und
          «Reise abschliessen» steht als Outline unten, ohne zu drängen. Ab
          dem Enddatum (oben) dreht sich das um: «Reise abschliessen» wird
          primär, «Freunde einladen» tritt zurück. So trägt in jedem Zustand
          genau eine Fläche die Akzentfarbe, und die Betonung folgt dem, was
          gerade dran ist. */}
      {zeigtAbschliessen && !reiseZuEnde && (
        <Button variant="secondary" label="Reise abschliessen" onPress={abschliessenOeffnen} />
      )}
      {istOwner && laeuft && (
        <Button
          variant={reiseZuEnde || bestaetigenSichtbar || mitgliederSichtbar ? 'secondary' : 'primary'}
          label="Freunde einladen"
          onPress={einladen}
        />
      )}
      {/* Task 9, der Screen hatte nach dem Reveal bislang KEINEN
          Primär-Button. `revealBereit` und `laeuft` schliessen sich
          gegenseitig aus (Ersteres setzt status !== 'active' voraus,
          Letzteres status === 'active'), «Recap starten» ersetzt
          «Freunde einladen» als einzige Akzent-Fläche, statt eine zweite
          hinzuzufügen (§7). Für ALLE Mitglieder sichtbar, nicht nur für die
          Owner-Person, der Recap gehört der ganzen Gruppe.
          Review-Nachtrag: ein neuer, schmaler Pfad macht `bestaetigenSichtbar`
          und `revealBereit` gleichzeitig wahr, ein unabhängiger laden()-Lauf
          entdeckt einen Reveal (z. B. von einem zweiten Gerät ausgelöst),
          während DIESES Sheet noch offen steht und niemand es geschlossen
          hat. Auch hier tritt der Screen-Knopf zugunsten des Sheets zurück. */}
      {/* Bewusst OHNE `mitgliederSichtbar`, anders als die beiden Knöpfe
          darüber: das Mitreisenden-Sheet trägt seinen Einladen-Knopf nur bei
          laufender Reise, und `revealBereit` schliesst genau die aus. Die
          beiden können also gar nicht gleichzeitig eine Akzentfläche wollen,
          und ein Rücktritt hier liesse den Screen mit GAR keiner dastehen. */}
      {revealBereit && (
        <Button
          variant={bestaetigenSichtbar ? 'secondary' : 'primary'}
          label="Recap starten"
          onPress={zumRecap}
        />
      )}
      {istOwner && (
        <Button variant="secondary" label="Reise bearbeiten" onPress={() => router.push(`/trip/${id}/edit`)} />
      )}
      </View>

      {/* Bleibt ausserhalb der Gruppe: «Reise löschen»/«Reise verlassen» ist
          destruktiv und soll sich nicht versehentlich mit dem Knopf darüber
          verwechseln lassen. Der grosse Screen-Gap ist hier genau richtig. */}
      <Button
        variant="text"
        label={istOwner ? 'Reise löschen' : 'Reise verlassen'}
        onPress={istOwner ? loeschen : verlassen}
      />
    </ScrollView>

    <Sheet visible={bestaetigenSichtbar} title="Reise abschliessen?" onClose={abschliessenSchliessen}>
      {/* Review Important 1: «niemand mehr Momente einsenden» war sachlich
          falsch, posts_insert_member (20260803090300_sealing_rls.sql) lässt
          Nachzügler mit captured_at <= revealed_at ausdrücklich weiter zu, für
          ALLE Mitglieder, nicht nur den lokalen Warteschlangenstand dieser
          Person. Die Zeile sagt jetzt beides ehrlich: keine NEUEN Momente,
          aber schon aufgenommene kommen, von allen, noch durch. */}
      <Text style={[type.body, { color: colors['text-2'] }]}>
        Danach kann niemand mehr neue Momente aufnehmen. Bereits aufgenommene Momente von allen
        kommen noch durch, und alle sehen den Recap. Das lässt sich nicht rückgängig machen.
      </Text>
      {wartend > 0 && (
        <Text style={[type.secondary, { color: colors['text-2'] }]}>{wartendeMomenteBeruhigung(wartend)}</Text>
      )}
      {revealFehler && <Text style={[type.body, { color: colors.danger }]}>{revealFehler}</Text>}
      <Button variant="primary" label="Abschliessen" onPress={() => void abschliessen()} loading={revealLaedt} />
      <Button variant="secondary" label="Abbrechen" onPress={abschliessenSchliessen} disabled={revealLaedt} />
    </Sheet>

    {/* Wer dabei ist, hinter der Facepile oben. Gleiches GESCHWISTER-Prinzip
        wie die Sheets darum herum.
        Die Verwaltung hängt an `laeuft`, nicht nur an `istOwner`: nach dem
        Reveal ist das hier eine reine Auskunft. Einladen lehnt der Server für
        nicht-aktive Reisen ohnehin ab, und wer im Recap zu sehen ist, gehört
        zur Reise. */}
    <Sheet visible={mitgliederSichtbar} title="Wer dabei ist" onClose={() => setMitgliederSichtbar(false)}>
      <ScrollView style={{ maxHeight: fensterHoehe * SHEET_SCROLL_RATIO }}>
        <View style={{ gap: spacing.base }}>
          {mitglieder.map((m) => (
            <View key={m.user_id} style={styles.zeile}>
              <Avatar name={m.display_name} avatarKey={m.avatar_key} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{m.display_name}</Text>
                <Text style={[type.secondary, { color: colors['text-2'] }]}>
                  {m.role === 'owner' ? 'Hat die Reise angelegt' : `@${m.username}`}
                </Text>
              </View>
              {istOwner && laeuft && m.user_id !== userId && (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={`${m.display_name} entfernen`}
                  onPress={() => entfernen(m)}
                >
                  <X size={20} color={colors['text-2']} strokeWidth={1.75} />
                </PressScale>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      {istOwner && laeuft && <Button variant="primary" label="Freunde einladen" onPress={einladen} />}
    </Sheet>

    {/* Task 8, Phase 6: gleiches GESCHWISTER-Prinzip wie das Sheet oben. */}
    <Sheet visible={moderationSichtbar} title="Gemeldete Momente" onClose={moderationSchliessen}>
      {moderationPhase === 'laedt' ? (
        <ActivityIndicator testID="moderation-laedt" color={colors['text-1']} />
      ) : moderationPhase === 'fehler' ? (
        <View style={{ gap: spacing.base }}>
          <Text style={[type.body, { color: colors.danger }]}>{moderationFehler}</Text>
          <Button variant="secondary" label="Nochmal versuchen" onPress={moderationOeffnen} />
        </View>
      ) : meldungen.length === 0 ? (
        <Text style={[type.secondary, { color: colors['text-2'] }]}>Keine offenen Meldungen mehr.</Text>
      ) : (
        <ScrollView testID="moderation-liste" style={styles.moderationListe}>
          {meldungen.map((m) => (
            <MeldungZeile
              key={m.id}
              meldung={m}
              vorschauUrl={vorschauUrls.get(m.post_id) ?? null}
              laeuft={aktionLaeuftFuer === m.id}
              fehler={aktionFehler[m.id]}
              onVerwerfen={() => meldungVerwerfen(m)}
              onEntfernen={() => momentEntfernen(m)}
            />
          ))}
        </ScrollView>
      )}
    </Sheet>

    {/* Wie das Sheet: GESCHWISTER der ScrollView, nicht ihr Kind, ihr
        StyleSheet.absoluteFill soll den ganzen Bildschirm decken, nicht nur
        die (potenziell höhere, scrollbare) Inhaltsfläche. */}
    <RevealSequence visible={inszenierungSichtbar} onFinished={inszenierungFertig} />
    </>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.xl },
  leer: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  // Siehe Kommentar am Aktionsblock im JSX: Knöpfe, die zusammengehören,
  // stehen enger als die Blöcke des Screens.
  aktionen: { gap: spacing.m },
  // Abgesetzte Fläche statt Schatten (DESIGN-LANGUAGE §3: ein Schatten heisst
  // «schwebt»). Radius 12 wie jede andere Fläche dieser Grösse.
  verworfenBox: { borderRadius: radius.control, padding: spacing.base, gap: spacing.m },
  // Dieselbe Form wie meldungenBox darunter: Symbol links, Text rechts. Sie
  // ist KEIN Knopf, anders als jene, hier gibt es nichts anzutippen, die
  // Zeile ist eine Auskunft. Deshalb auch kein PressScale darum herum.
  geteiltBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.m,
    borderRadius: radius.control,
    padding: spacing.base,
  },
  geteiltText: { flex: 1, gap: spacing.xs },
  // Task 8, Phase 6: Moderation.
  meldungenBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    borderRadius: radius.control,
    padding: spacing.base,
  },
  moderationListe: { maxHeight: 420 },
  // borderBottomColor kommt inline aus useTheme() (siehe MeldungZeile), ein
  // Hairline-Ton ist ein Farbwert und gehört wie jeder andere Farbwert dieser
  // Codebase nicht fest in ein statisches StyleSheet (DESIGN-LANGUAGE §9:
  // „Nirgends feste Hex-Werte im Code, alles über Tokens").
  meldungZeile: { gap: spacing.s, paddingVertical: spacing.base, borderBottomWidth: 1 },
  meldungKopf: { flexDirection: 'row', gap: spacing.m },
  meldungBild: { width: 56, height: 56, borderRadius: radius.control },
  meldungText: { flex: 1, gap: spacing.xs },
  meldungAktionen: { flexDirection: 'row', gap: spacing.l },
  meldungAktionText: { textDecorationLine: 'underline' },
});
