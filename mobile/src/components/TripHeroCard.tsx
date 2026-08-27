import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { TripCover } from '@/components/TripCover';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { daysUntilEnd, formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// The big card for a RUNNING trip on the trip tab (mockup 2026-08-27):
// status and remaining days sit as solid white badges ON the cover, the
// sealed moments as a small stack of face-down cards in its lower corner,
// and below it name, date range and the people row with the moment
// counter. The wax seal image left the list with this card; its stage
// stays the recap overview (SealPeel) and the trip detail.
//
// The recap tab keeps TripCard: its cards promise a show, this one
// promises the trip itself. Solid white badges instead of the translucent
// pill (DESIGN-LANGUAGE §1) are a deliberate mockup-driven deviation,
// kept to this one card.
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
  const left = daysUntilEnd(trip.end_date, today);
  // `left <= 0` also covers a trip past its end that the auto-reveal has
  // not picked up yet: "Letzter Tag" is closer to the truth than a
  // negative count.
  const daysLabel = left <= 0 ? 'Letzter Tag' : left === 1 ? 'Noch 1 Tag' : `Noch ${left} Tage`;
  const momentsLabel = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;
  const first = trip.members[0];
  const companions = Math.max(0, trip.member_count - 1);

  return (
    <PressScale scaleTo={0.98} accessibilityRole="button" onPress={onPress}>
      <View style={{ gap: spacing.m }}>
        <TripCover position={position}>
          <View style={styles.coverFill}>
            <View style={styles.badgeRow}>
              <View style={styles.badgeShadow}>
                <LinearGradient colors={BADGE_SHEEN} locations={BADGE_SHEEN_STOPS} style={styles.badge}>
                  <View pointerEvents="none" style={styles.badgeInner} />
                  <LinearGradient
                    colors={[colors.accent, colors['accent-pressed']]}
                    style={styles.liveDot}
                  />
                  <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Aktiv</Text>
                </LinearGradient>
              </View>
              <View style={styles.badgeShadow}>
                <LinearGradient colors={BADGE_SHEEN} locations={BADGE_SHEEN_STOPS} style={styles.badge}>
                  <View pointerEvents="none" style={styles.badgeInner} />
                  <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{daysLabel}</Text>
                </LinearGradient>
              </View>
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

// The raised look of Airbnb's service pills, measured off the reference
// screenshot (2026-08-27, pixel scan): a bright rim on the top edge
// (~#FAFAFA), a fill that darkens toward the top (#F0F0F0) and brightens
// toward the bottom (#FEFEFE) as if lit from below, and TWO shadows: a
// tight dark contact shadow right at the edge plus a wide soft lift.
// Fixed hex values and a surface gradient are deliberate deviations from
// DESIGN-LANGUAGE §1/§7 for exactly this effect; they are the badge's
// material, not palette colors, and stay local to this file.
const BADGE_SHEEN = ['#FFFFFF', '#F3F3F3', '#FBFBFB', '#FFFFFF'] as const;
const BADGE_SHEEN_STOPS = [0, 0.22, 0.8, 1] as const;
// The last layer is the dark seam just OUTSIDE the white ring: together
// they are the visible ridge of the reference pill's border. Its blur
// feathers the seam instead of cutting it hard.
const BADGE_SHADOW =
  '0px 3px 5px rgba(0,0,0,0.26), 0px 18px 34px rgba(0,0,0,0.18), 0px 0px 2px 1px rgba(0,0,0,0.10)';
// The pillow curvature, painted on an overlay INSIDE the pill: shaded
// along the top inner edge, glowing along the bottom one. An overlay
// instead of boxShadow on the gradient itself, because the gradient is a
// native child layer and would paint OVER its own inset shadows.
// The first layer blends the white ring softly into the fill.
const BADGE_INNER =
  'inset 0px 0px 2px rgba(255,255,255,0.9), inset 0px 2px 4px rgba(0,0,0,0.05), inset 0px -3px 6px rgba(255,255,255,1)';

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
  // The shadow lives on a wrapper: the gradient inside must clip itself
  // (overflow hidden), and clipping would swallow its own shadow.
  badgeShadow: { borderRadius: radius.pill, boxShadow: BADGE_SHADOW },
  // Carries the curvature AND the white ring: the overlay sits above the
  // gradient, so both stay visible on top of it.
  badgeInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    boxShadow: BADGE_INNER,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    overflow: 'hidden',
  },
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
