import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Kalender } from '@/components/Kalender';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { useOberkante, useUnterkante } from '@/theme/useOberkante';
import { naechsteAuswahl, zeitraumLabel, type Auswahl } from '@/features/trips/kalender';
import { formatRange } from '@/features/trips/tripDay';

type Props = {
  wert: Auswahl;
  onAendern: (auswahl: Auswahl) => void;
  fehler?: string;
  heute?: string;
};

// Das Feld trägt die Masse des `Input` (DESIGN-LANGUAGE §4), ist aber kein
// Textfeld: seit der Umstellung auf den Kalender gibt es keinen Textpfad mehr,
// deshalb eine Fläche, die das Sheet öffnet.
export function Zeitraumfeld({ wert, onAendern, fehler, heute }: Props) {
  const { colors } = useTheme();
  // Das Modal deckt die ganze Seite ab und stösst damit an beide
  // Systembereiche: oben Statusleiste und Dynamic Island, unten den
  // Home-Indicator. Ein fester Abstand nach unten liesse «Übernehmen» darunter
  // geraten.
  const oben = useOberkante(spacing.l);
  const unten = useUnterkante(spacing.l);
  const [offen, setOffen] = useState(false);
  // Der Entwurf lebt nur, solange das Sheet offen ist. Erst «Übernehmen» meldet
  // nach oben, ein Abbruch verwirft ihn folgenlos. Deshalb setzt ihn `oeffnen`
  // jedes Mal neu aus `wert`, statt sich auf den Stand vom letzten Mal zu
  // verlassen.
  const [entwurf, setEntwurf] = useState<Auswahl>(wert);

  const vollstaendig = !!entwurf.start && !!entwurf.end;
  const anzeige = wert.start && wert.end ? formatRange(wert.start, wert.end) : '';

  const oeffnen = () => {
    setEntwurf(wert);
    setOffen(true);
  };

  const uebernehmen = () => {
    if (!vollstaendig) return;
    onAendern(entwurf);
    setOffen(false);
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={zeitraumLabel(wert)}
        onPress={oeffnen}
        style={{
          height: 56,
          borderWidth: 1,
          borderColor: fehler ? palette.danger : colors['line-strong'],
          borderRadius: radius.control,
          backgroundColor: colors['bg-0'],
          paddingHorizontal: spacing.base,
          justifyContent: 'center',
        }}
      >
        <Text style={[type.label, { color: colors['text-2'] }]}>Zeitraum</Text>
        {anzeige ? <Text style={[type.body, { color: colors['text-1'] }]}>{anzeige}</Text> : null}
      </PressScale>
      {fehler ? <Text style={[type.secondary, { color: palette.danger }]}>{fehler}</Text> : null}

      {/* Ein Modal, kein `Sheet`. Zwei Gründe: `Sheet` positioniert sich mit
          absoluteFill relativ zu seinem Elternteil, und dieses Feld sitzt
          mitten im Formular, das Sheet erschien dadurch an der Stelle des
          Feldes und überlagerte die Statusleiste. Und `Sheet` gibt seinem
          Inhalt keine definite Höhe, der Kalender stand darin null hoch. Das
          Modal löst beides: es liegt immer oben und trägt eine volle Höhe.
          `pageSheet` kommt von unten und lässt sich nach unten wegwischen, das
          ist derselbe Auftritt, den DESIGN-LANGUAGE §4 für Sheets vorsieht. */}
      <Modal
        visible={offen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOffen(false)}
      >
        <View
          testID="zeitraum-modal"
          style={{
            flex: 1,
            backgroundColor: colors['bg-0'],
            paddingTop: oben,
            paddingHorizontal: spacing.screen,
            paddingBottom: unten,
            gap: spacing.base,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
              onPress={() => setOffen(false)}
              hitSlop={spacing.m}
            >
              <X size={24} strokeWidth={1.75} color={colors['text-1']} />
            </PressScale>
            <Text style={[type.h3, { color: colors['text-1'] }]}>Zeitraum</Text>
          </View>
          <Kalender
            auswahl={entwurf}
            onTag={(tag) => setEntwurf((bisher) => naechsteAuswahl(bisher, tag))}
            heute={heute}
          />
          <Button
            variant="primary"
            label="Übernehmen"
            onPress={uebernehmen}
            disabled={!vollstaendig}
          />
        </View>
      </Modal>
    </View>
  );
}
