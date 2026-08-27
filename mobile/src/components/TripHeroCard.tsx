import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { ReliefBadge } from '@/components/ReliefBadge';
import { TripCover } from '@/components/TripCover';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { daysLeftLabel, formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// The big card for a RUNNING trip on the trip tab (mockup 2026-08-27):
// status and remaining days sit as solid white badges ON the cover, the
// sealed moments as a small stack of face-down cards in its lower corner,
// and below it name, date range and the people row with the moment
// counter. The wax seal image left the list with this card; its stage
// stays the recap (SealPeel on the overview, the sealed recap-tab card).
//
// The recap tab keeps TripCard: its cards promise a show, this one
// promises the trip itself. Both wear the same raised white badge
// (ReliefBadge, where the recipe and its documented deviations live).
export function TripHeroCard({
  trip, today, onPress, position = 0,
}: {
  trip: Trip;
  // Today's calendar day as 'YYYY-MM-DD', injected by the screen: the card
  // stays a pure function of its props, tests pin the clock without
  // module mocks.
  today: string;
  onPress: () => void;
  // The card's place in its list, passed to TripCover so stacked cards
  // never carry the same placeholder (see placeholderCover).
  position?: number;
}) {
  const { colors } = useTheme();
  const daysLabel = daysLeftLabel(trip.end_date, today);
  const momentsLabel = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;
  const first = trip.members[0];
  const companions = Math.max(0, trip.member_count - 1);

  return (
    <PressScale scaleTo={0.98} accessibilityRole="button" onPress={onPress}>
      <View style={{ gap: spacing.m }}>
        <TripCover position={position}>
          <View style={styles.coverFill}>
            <View style={styles.badgeRow}>
              <ReliefBadge>
                <LinearGradient
                  colors={[colors.accent, colors['accent-pressed']]}
                  style={styles.liveDot}
                />
                <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Aktiv</Text>
              </ReliefBadge>
              <ReliefBadge>
                <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{daysLabel}</Text>
              </ReliefBadge>
            </View>
            {trip.my_post_count > 0 && (
              // Face-down moments, the same idea SealedStack carries next
              // to the counter in the trip detail: taken, but sealed. The
              // front card stands for the first moment, the back one for
              // everything after it, so the stack only claims what exists.
              <View style={styles.stack}>
                {trip.my_post_count > 1 && <View testID="moment-stack-back" style={styles.stackBack} />}
                <View
                  testID="moment-stack-front"
                  style={[styles.stackFront, { backgroundColor: colors['bg-0'] }]}
                />
              </View>
            )}
          </View>
        </TripCover>
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.h3, { color: colors['text-1'] }]}>{trip.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
          <View style={styles.peopleRow}>
            {first && (
              <View style={styles.people}>
                <Avatar name={first.name} avatarKey={first.avatarKey} size={32} />
                <Text style={[type.secondary, { color: colors['text-2'] }]}>
                  {companions > 0 ? `${first.name} + ${companions} weitere` : first.name}
                </Text>
              </View>
            )}
            <View style={styles.moments}>
              <Text style={[type.secondary, { color: colors['text-1'] }]}>{momentsLabel}</Text>
              <ChevronRight size={16} color={colors['text-1']} strokeWidth={1.75} />
            </View>
          </View>
        </View>
      </View>
    </PressScale>
  );
}

// Sized against the 3:2 cover of a 390-wide screen (342 x 228): the stack
// takes about a quarter of the width, like in the mockup.
const STACK_CARD = { width: 88, height: 44 };
// How far front and back card are shifted against each other.
const STACK_SHIFT = 10;

const styles = StyleSheet.create({
  // TripCover's overlay aligns children flex-start; stretching restores
  // the full cover area so the badge row and the stack can sit in
  // opposite corners.
  coverFill: { flex: 1, alignSelf: 'stretch', justifyContent: 'space-between' },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  // The red dot marks the trip as live, the way the reference pill leads
  // with an icon; a Lucide glyph would say less here than the accent does.
  // Its own top-to-bottom gradient plus a tiny contact shadow turn the
  // flat disc into a small sphere, matching the pill's relief.
  liveDot: {
    width: spacing.s,
    height: spacing.s,
    borderRadius: radius.pill,
    boxShadow: '0px 1px 1.5px rgba(0,0,0,0.25)',
  },
  stack: {
    alignSelf: 'flex-end',
    width: STACK_CARD.width + STACK_SHIFT,
    height: STACK_CARD.height + STACK_SHIFT,
  },
  // The back card borrows the pill overlay tint: it has to hold on any
  // photo, a solid color could not.
  stackBack: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: STACK_CARD.width,
    height: STACK_CARD.height,
    borderRadius: radius.control,
    backgroundColor: cinema['overlay-pill'],
  },
  stackFront: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: STACK_CARD.width,
    height: STACK_CARD.height,
    borderRadius: radius.control,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  people: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  // marginLeft auto keeps the counter on the right edge even for a trip
  // whose member list has not arrived yet.
  moments: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: 'auto' },
});
