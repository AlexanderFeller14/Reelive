import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Lock, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { RevealInszenierung } from '@/components/RevealInszenierung';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteTrip, fetchMembers, fetchTrip, removeMember } from '@/features/trips/tripsApi';
import { formatRange, tripDay, tripLength } from '@/features/trips/tripDay';
import type { Trip, TripMember } from '@/features/trips/types';
import { eigenerZaehler } from '@/features/moments/zaehler';
import * as queueDb from '@/features/moments/queueDb';
import { wartendeAnzahl } from '@/features/moments/queueLogic';
import type { QueueJob, VerworfenerMoment } from '@/features/moments/types';
import { revealTrip } from '@/features/recap/recapApi';
import { merkeRevealGesehen, revealGesehen } from '@/features/recap/gesehen';

// DESIGN-LANGUAGE §5: destruktive Dialoge kündigen sich haptisch an (warning).
// Sparsam eingesetzt — nur die drei Dialoge dieses Screens. Ein fehlender
// Vibrationsmotor (Simulator, Web) darf den Dialog nie aufhalten, deshalb wird
// das Versprechen bewusst verworfen statt abgewartet.
function warnhaptik() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

// Task 10: die dezente Zeile unter dem Zähler — nur sichtbar, solange die
// Warteschlange für diese Reise nicht leer ist (siehe Render-Guard unten).
function wartendText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

// Final-Review, Important 9: Spec §8 verspricht, ein nach dem Reveal
// aufgenommener Moment werde «mit Erklärung verworfen». Bis zur Fix-Welle
// löschte der Worker den Job und schrieb eine Konsolenzeile — die betroffene
// Person erfuhr nie, dass ihre Aufnahme weg ist. Hier ist die Erklärung: neben
// dem Zähler und der Warten-Zeile, also dort, wo der Upload-Zustand dieser
// Reise ohnehin steht (Spec §7). Sie bleibt stehen, bis sie quittiert wird —
// eine Meldung, die von selbst verschwindet, ist keine Erklärung.
// Feste Referenz statt eines jedes Mal neuen Literals: `laden()` läuft bei
// jedem Fokussieren, und ein neues Array würde setVerworfen() jedes Mal einen
// Rerender auslösen, obwohl sich nichts geändert hat.
const KEINE_VERWORFENEN: VerworfenerMoment[] = [];

function verworfenTitel(anzahl: number): string {
  return anzahl === 1 ? 'Ein Moment konnte nicht mehr eingesendet werden' : `${anzahl} Momente konnten nicht mehr eingesendet werden`;
}

// Review Important 1: die Zahl bleibt im Singular NICHT stehen — anders als bei
// wartendText oben («1 Moment ist …») folgt diese Zeile der Konvention von
// verworfenTitel(1) («Ein Moment …») weiter oben in dieser Datei: «Dein 1
// wartender Moment» ist grammatisch schief, «Dein wartender Moment» nicht.
// «Reveal» ersetzt durch «Aufdeckung» (DESIGN-LANGUAGE §6: Deutsch; dieselbe
// Formulierung steht schon in postsApi.ts/uploadWorker.ts/VERWORFEN_GRUND).
function wartendeMomenteBeruhigung(anzahl: number): string {
  return anzahl === 1
    ? 'Dein wartender Moment kommt noch durch — er ist vor der Aufdeckung entstanden.'
    : `Deine ${anzahl} wartenden Momente kommen noch durch — sie sind vor der Aufdeckung entstanden.`;
}

