import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, Plus } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { daysLeftLabel, formatRange } from '@/features/trips/tripDay';
import { placeholderCover } from '@/features/trips/placeholderCover';
import type { CachedTrip } from '@/features/trips/tripsCache';

// The row of the trip picker (spec 2026-08-27 "Reisewahl"): the compact
// list row in the Airbnb inbox mould. Image 64 on the left, three lines of
// text, nothing else, except the accent check on the trip the camera is
// currently pointed at. 12 + 64 + 12 makes the row 88 high, and the three
// lines (24 + 20 + 20) are exactly as tall as the image, so no gap between
// them is needed.
//
// The cover comes from the placeholder by position, the same rule as the
// trip tab (placeholderCover): `CachedTrip` carries no image, and the
// picker has to work offline from the cache alone.
const IMAGE = 64;
const CHECK = 24;

// The picker invites rather than scores: a 0 reads as "nothing yet".
function momentsLabel(count: number): string {
  if (count === 0) return 'Noch kein Moment';
  return `${count} ${count === 1 ? 'Moment' : 'Momente'}`;
}

export function TripRow({
  trip, today, position, selected = false, onPress,
}: {
  trip: CachedTrip;
  // Today's calendar day as 'YYYY-MM-DD', injected by the screen (see
  // TripHeroCard): the row stays a pure function of its props.
  today: string;
  // The row's place in its list, picks the placeholder cover.
  position: number;
  // The trip the viewfinder currently shows, when the picker was opened
  // from there. Read out as `accessibilityState.selected`, drawn as the
  // check.
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const range = formatRange(trip.start_date, trip.end_date);
  const status = `${daysLeftLabel(trip.end_date, today)} · ${momentsLabel(trip.my_post_count)}`;

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${trip.name}, ${range}, ${status}`}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <View style={styles.row}>
        <View style={[styles.image, { backgroundColor: colors['bg-1'] }]}>
          <Image
            source={placeholderCover(position)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessible={false}
          />
        </View>
        <View style={styles.lines}>
          {/* numberOfLines: trip names are free text, a long one is cut
              instead of pushing the row out of its 88. */}
          <Text numberOfLines={1} style={[type.bodyMedium, { color: colors['text-1'] }]}>
            {trip.name}
          </Text>
          <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
            {range}
          </Text>
          <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
            {status}
          </Text>
        </View>
        {selected && (
          // Says nothing the row's selected state does not already say.
          <View accessible={false} style={[styles.check, { backgroundColor: colors.accent }]}>
            <Check size={14} color={colors['bg-0']} strokeWidth={2.25} />
          </View>
        )}
      </View>
    </PressScale>
  );
}

// The last row of the picker: the same shape as a trip, with a plus tile
// where the cover would be. For the moment that fits none of the running
// trips; leads into the existing create flow.
export function AddTripRow({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel="Neue Reise anlegen, wenn keine der Reisen passt"
      onPress={onPress}
    >
      <View style={styles.row}>
        <View style={[styles.image, styles.plus, { backgroundColor: colors['bg-1'] }]}>
          <Plus size={24} color={colors['text-2']} strokeWidth={1.75} />
        </View>
        <View style={styles.lines}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Neue Reise anlegen</Text>
          <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
            Wenn keine der Reisen passt
          </Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.m,
  },
  image: {
    width: IMAGE,
    height: IMAGE,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  plus: { alignItems: 'center', justifyContent: 'center' },
  // `minWidth: 0`: without it a long name would widen the column past the
  // row instead of letting numberOfLines cut it.
  lines: { flex: 1, minWidth: 0 },
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
