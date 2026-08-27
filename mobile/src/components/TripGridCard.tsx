import { Text, View } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { TripCover } from '@/components/TripCover';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// Planned trips share a two-column grid below the running ones (mockup
// 2026-08-27): half-width cover, name and date range, nothing else. No
// badges and no moment stack: nothing is sealed yet, the start date says
// everything this card knows.
export function TripGridCard({
  trip, onPress, position = 0,
}: {
  trip: Trip;
  onPress: () => void;
  // Continues the cover slots across sections (see trip/index.tsx), so a
  // grid card never repeats the placeholder right above it.
  position?: number;
}) {
  const { colors } = useTheme();
  return (
    <PressScale scaleTo={0.97} accessibilityRole="button" style={{ flex: 1 }} onPress={onPress}>
      <View style={{ gap: spacing.s }}>
        <TripCover position={position} />
        <View>
          <Text numberOfLines={1} style={[type.bodyMedium, { color: colors['text-1'] }]}>
            {trip.name}
          </Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
        </View>
      </View>
    </PressScale>
  );
}
