// Inhalt des «Recap teilen»-Sheets (Task-6-Brief) — eingehängt in
// recap/[id]/uebersicht.tsx über <Sheet kino>. Eigene Komponente statt eines
// lokalen Sub-Bausteins direkt in uebersicht.tsx (anders als z.B.
// TagesAbschnitt dort): die Zustandsmaschine hier (laden, erstellen,
// widerrufen, Ablauf-Auswahl, Kopieren, Teilen) ist gross genug, dass sie in
// einer eigenen Datei mit eigenen Tests klarer bleibt als als weiterer
// verschachtelter Zweig in einem bereits 300-Zeilen-Screen.
//
// EHRLICHKEIT ZUERST (Auftrag, wörtlich: „Das Sheet sagt das, bevor jemand
// teilt, nicht danach."): der Hinweis, dass ein Link den GANZEN Recap ohne
// Konto zeigt, steht in JEDER Phase, in der überhaupt schon eine Aktion
// möglich ist (kein_link UND link_aktiv) — nicht erst, nachdem ein Link
// existiert.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Share2 } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { erstelleLink, holeAktivenLink, widerrufeLink, type AktiverLink } from './linkVerwaltenApi';

// Drei feste Optionen (Brief) statt eines freien Eingabefelds — ein Tippfehler
// bei einer Gültigkeitsdauer ist ein schlechter Ort für einen Zahlen-Input.
const ABLAUF_OPTIONEN: { id: string; label: string; tage: number | null }[] = [
  { id: '7', label: '7 Tage', tage: 7 },
  { id: '30', label: '30 Tage', tage: 30 },
  { id: 'unbegrenzt', label: 'Unbegrenzt', tage: null },
];

const DISCLOSURE_TEXT =
  'Wer diesen Link hat, sieht den ganzen Recap — alle Momente aller Mitreisenden, auch ohne eigenes Konto.';
const LADEFEHLER = 'Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.';

type Phase = 'laedt' | 'kein_link' | 'link_aktiv' | 'fehler';

function KinoPrimaerKnopf({
  label, onPress, laedt, testID,
}: {
  label: string;
  onPress: () => void;
  laedt?: boolean;
  testID?: string;
}) {
  return (
    <PressScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!laedt }}
      onPress={() => {
        if (!laedt) onPress();
      }}
    >
      <View style={styles.primaerKnopf}>
        {laedt ? (
          <ActivityIndicator color={palette['on-accent']} size="small" />
        ) : (
          <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>{label}</Text>
        )}
      </View>
    </PressScale>
  );
}