export default function ReiseDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [mitglieder, setMitglieder] = useState<TripMember[]>([]);
  // Gleiche Dreiteilung wie in der Liste, [id]/einladen.tsx und join/[code].tsx:
  // `geladen` trennt «lädt noch» von «fertig», `fehler` trennt «nicht geladen»
  // von «gibt es nicht mehr». Ohne diese Trennung blieb bei einem Lesefehler
  // ein leerer weisser Screen ohne Erklärung und ohne Rückweg stehen — der
  // Stack hat keinen Header.
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [mitgliederFehler, setMitgliederFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // Task 10: der grosse Zähler zählt künftig den Serverstand PLUS wartende
  // Momente derselben Reise (eigenerZaehler statt trip.my_post_count) — sonst
  // bliebe er nach einer Offline-Aufnahme stehen. `wartend` zählt separat nur
  // die Warteschlange dieser Reise, für die dezente Zeile darunter.
  const [zaehler, setZaehler] = useState(0);
  const [wartend, setWartend] = useState(0);
  const [verworfen, setVerworfen] = useState<VerworfenerMoment[]>([]);
  // Task 8: Bestätigungs-Sheet für «Reise abschliessen». revealFehler bleibt
  // eigens vom Lade-`fehler` oben getrennt — ein gescheiterter Reveal darf den
  // Screen nicht so behandeln, als wäre die Reise nicht mehr ladbar.
  const [bestaetigenSichtbar, setBestaetigenSichtbar] = useState(false);
  const [revealLaedt, setRevealLaedt] = useState(false);
  const [revealFehler, setRevealFehler] = useState<string | null>(null);
  // Task 9 — Reveal-Entdeckung (Versprechen V6: der Recap muss ohne Push
  // erreichbar sein). `laden()` prüft bei jedem Fokussieren selbst, ob die
  // Reise nicht mehr aktiv ist und die Inszenierung für sie schon gezeigt
  // wurde (gesehen.ts, persistiert). `inszenierungSichtbar` steuert nur die
  // Optik; `revealBereit` schaltet den Primär-Button «Recap starten» frei —
  // getrennt, weil eine schon gesehene Reise `revealBereit` sofort bekommt,
  // eine frische erst NACH der Inszenierung (siehe inszenierungFertig unten).
  const [inszenierungSichtbar, setInszenierungSichtbar] = useState(false);
  const [revealBereit, setRevealBereit] = useState(false);
  // Verhindert, dass ein erneuter Fokus-Lauf (laden() feuert bei JEDEM
  // Fokussieren) die eben getroffene Entscheidung nochmal trifft: ohne diesen
  // Wächter würde ein Fehlschlag von merkeRevealGesehen() (Speicher voll/
  // kaputt) die Inszenierung bei jedem weiteren Fokussieren DIESES
  // Bildschirm-Aufrufs erneut über die bereits sichtbare «Recap starten»-
  // Fläche legen — siehe Kommentar bei gesehen.ts. Über einen App-Neustart
  // hinweg (neuer Mount, neue Ref) bleibt der in Kauf genommene Rückfall
  // bestehen: dann läuft sie höchstens einmal zu viel, nie in einer Schleife.
  const revealPruefungAbgeschlossenRef = useRef(false);
  // Schirmt setState nach Blur/Unmount ab — gleiches Muster wie in der
  // Listen-Schwesterdatei (reise/index.tsx): jeder Fokus-Zyklus bekommt seinen
  // eigenen Wächter, der beim Verlassen des Screens auf false gesetzt wird, damit
  // eine spät auflösende Ladeoperation keinen State mehr auf einen weggeklickten
  // Screen schreibt.
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const [t, m, z, jobs, abgelehnt] = await Promise.all([
      fetchTrip(id),
      fetchMembers(id),
      // Anders als fetchTrip/fetchMembers sind eigenerZaehler und
      // queueDb.alleJobs nicht garantiert werfensicher — sie lesen aus der
      // lokalen SQLite-Warteschlange, die bei einer beschädigten Datenbank
      // ablehnen kann (siehe queueDb.ts). Ohne dieses .catch() liesse eine
      // solche Ablehnung das ganze Promise.all scheitern, `geladen` würde
      // nie `true`, und der Screen bliebe dauerhaft leer, obwohl Reise und
      // Mitglieder längst da wären (Fix-Runde 1). Fällt einer der beiden
      // aus, zeigt der Screen eben den reinen Serverstand ohne Warten-Zeile
      // statt gar nichts.
      eigenerZaehler(id).catch(() => null),
      queueDb.alleJobs().catch((): QueueJob[] => []),
      // Gleicher Grund für das .catch() wie oben: eine beschädigte lokale
      // Datenbank darf den Screen nicht leer stehen lassen. Ohne userId gibt
      // es nichts abzufragen — verworfene Momente gehören immer einer Person.
      userId
        ? queueDb.verworfene(id, userId).catch(() => KEINE_VERWORFENEN)
        : Promise.resolve(KEINE_VERWORFENEN),
    ]);
    if (!aktiv.current) return;
    setTrip(t.data);
    setFehler(t.error);
    setMitglieder(m.data);
    setMitgliederFehler(m.error);
    setZaehler(z ?? t.data?.my_post_count ?? 0);
    setWartend(wartendeAnzahl(jobs.filter((job) => job.trip_id === id)));
    setVerworfen(abgelehnt);
    setGeladen(true);

    // Reveal-Entdeckung (V6): keine Benachrichtigung, kein Deep-Link — nur
    // die Tatsache, dass diese Reise beim (Wieder-)Öffnen nicht mehr 'active'
    // ist. Das trifft die Owner-Person direkt nach einem erfolgreichen
    // abschliessen() (derselbe laden()-Aufruf, siehe dort) genauso wie jedes
    // andere Mitglied, das die Reise irgendwann später wieder aufmacht — mit
    // oder ohne Push. `revealPruefungAbgeschlossenRef` sorgt dafür, dass ein
    // erneuter Fokus-Lauf, während die erste Entscheidung noch nicht
    // abgeschlossen oder ihr Ergebnis noch nicht auf dem Schirm ist, sie
    // nicht ein zweites Mal trifft.
    if (t.data && t.data.status !== 'active' && !revealPruefungAbgeschlossenRef.current) {
      revealPruefungAbgeschlossenRef.current = true;
      const gesehen = await revealGesehen(id);
      if (!aktiv.current) return;
      if (gesehen) {
        setRevealBereit(true);
      } else {
        setInszenierungSichtbar(true);
      }
    }
  }, [id, userId]);

  // Läuft, sobald die Inszenierung ihre volle Dauer gespielt hat (siehe
  // RevealInszenierung — success-Haptik und Timing sind dort schon
  // abgesichert). `id` statt `trip?.id`: stabile Referenz, unabhängig davon,
  // ob `trip` zwischen Start und Ende der Animation neu geladen wurde.
  const inszenierungFertig = useCallback(() => {
    setInszenierungSichtbar(false);
    setRevealBereit(true);
    void merkeRevealGesehen(id);
  }, [id]);

  const zumRecap = () => {
    // Gleiche Übergangslösung wie in recap/index.tsx: `/recap/[id]/uebersicht`
    // fehlt noch in der generierten (gitignorten) Routen-Liste, solange Metro
    // seit Task 10 nicht neu gelaufen ist.
    router.push({ pathname: '/recap/[id]/uebersicht', params: { id } } as unknown as Href);
  };

  // Erst wenn die Erklärung tatsächlich gesehen und bestätigt wurde. Der
  // lokale Zustand geht sofort mit, damit die Meldung nicht bis zum nächsten
  // Laden stehen bleibt.
  const verworfeneQuittieren = useCallback(() => {
    if (!userId) return;
    setVerworfen(KEINE_VERWORFENEN);
    void queueDb.verworfeneQuittieren(id, userId).catch(() => {});
  }, [id, userId]);

  // `laedt` hängt am Knopf, nicht am Fokus-Lauf: sichtbares Warten gehört nur
  // dorthin, wo jemand getippt hat. Zurückgesetzt wird es IMMER, auch wenn der
  // Screen zwischendurch den Fokus verliert — sonst käme der Knopf mit einem
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
  // zweiter Versuch nach einem Fehlschlag ist immer erlaubt — nichts wird
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
    // läuft nach diesem Task) — der Reload ist der Teil davon, der hier hingehört.
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
        <Button variant="text" label="Zu meinen Reisen" onPress={() => router.replace('/reise')} />
      </View>
    );
  }

  const istOwner = trip.owner_id === userId;
  const laeuft = trip.status === 'active';
  const heute = new Date().toISOString().slice(0, 10);
  const tag = tripDay(trip.start_date, heute);
  const laenge = tripLength(trip.start_date, trip.end_date);
  // Task-8-Brief §Wo der Knopf sitzt: ab dem Enddatum (inklusive) rückt
  // «Reise abschliessen» nach oben. Beide Enden sind reine 'YYYY-MM-DD'-Daten,
  // ein Stringvergleich reicht (gleiches Prinzip wie in tripDay.ts).
  const reiseZuEnde = heute >= trip.end_date;
  const zeigtAbschliessen = istOwner && laeuft;

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
            router.replace('/reise');
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
            router.replace('/reise');
          });
        },
      },
    ]);
  };

  return (
    // Fragment statt eines einzelnen Wurzelelements: das Sheet muss als
    // GESCHWISTER der ScrollView stehen, nicht als deren Kind — innerhalb der
    // ScrollView würde sein StyleSheet.absoluteFill sich auf die (potenziell
    // scrollbare, höhere) Inhaltsfläche beziehen statt auf den festen Screen.
    <>
    <ScrollView style={{ backgroundColor: colors['bg-0'] }} contentContainerStyle={styles.inhalt}>
      <View style={{ aspectRatio: 3 / 2, borderRadius: radius.card, backgroundColor: colors['bg-1'], padding: spacing.m }}>
        {laeuft && (
          <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
        )}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {formatRange(trip.start_date, trip.end_date)}
        </Text>
        {laeuft && tag > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{`Tag ${tag} von ${laenge}`}</Text>
        )}
      </View>

      {/* Task-8-Brief §Wo der Knopf sitzt: ab dem Enddatum rückt der Auslöser
          hierher nach oben, mit einer ankündigenden Zeile davor. Vor dem
          Enddatum steht er stattdessen unten bei den anderen Aktionen. */}
      {zeigtAbschliessen && reiseZuEnde && (
        <View style={{ gap: spacing.m }}>
          <Text style={[type.body, { color: colors['text-2'] }]}>
            Eure Reise ist zu Ende. Zeit für den Recap.
          </Text>
          <Button variant="primary" label="Reise abschliessen" onPress={abschliessenOeffnen} />
        </View>
      )}

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.display, { color: colors['text-1'] }]}>{String(zaehler)}</Text>
        <Text style={[type.body, { color: colors['text-2'] }]}>
          Momente eingefangen — bis zum Recap versiegelt.
        </Text>
        {wartend > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{wartendText(wartend)}</Text>
        )}
      </View>

      {verworfen.length > 0 && (
        <View style={[styles.verworfenBox, { backgroundColor: colors['bg-1'] }]}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>
            {verworfenTitel(verworfen.length)}
          </Text>
          {/* Der Grund kommt aus der Policy-Ablehnung (postsApi) und ist schon
              deutscher Klartext nach DESIGN-LANGUAGE §6 — Ursache statt Code. */}
          {verworfen.map((v) => (
            <Text key={v.id} style={[type.secondary, { color: colors['text-2'] }]}>
              {v.grund}
            </Text>
          ))}
          <Button variant="secondary" label="Verstanden" onPress={verworfeneQuittieren} />
        </View>
      )}

      <View style={{ gap: spacing.m }}>
        <Text style={[type.h2, { color: colors['text-1'] }]}>Wer dabei ist</Text>
        {mitgliederFehler && (
          <Text style={[type.body, { color: colors.danger }]}>{mitgliederFehler}</Text>
        )}
        {mitglieder.map((m) => (
          <View key={m.user_id} style={styles.zeile}>
            <Avatar name={m.display_name} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{m.display_name}</Text>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                {m.role === 'owner' ? 'Hat die Reise angelegt' : `@${m.username}`}
              </Text>
            </View>
            {istOwner && m.user_id !== userId && (
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

      {/* Review-Entscheidung zu §7 (genau EIN Primär-Button, nicht zwingend
          GENAU einer): vor dem Enddatum bleibt «Freunde einladen» primär —
          das ist die Aktion, die eine LAUFENDE Reise wirklich braucht — und
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
          variant={reiseZuEnde ? 'secondary' : 'primary'}
          label="Freunde einladen"
          onPress={() => router.push(`/reise/${id}/einladen`)}
        />
      )}
      {/* Task 9 — der Screen hatte nach dem Reveal bislang KEINEN
          Primär-Button. `revealBereit` und `laeuft` schliessen sich
          gegenseitig aus (Ersteres setzt status !== 'active' voraus,
          Letzteres status === 'active') — «Recap starten» ersetzt
          «Freunde einladen» als einzige Akzent-Fläche, statt eine zweite
          hinzuzufügen (§7). Für ALLE Mitglieder sichtbar, nicht nur für die
          Owner-Person — der Recap gehört der ganzen Gruppe. */}
      {revealBereit && <Button variant="primary" label="Recap starten" onPress={zumRecap} />}
      {istOwner && (
        <Button variant="secondary" label="Reise bearbeiten" onPress={() => router.push(`/reise/${id}/bearbeiten`)} />
      )}
      <Button
        variant="text"
        label={istOwner ? 'Reise löschen' : 'Reise verlassen'}
        onPress={istOwner ? loeschen : verlassen}
      />
    </ScrollView>

    <Sheet sichtbar={bestaetigenSichtbar} titel="Reise abschliessen?" onSchliessen={abschliessenSchliessen}>
      {/* Review Important 1: «niemand mehr Momente einsenden» war sachlich
          falsch — posts_insert_member (20260803090300_sealing_rls.sql) lässt
          Nachzügler mit captured_at <= revealed_at ausdrücklich weiter zu, für
          ALLE Mitglieder, nicht nur den lokalen Warteschlangenstand dieser
          Person. Die Zeile sagt jetzt beides ehrlich: keine NEUEN Momente,
          aber schon aufgenommene kommen — von allen — noch durch. */}
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

    {/* Wie das Sheet: GESCHWISTER der ScrollView, nicht ihr Kind — ihr
        StyleSheet.absoluteFill soll den ganzen Bildschirm decken, nicht nur
        die (potenziell höhere, scrollbare) Inhaltsfläche. */}
    <RevealInszenierung sichtbar={inszenierungSichtbar} onFertig={inszenierungFertig} />
    </>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.xl },
  leer: { flex: 1, justifyContent: 'center', padding: spacing.screen, gap: spacing.l },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  // Abgesetzte Fläche statt Schatten (DESIGN-LANGUAGE §3: ein Schatten heisst
  // «schwebt»). Radius 12 wie jede andere Fläche dieser Grösse.
  verworfenBox: { borderRadius: radius.control, padding: spacing.base, gap: spacing.m },
});
