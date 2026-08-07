import { Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Badge } from '@/components/Badge';
import { AvatarGroup } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// Randlose Reise-Karte (DESIGN-LANGUAGE v2 §4): Cover 3:2 mit Radius 24,
// darunter ohne Rahmen und ohne Schatten. Cover-Bilder kommen in Phase 4 —
// bis dahin trägt die Fläche bg-1.
export function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const { colors } = useTheme();
  const momente = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;

  return (
    <PressScale scaleTo={0.98} accessibilityRole="button" onPress={onPress}>
      <View style={{ gap: spacing.m }}>
        <View
          style={{
            aspectRatio: 3 / 2,
            borderRadius: radius.card,
            backgroundColor: colors['bg-1'],
            justifyContent: 'flex-start',
            padding: spacing.m,
          }}
        >
          {trip.status === 'active' && (
            <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
          )}
        </View>
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{trip.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.xs }}>
            <AvatarGroup names={trip.member_names} />
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{momente}</Text>
          </View>
        </View>
      </View>
    </PressScale>
  );
}
