import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { ChevronLeft, Download, Share2 } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useOberkante } from '@/theme/useOberkante';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchTrip } from '@/features/trips/tripsApi';
import type { Trip } from '@/features/trips/types';
import { fetchRecapMomente } from '@/features/recap/recapApi';
import { sichereAlleInGalerie, type AlleErgebnis, type AlleFortschritt } from '@/features/recap/exportApi';
import { gruppiereNachTagen } from '@/features/recap/tage';
import type { RecapMoment, RecapTag } from '@/features/recap/types';
import { holeVorrat, type MedienUrl, type Vorrat } from '@/features/recap/urlVorrat';
import { TeilenSheetInhalt } from '@/features/teilen/TeilenSheetInhalt';

// Nur der Tag selbst — nicht der Wochentag, den will hier niemand wissen.
const MONATE_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatTagesdatum(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONATE_LANG[m - 1]}`;
}

// «Tag 3 · Lissabon · 12. August» (Brief/Spec §8.3). Der Ort entfällt, wenn
// keiner der Momente einen `place_name` trägt (tage.ortDesTages liefert dann
// `null`) — kein erfundener Platzhaltertext.
//
// Bewusst NUR `tag.datum` und `tag.nummer` gelesen, nie `captured_at`/
// `captured_tz` eines einzelnen Moments dieses Tages: bei einer Reise
// ostwärts über die Datumsgrenze kann `tag.datum` vom eigenen Ortsdatum
// EINZELNER Momente abweichen, die die monotone Tagesvergabe in diesen Tag
// gezogen hat (siehe Kommentarkopf von tage.ts). `tag.datum` ist trotzdem
// die einzig ehrliche Angabe für DEN TAG als Ganzes — eine Überschrift, die
// stattdessen das Datum irgendeines seiner Momente anzeigt, würde für genau
// diese Momente lügen.
function tagesueberschrift(tag: RecapTag): string {
  const teile = [`Tag ${tag.nummer}`];
  if (tag.ort) teile.push(tag.ort);
  teile.push(formatTagesdatum(tag.datum));
  return teile.join(' · ');
}

// Gleiche Formulierung wie `wartendText` im Schwester-Screen
// (reise/[id]/index.tsx) für denselben Zustand — «hochladen» steht in
// DESIGN-LANGUAGE §6 auf der Nie-Liste des Vokabulars («einsenden», nie
// «hochladen»); der Brief hatte den Satz nur als Beispiel vorgegeben, nicht
// als Zitat (Review Task 10, Kleinigkeit). Singular/Plural wie überall sonst
// im Projekt: die Zahl bleibt auch im Singular stehen.
function unterwegsText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment ist' : 'Momente sind'} noch unterwegs.`;
}

