import { Text, View } from 'react-native';
import { Play } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { TripCover } from '@/components/TripCover';
import { ReliefBadge } from '@/components/ReliefBadge';
import { AvatarGroup } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// Borderless trip card (DESIGN-LANGUAGE v2 §4): cover 3:2 with 24 px
// radius, below it without border and without shadow. The cover itself
// (placeholder image and wax seal) lives in `TripCover`, it's used here
// and in the trip detail screen.
//
// Task 10 (recap tab): two card states instead of one. `active` stays
// unchanged, the wax seal is pure symbolism and depends solely on
// `trip.status`,
// independent of where the card is placed. `revealed`/`archived`
// ("developed", concept §5.2 "cover collage, 'view recap' play button")
// shows a play pill instead, but ONLY if the caller explicitly requests it
// via `asRecap` (review Task 10, Important 1). Without this flag, EVERY
// revealed trip would have carried "view recap" everywhere TripCard is
// used, including reise/index.tsx, where a tap on the card leads to the
// trip detail screen, not the recap. The pill would have been a promise
// there that the tap doesn't keep. The recap tab (the only place where a
// tap actually opens the show) sets `asRecap`, the trip tab leaves it out
// and keeps showing revealed trips without any pill, exactly the state
// before this task.
//
// Task 5 (recap-show plan): the pill sits bottom left on the photo scrim
// `TripCover` draws for it, and its tap target is the player without a
// `start` param, so that the card promises a show and the tap actually
// opens one. Since the trip tab redesign (2026-08-27) it wears the same
// raised white `ReliefBadge` as the hero card's badges, one badge language
// across both tabs; icon and text in `text-1`, dark on the light badge.
// The scrim stays: it grounds the badge on busy photos.
export function TripCard({
  trip, onPress, asRecap = false, position = 0, coverUrl,
}: {
  trip: Trip;
  onPress: () => void;
  asRecap?: boolean;
  // The card's position in its list, only for the placeholder cover
  // (TripCover): it decides which image it shows, so that two identical
  // ones don't end up stacked.
  position?: number;
  // Task 7 (recap-show plan): passed straight through to TripCover, the
  // card itself has no opinion on where the photo comes from or why it
  // might be missing.
  coverUrl?: string | null;
}) {
  const { colors } = useTheme();
  const momentsLabel = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;
  const revealed = asRecap && trip.status !== 'active';

  return (
    <PressScale
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={asRecap ? `Recap von ${trip.name} ansehen` : undefined}
      onPress={onPress}
    >
      <View style={{ gap: spacing.m }}>
        <TripCover position={position} sealed={trip.status === 'active'} scrim={revealed} coverUrl={coverUrl}>
          {revealed && (
            <ReliefBadge testID="recap-card-play">
              <Play size={16} color={palette['text-1']} strokeWidth={1.75} />
              <Text style={[type.bodyMedium, { color: palette['text-1'] }]}>Recap ansehen</Text>
            </ReliefBadge>
          )}
        </TripCover>
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{trip.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.xs }}>
            <AvatarGroup faces={trip.members} />
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{momentsLabel}</Text>
          </View>
        </View>
      </View>
    </PressScale>
  );
}