function AblaufPille({
  id, label, aktiv, onPress,
}: {
  id: string;
  label: string;
  aktiv: boolean;
  onPress: () => void;
}) {
  return (
    <PressScale
      testID={`teilen-ablauf-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: aktiv }}
      onPress={onPress}
    >
      <View style={[styles.ablaufPille, aktiv && styles.ablaufPilleAktiv]}>
        <Text style={[type.secondary, { color: cinema['text-1'] }]}>{label}</Text>
      </View>
    </PressScale>
  );
}

export function TeilenSheetInhalt({ tripId }: { tripId: string }) {
  const [phase, setPhase] = useState<Phase>('laedt');
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [link, setLink] = useState<AktiverLink | null>(null);
  const [gueltigTage, setGueltigTage] = useState<number | null>(7);
  const [erstelltLaeuft, setErstelltLaeuft] = useState(false);
  const [erstellenFehler, setErstellenFehler] = useState<string | null>(null);
  const [widerrufLaeuft, setWiderrufLaeuft] = useState(false);
  const [widerrufFehler, setWiderrufFehler] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const aktiv = useRef(true);
  const kopiertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const laden = useCallback(async () => {
    setPhase('laedt');
    setLadeFehler(null);
    const { data, error } = await holeAktivenLink(tripId);
    if (!aktiv.current) return;
    if (error) {
      setLadeFehler(error);
      setPhase('fehler');
      return;
    }
    if (data) {
      setLink(data);
      setPhase('link_aktiv');
    } else {
      setPhase('kein_link');
    }
  }, [tripId]);

  useEffect(() => {
    aktiv.current = true;
    void laden();
    return () => {
      aktiv.current = false;
      if (kopiertTimer.current) clearTimeout(kopiertTimer.current);
    };
  }, [laden]);

  const erstellen = async () => {
    setErstelltLaeuft(true);
    setErstellenFehler(null);
    const { data, error } = await erstelleLink(tripId, gueltigTage);
    if (!aktiv.current) return;
    setErstelltLaeuft(false);
    if (error || !data) {
      setErstellenFehler(error ?? LADEFEHLER);
      return;
    }
    setLink(data);
    setPhase('link_aktiv');
  };

  const kopieren = async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(link.url);
    } catch {
      // expo-clipboard schlägt praktisch nie fehl — kein stiller Absturz,
      // aber auch keine eigene Fehlermeldung dafür: der Link steht weiterhin
      // sichtbar da und lässt sich notfalls von Hand markieren.
      return;
    }
    if (!aktiv.current) return;
    setKopiert(true);
    if (kopiertTimer.current) clearTimeout(kopiertTimer.current);
    kopiertTimer.current = setTimeout(() => {
      if (aktiv.current) setKopiert(false);
    }, 2000);
  };

  const teilen = async () => {
    if (!link) return;
    try {
      // `message` statt `url`: Android wertet das `url`-Feld von Share.share
      // nicht zuverlässig aus (verbreitete Einschränkung der Plattform-API),
      // `message` funktioniert auf beiden Plattformen gleich.
      await Share.share({ message: link.url });
    } catch {
      // Ein abgebrochener/fehlgeschlagener System-Dialog ist kein
      // Anwendungsfehler — der Link bleibt unverändert sichtbar und lässt
      // sich über "Kopieren" weiterhin teilen.
    }
  };

  const widerrufen = () => {
    if (!link) return;
    const token = link.token;
    Alert.alert('Link deaktivieren?', 'Wer den Link hat, kommt danach nicht mehr an den Recap.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Deaktivieren',
        style: 'destructive',
        onPress: () => {
          setWiderrufLaeuft(true);
          setWiderrufFehler(null);
          void widerrufeLink(token).then(({ error }) => {
            if (!aktiv.current) return;
            setWiderrufLaeuft(false);
            if (error) {
              setWiderrufFehler(error);
              return;
            }
            setLink(null);
            setGueltigTage(7);
            setPhase('kein_link');
          });
        },
      },
    ]);
  };

  if (phase === 'laedt') {
    return (
      <View testID="teilen-sheet-laedt" style={styles.mitte}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  if (phase === 'fehler') {
    return (
      <View testID="teilen-sheet-fehler" style={{ gap: spacing.base }}>
        <Text style={[type.body, { color: palette.danger }]}>{ladeFehler}</Text>
        <KinoPrimaerKnopf label="Nochmal versuchen" onPress={() => void laden()} testID="teilen-nochmal" />
      </View>
    );
  }

  if (phase === 'link_aktiv' && link) {
    return (
      <View style={{ gap: spacing.base }}>
        <Text style={[type.secondary, { color: cinema['text-2'] }]}>{DISCLOSURE_TEXT}</Text>
        <Text testID="teilen-link-text" style={[type.body, { color: cinema['text-1'] }]} selectable>
          {link.url}
        </Text>
        <View style={styles.aktionsReihe}>
          <PressScale
            testID="teilen-kopieren"
            accessibilityRole="button"
            accessibilityLabel="Link kopieren"
            onPress={() => void kopieren()}
          >
            <View style={styles.pilleKnopf}>
              <Copy size={18} color={cinema['text-1']} strokeWidth={1.75} />
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                {kopiert ? 'Kopiert' : 'Kopieren'}
              </Text>
            </View>
          </PressScale>
          <PressScale
            testID="teilen-teilen"
            accessibilityRole="button"
            accessibilityLabel="Teilen"
            onPress={() => void teilen()}
          >
            <View style={styles.pilleKnopfAkzent}>
              <Share2 size={18} color={palette['on-accent']} strokeWidth={1.75} />
              <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Teilen</Text>
            </View>
          </PressScale>
        </View>
        {widerrufFehler && (
          <Text style={[type.secondary, { color: palette.danger }]}>{widerrufFehler}</Text>
        )}
        <PressScale
          testID="teilen-deaktivieren"
          accessibilityRole="button"
          accessibilityState={{ disabled: widerrufLaeuft }}
          onPress={() => {
            if (!widerrufLaeuft) widerrufen();
          }}
        >
          {widerrufLaeuft ? (
            <ActivityIndicator color={palette.danger} size="small" />
          ) : (
            <Text style={[type.bodyMedium, styles.deaktivierenText]}>Link deaktivieren</Text>
          )}
        </PressScale>
      </View>
    );
  }

  // phase === 'kein_link'
  return (
    <View style={{ gap: spacing.base }}>
      <Text style={[type.secondary, { color: cinema['text-2'] }]}>{DISCLOSURE_TEXT}</Text>
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.secondary, { color: cinema['text-2'] }]}>Wie lange soll der Link gelten?</Text>
        <View style={styles.ablaufReihe}>
          {ABLAUF_OPTIONEN.map((option) => (
            <AblaufPille
              key={option.id}
              id={option.id}
              label={option.label}
              aktiv={gueltigTage === option.tage}
              onPress={() => setGueltigTage(option.tage)}
            />
          ))}
        </View>
      </View>
      {erstellenFehler && <Text style={[type.secondary, { color: palette.danger }]}>{erstellenFehler}</Text>}
      <KinoPrimaerKnopf
        label="Link erstellen"
        laedt={erstelltLaeuft}
        onPress={() => void erstellen()}
        testID="teilen-erstellen"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mitte: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  primaerKnopf: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  ablaufReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  ablaufPille: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
    backgroundColor: cinema['overlay-pill'],
  },
  ablaufPilleAktiv: { backgroundColor: cinema['text-1'] },
  aktionsReihe: { flexDirection: 'row', gap: spacing.s },
  pilleKnopf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: radius.control,
    backgroundColor: cinema['overlay-pill'],
  },
  pilleKnopfAkzent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: radius.control,
    backgroundColor: palette.accent,
  },
  deaktivierenText: { color: palette.danger, textDecorationLine: 'underline', textAlign: 'center' },
});