// Task-10-Brief, zweiter Hinweis: `ausgelassen` ist etwas ANDERES als
// «wartet noch auf Upload» — die Function hat für diese Momente eine URL
// versucht und keine bekommen (kaputtes/fehlendes Objekt, Signierfehler).
// Eine ehrliche Zeile statt einer Fehlernummer: sie sagt, was die Person tun
// kann (später nochmal reinschauen), ohne eine Ursache zu erfinden, die
// niemand von hier aus kennt.
function ausgelassenText(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? 'Moment liess' : 'Momente liessen'} sich gerade nicht laden. Schau später nochmal rein.`;
}

// Task 7, ehrliche Bilanz (Brief, wörtlich: "Nicht «fertig», wenn drei
// Dateien fehlen"): nennt IMMER die tatsächlichen Zahlen, nie ein
// pauschales "fertig" — auch bei einem Abbruch oder bei Fehlschlägen.
function bilanzText(ausgang: Extract<AlleErgebnis, { status: 'fertig' }>): string {
  if (ausgang.abgebrochen) {
    const teile = [`Abgebrochen bei ${ausgang.gesichert} von ${ausgang.gesamt} Momenten.`];
    if (ausgang.fehlgeschlagen > 0) {
      teile.push(`${ausgang.fehlgeschlagen} ${ausgang.fehlgeschlagen === 1 ? 'ist' : 'sind'} dabei fehlgeschlagen.`);
    }
    return teile.join(' ');
  }
  if (ausgang.fehlgeschlagen === 0) {
    return `${ausgang.gesichert} von ${ausgang.gesamt} Momenten gesichert.`;
  }
  return `${ausgang.gesichert} von ${ausgang.gesamt} Momenten gesichert. ${ausgang.fehlgeschlagen} ${ausgang.fehlgeschlagen === 1 ? 'ist' : 'sind'} fehlgeschlagen.`;
}

// Ruhige bg-1-Fläche mit Opacity-Puls (DESIGN-LANGUAGE §4: "Skeleton:
// bg-1-Blöcke, Opacity-Puls 0.6 ↔ 1.0, kein Gradient-Shimmer"). Reine
// Presentation, deshalb lokal statt als eigene Komponentendatei — nichts
// davon wird ausserhalb dieses Screens gebraucht.
function SkelettBlock({ style }: { style: object }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.8);
      return;
    }
    const puls = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.duration.gentle, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: motion.duration.gentle, useNativeDriver: true }),
      ])
    );
    puls.start();
    return () => puls.stop();
  }, [reducedMotion, opacity]);

  return <Animated.View style={[style, { backgroundColor: colors['bg-1'], opacity }]} />;
}

function SkelettScreen() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xl);
  return (
    <View testID="recap-skeleton" style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <View style={[styles.inhalt, { paddingTop: oben }]}>
        <SkelettBlock style={{ width: 160, height: 30, borderRadius: radius.control }} />
        <View style={[styles.kachelRaster, { marginTop: spacing.xl }]}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkelettBlock key={i} style={styles.kachel} />
          ))}
        </View>
      </View>
    </View>
  );
}

function TagesAbschnitt({
  tag, urls, indexById, onTip,
}: {
  tag: RecapTag;
  urls: Map<string, MedienUrl>;
  indexById: Map<string, number>;
  onTip: (index: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.m }}>
      <Text style={[type.h2, { color: colors['text-1'] }]}>{tagesueberschrift(tag)}</Text>
      <View style={styles.kachelRaster}>
        {tag.momente.map((m) => {
          const url = urls.get(m.id);
          const index = indexById.get(m.id);
          // Beide sind für jeden Moment in `tag.momente` garantiert gesetzt:
          // `tag` kommt aus gruppiereNachTagen(mitBild, …), `indexById` ist
          // aus genau demselben `mitBild` gebaut (siehe unten) — ein Moment
          // ohne Bild taucht in `tag.momente` gar nicht erst auf.
          if (!url || index === undefined) return null;
          return (
            <PressScale
              key={m.id}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel={`Moment ${index + 1} öffnen`}
              testID={`recap-kachel-${m.id}`}
              onPress={() => onTip(index)}
            >
              <View style={[styles.kachel, { backgroundColor: colors['bg-1'] }]}>
                <Image
                  testID={`recap-bild-${m.id}`}
                  source={{ uri: url.thumb_url ?? url.medium_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                />
              </View>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

// Inhalt des «Alle sichern»-Fortschritts-Sheets (Task 7) — helle Variante
// (uebersicht.tsx ist, anders als der Recap-Player, ein Licht-Screen, siehe
// DESIGN-LANGUAGE §1: nur Kamera/Preview/Versiegeln/Player sind Kino), lokal
// statt einer eigenen Datei (Brief nennt für Task 7 nur exportApi.ts als
// neue Datei).
function ExportSheetInhalt({
  stand, ausgang, onAbbrechen, onFertig,
}: {
  stand: AlleFortschritt;
  ausgang: AlleErgebnis | null;
  onAbbrechen: () => void;
  onFertig: () => void;
}) {
  const { colors } = useTheme();

  if (ausgang === null) {
    return (
      <View style={{ gap: spacing.base }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
          <ActivityIndicator testID="export-laedt" color={colors['text-1']} />
          <Text style={[type.body, { color: colors['text-1'] }]}>
            {stand.erledigt} von {stand.gesamt} gesichert
          </Text>
        </View>
        <Button variant="secondary" label="Abbrechen" onPress={onAbbrechen} />
      </View>
    );
  }

  if (ausgang.status === 'keine_berechtigung') {
    return (
      <View style={{ gap: spacing.base }}>
        <Text style={[type.body, { color: colors['text-1'] }]}>{ausgang.text}</Text>
        <Button variant="primary" label="Einstellungen öffnen" onPress={() => void Linking.openSettings()} />
        <Button variant="text" label="Schliessen" onPress={onFertig} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.base }}>
      <Text testID="export-bilanz" style={[type.body, { color: colors['text-1'] }]}>
        {bilanzText(ausgang)}
      </Text>
      <Button variant="primary" label="Fertig" onPress={onFertig} />
    </View>
  );
}

export default function RecapUebersicht() {
  const { colors } = useTheme();
  const oben = useOberkante(spacing.xl);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [momente, setMomente] = useState<RecapMoment[]>([]);
  const [vorrat, setVorrat] = useState<Vorrat | null>(null);
  // Task-6-Brief: «Recap teilen» erscheint nur für die Owner-Person und nur
  // bei status==='revealed' — die UI blendet nur aus, share-link/index.ts
  // (Aktion 'erstellen') prüft beides server-seitig noch einmal
  // (CLAUDE.md-Eckpfeiler: die Versiegelung wird serverseitig erzwungen).
  const [teilenOffen, setTeilenOffen] = useState(false);
  // Task 7: «Alle sichern». `exportAusgang===null` heisst "läuft noch"
  // (inkl. des allerersten Augenblicks nach dem Öffnen) — erst ein
  // tatsächliches AlleErgebnis beendet die laufende Ansicht, siehe Sheet-
  // Inhalt unten.
  const [exportOffen, setExportOffen] = useState(false);
  const [exportStand, setExportStand] = useState<AlleFortschritt>({ erledigt: 0, gesamt: 0 });
  const [exportAusgang, setExportAusgang] = useState<AlleErgebnis | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  // Gleiche Dreiteilung wie überall sonst im Projekt: `geladen` trennt «lädt
  // noch» von «fertig», `fehler` bündelt den ersten Fehlschlag der drei
  // parallelen Abrufe (Reise, Momente, Vorrat) — Priorität Reise vor Vorrat
  // vor Momenten, weil eine kaputte Reise-Abfrage die anderen beiden
  // ohnehin bedeutungslos macht.
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const [{ data: t, error: tFehler }, { data: m, error: mFehler }, { vorrat: v, error: vFehler }] = await Promise.all([
      fetchTrip(id),
      fetchRecapMomente(id),
      holeVorrat(id),
    ]);
    if (!aktiv.current) return;
    setTrip(t);
    setMomente(m);
    setVorrat(v);
    setFehler(tFehler ?? vFehler ?? mFehler ?? null);
    setGeladen(true);
  }, [id]);

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

  const zurueck = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/recap');
  };

  const zurKarte = () => {
    router.push({ pathname: '/recap/[id]/karte', params: { id } });
  };

  const zumPlayer = (index: number) => {
    // Task 11 hat die Route angelegt und die Typen wurden neu erzeugt — der
    // frühere Cast auf `Href` (Übergangslösung, solange die Route fehlte) ist
    // damit hinfällig und entfernt, die Navigation ist wieder typgeprüft.
    router.push({ pathname: '/recap/[id]/player', params: { id, start: String(index) } });
  };

  if (!geladen) return <SkelettScreen />;

  // Vorgezogen aus dem ursprünglichen Anschluss an den `!trip`-Check: `kopf`
  // (unten) braucht `mitBild.length`, um den «Alle sichern»-Knopf auszu-
  // blenden, wenn es nichts zu sichern gibt — UND `kopf` wird selbst noch
  // VOR dem `!trip`-Check gebraucht (Wiederverwendung im "Reise gibt es
  // nicht mehr"-Zweig). Die Berechnung selbst braucht `trip` nicht wirklich
  // (nur `tage` weiter unten tut das, wegen `trip.start_date`) — sie bleibt
  // deshalb sicher berechenbar, auch während `trip` noch null sein könnte.
  const urls = vorrat?.urls ?? new Map<string, MedienUrl>();
  const uploaded = momente.filter((m) => m.upload_status === 'uploaded');
  const mitBild = uploaded.filter((m) => urls.has(m.id));
  const indexById = new Map(mitBild.map((m, i) => [m.id, i] as const));

  // Startet «Alle sichern»: öffnet das Fortschritts-Sheet SOFORT (bevor die
  // erste Berechtigungsprüfung überhaupt zurück ist) — ein Tipp muss immer
  // sichtbar reagieren, nie ein still hängender Knopf sein.
  const alleSichern = () => {
    const eintraege = mitBild.map((m) => ({ moment: m, url: urls.get(m.id)! }));
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportAusgang(null);
    setExportStand({ erledigt: 0, gesamt: eintraege.length });
    setExportOffen(true);
    void sichereAlleInGalerie(eintraege, (stand) => setExportStand(stand), controller.signal).then((ausgang) => {
      if (!aktiv.current) return;
      setExportAusgang(ausgang);
    });
  };

  const exportAbbrechen = () => {
    exportAbortRef.current?.abort();
  };

  // Ein Schliessen WÄHREND der Export noch läuft (Wisch/Tipp auf den
  // Hintergrund, siehe Sheet.tsx) ist implizit ein Abbrechen — ein
  // laufender Export, den niemand mehr sieht, wäre kein stiller Fehlschlag,
  // aber ein stiller WEITERLAUF, den die Person nicht mehr steuern könnte.
  const exportSchliessen = () => {
    if (exportAusgang === null) exportAbortRef.current?.abort();
    setExportOffen(false);
  };

  // `trip` ist an dieser Stelle noch nicht auf null geprüft (kopf wird auch
  // im "Reise gibt es nicht mehr"-Zweig unten wiederverwendet) — `trip &&`
  // lässt beide Knöpfe dort automatisch weg, ohne einen zweiten `kopf`
  // pflegen zu müssen.
  const kannTeilen = !!trip && trip.owner_id === userId && trip.status === 'revealed';
  // «Alle sichern» steht jedem Mitglied offen (kein Owner-Vorbehalt wie beim
  // Teilen, Brief) — nur ausgeblendet, wenn es buchstäblich nichts zu
  // sichern gibt.
  const kannExportieren = !!trip && mitBild.length > 0;
  // Spec K10/R3: für eine noch versiegelte Reise gibt es die Segment-Zeile
  // nicht. Eine Karte der laufenden Reise würde verraten, wo die anderen
  // gerade waren — und genau das ist die Versiegelung. Serverseitig ist es
  // ohnehin erzwungen (`posts_select_revealed_members` lässt Mitglieder erst
  // bei status in ('revealed','archived') lesen), der Client darf den Weg
  // trotzdem gar nicht erst anbieten.
  //
  // Als Positivliste geschrieben, nicht als `!== 'active'` (so stand es im
  // Task-Brief, siehe Bericht): beides ist heute dasselbe, weil `TripStatus`
  // genau diese drei Werte kennt. Käme je ein vierter dazu, entschiede die
  // Schreibweise darüber, was er beim Übersehen erbt — bei `!==` die Karte,
  // hier ihr Fehlen. Für die Versiegelung ist «im Zweifel zu» die einzige
  // vertretbare Voreinstellung, und diese Zeile spiegelt damit wörtlich die
  // Bedingung der Server-Policy.
  //
  // Kein Owner-Vorbehalt wie beim Teilen: jedes Mitglied liest denselben
  // Recap, die Karte ist bloss eine zweite Lesart davon.
  const kannKarte = !!trip && (trip.status === 'revealed' || trip.status === 'archived');

  const kopf = (
    <View style={styles.kopfzeile}>
      <PressScale accessibilityRole="button" accessibilityLabel="Zurück" onPress={zurueck}>
        <ChevronLeft size={24} color={colors['text-1']} strokeWidth={1.75} />
      </PressScale>
      <View style={styles.kopfAktionen}>
        {kannExportieren && (
          <PressScale
            testID="uebersicht-alle-sichern-oeffnen"
            accessibilityRole="button"
            accessibilityLabel="Alle sichern"
            onPress={alleSichern}
          >
            <Download size={22} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
        )}
        {kannTeilen && (
          <PressScale
            testID="uebersicht-teilen-oeffnen"
            accessibilityRole="button"
            accessibilityLabel="Recap teilen"
            onPress={() => setTeilenOffen(true)}
          >
            <Share2 size={22} color={colors['text-1']} strokeWidth={1.75} />
          </PressScale>
        )}
      </View>
    </View>
  );

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
        <View style={[styles.inhalt, { paddingTop: oben }]}>
          {kopf}
          <Text style={[type.body, { color: colors.danger }]}>{fehler ?? 'Diese Reise gibt es nicht mehr.'}</Text>
          {fehler && <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />}
        </View>
      </View>
    );
  }

  // Nachzügler (upload_status='pending') fehlen im Raster — für sie gibt es
  // kein Objekt im Speicher, eine Kachel wäre eine schwarze Fläche
  // (Task-10-Brief). Dasselbe gilt für uploadete Momente, für die der Vorrat
  // trotzdem keine URL ausstellen konnte (`urls.has` false) — die Zahl dafür
  // ist `vorrat.ausgelassen`, eine EIGENE, vom Server gezählte Grösse, keine
  // hier selbst nachgerechnete Differenz (Task-10-Brief, zweiter Hinweis).
  const tage = gruppiereNachTagen(mitBild, trip.start_date);
  const pendingAnzahl = momente.length - uploaded.length;
  const ausgelassenAnzahl = vorrat?.ausgelassen ?? 0;
  const komplettLeer = tage.length === 0 && pendingAnzahl === 0 && ausgelassenAnzahl === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      <ScrollView contentContainerStyle={[styles.inhalt, { paddingTop: oben }]}>
        {kopf}
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>

        {/* Die beiden Lesarten dieses Recaps (Spec §5.1) — als Segment-Zeile
            aus zwei Pillen (Radius 999), ausdrücklich NICHT als zweite
            Tab-Bar: die untere bleibt bei vier Einträgen (DESIGN-LANGUAGE §4),
            und die Karte ist eine Sicht auf DIESEN Recap, kein eigener Bereich
            der App.

            Sie steht unter dem H1, nicht zwischen Kopfzeile und H1: die Zeile
            schaltet um, was DARUNTER steht, und getrennt vom Titel läse sie
            sich als Teil der Kopf-Chrome statt als Wahl über den Inhalt. Der
            Abstand kommt aus dem `gap` von `styles.inhalt` (12) — 4er-Raster,
            ohne zweiten Wert daneben.

            Hell, nicht translucent: die `Pille`-Komponente ist für eine
            Fremdfläche gemacht (DESIGN-LANGUAGE §1, «auf Fotos»), hier liegt
            reines Weiss darunter. */}
        {kannKarte && (
          <View style={styles.segmentZeile}>
            {/* Die aktive Hälfte ist bewusst KEIN Knopf: sie zeigt, wo man
                gerade ist, und ein Tipp darauf täte nichts. Ein Press-Feedback
                (PressScale) wäre dann eine Zusage, die niemand einlöst — die
                Regel «Scale statt Opacity» (§5) gilt für Dinge, die auf einen
                Tipp auch reagieren. `accessible` bündelt Pille und Text zu
                einem Element, damit VoiceOver den Stand als eine Auskunft
                vorliest statt als losen Text neben einem Knopf. */}
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel="Nach Tagen, aktuelle Ansicht"
              testID="uebersicht-segment-tage"
              style={[styles.segmentPille, { backgroundColor: colors['bg-1'] }]}
            >
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Nach Tagen</Text>
            </View>
            <PressScale
              accessibilityRole="button"
              testID="uebersicht-segment-karte"
              onPress={zurKarte}
            >
              <View
                style={[
                  styles.segmentPille,
                  { backgroundColor: colors['bg-0'], borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
                ]}
              >
                <Text style={[type.bodyMedium, { color: colors['text-2'] }]}>Auf der Karte</Text>
              </View>
            </PressScale>
          </View>
        )}

        {fehler ? (
          <View style={{ gap: spacing.l, marginTop: spacing.xl }}>
            <Text style={[type.body, { color: colors.danger }]}>{fehler}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={() => void nochmal()} loading={laedt} />
          </View>
        ) : komplettLeer ? (
          <Text style={[type.h2, { color: colors['text-1'], marginTop: spacing.xl }]}>
            Diese Reise ist leer geblieben.
          </Text>
        ) : (
          <View style={{ gap: spacing.xl, marginTop: spacing.xl }}>
            {tage.map((tag) => (
              <TagesAbschnitt key={tag.nummer} tag={tag} urls={urls} indexById={indexById} onTip={zumPlayer} />
            ))}
          </View>
        )}

        {!fehler && (pendingAnzahl > 0 || ausgelassenAnzahl > 0) && (
          <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
            {pendingAnzahl > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{unterwegsText(pendingAnzahl)}</Text>
            )}
            {ausgelassenAnzahl > 0 && (
              <Text style={[type.secondary, { color: colors['text-2'] }]}>{ausgelassenText(ausgelassenAnzahl)}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Geschwister des ScrollView, nicht sein Kind (gleiches Muster wie das
          Kommentar-Sheet in player.tsx) — muss über allem liegen. Nur
          gemountet, wenn `kannTeilen` je true war (die Sheet-Komponente
          selbst rendert bei `sichtbar=false` ohnehin `null`, siehe Sheet.tsx)
          — für eine Person ohne Teilen-Recht existiert damit erst gar kein
          Weg, sie zu öffnen. */}
      {kannTeilen && (
        <Sheet sichtbar={teilenOffen} titel="Recap teilen" onSchliessen={() => setTeilenOffen(false)} kino>
          <TeilenSheetInhalt tripId={id} />
        </Sheet>
      )}
      {kannExportieren && (
        <Sheet sichtbar={exportOffen} titel="Momente sichern" onSchliessen={exportSchliessen}>
          <ExportSheetInhalt
            stand={exportStand}
            ausgang={exportAusgang}
            onAbbrechen={exportAbbrechen}
            onFertig={() => setExportOffen(false)}
          />
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.m },
  kopfzeile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kopfAktionen: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  // Zwei Pillen nebeneinander, linksbündig (DESIGN-LANGUAGE §7: Text ist
  // linksbündig) — keine über die volle Breite gestreckte Leiste: gestreckt
  // sähe sie aus wie eine zweite Tab-Bar, und genau das soll sie nicht sein
  // (Spec §5.1). Abstand aus dem 4er-Raster.
  segmentZeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  // Radius 999 (DESIGN-LANGUAGE §3, der Pillen-Wert). Höhe 44 wie die Pillen
  // auf der Karte selbst — der Wert ist eine Grösse, kein Abstand, das
  // 4er-Raster gilt für Abstände (§3), sonst hätten weder Button 52 noch
  // Input 56 Bestand.
  segmentPille: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  // Drei Spalten. Lücke explizit `spacing.xs` über `columnGap`/`rowGap` —
  // NICHT über `justifyContent: 'space-between'` (Review Task 10, Minor):
  // das liess die Lücke aus dem verbleibenden Rest-Raum entstehen, je nach
  // Gerätebreite unterschiedlich gross und nie exakt aus dem 4er-Raster.
  // `columnGap`/`rowGap` sind seit RN 0.71 vollwertig, auch kombiniert mit
  // `flexWrap` — die Lücke ist damit immer exakt `spacing.xs`, unabhängig
  // von der Gerätebreite.
  kachelRaster: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: spacing.xs, rowGap: spacing.xs },
  kachel: { width: '31.5%', aspectRatio: 1, borderRadius: radius.control, overflow: 'hidden' },
});
