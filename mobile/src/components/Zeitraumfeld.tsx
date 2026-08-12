import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Kalender } from '@/components/Kalender';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
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

      <Sheet sichtbar={offen} titel="Zeitraum" onSchliessen={() => setOffen(false)}>
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
      </Sheet>
    </View>
  );
}
