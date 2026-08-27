import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { CinemaButton, CinemaTextLink } from './CinemaButton';
import { cinema, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { ImportPeriod } from '@/features/moments/libraryImport';

type Props = {
  visible: boolean;
  period: ImportPeriod;
  maxVideoSeconds: number;
  selectionLimit: number;
  onPick: () => void;
  onClose: () => void;
};

// The sheet before the photo picker (decision 2026-08-27: shown on every
// tap, nothing remembered). It states the rules the assessment will apply,
// with the trip's own values, so a refusal afterwards never comes as a
// surprise. Cinema mode: it sits over the running viewfinder.
export function ImportIntroSheet({
  visible,
  period,
  maxVideoSeconds,
  selectionLimit,
  onPick,
  onClose,
}: Props) {
  const rules = [
    `Nur Momente aus dem Reisezeitraum (${formatRange(period.start_date, period.end_date)})`,
    `Videos bis ${maxVideoSeconds} Sekunden`,
    `Ohne Caption, bis zum Recap versiegelt, höchstens ${selectionLimit} auf einmal`,
  ];
  return (
    <Sheet visible={visible} title="Momente aus Fotos" onClose={onClose} cinemaMode>
      <Text style={[type.body, { color: cinema['text-1'] }]}>
        Reelive holt Fotos und Videos aus deiner Fotomediathek in die Reise. Es gelten dieselben
        Regeln wie beim Aufnehmen:
      </Text>
      <View style={styles.rules}>
        {rules.map((rule) => (
          <Text key={rule} style={[type.secondary, { color: cinema['text-2'] }]}>
            {rule}
          </Text>
        ))}
      </View>
      <CinemaButton label="Fotos auswählen" onPress={onPick} />
      <CinemaTextLink label="Abbrechen" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Tighter than the gap the sheet holds between its children: the three
  // rules belong together (4-pt grid, §3).
  rules: { gap: spacing.s },
});
