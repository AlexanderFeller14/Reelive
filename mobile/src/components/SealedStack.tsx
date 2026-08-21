import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

// The moments a trip already holds, as a small stack of polaroids: the
// same picture the submission animation leaves behind, only standing
// still (MomentSubmissionAnimation.tsx, POLAROIDS). Their image areas
// stay empty, because that is exactly the state they are in: taken, but
// sealed until the recap.
//
// Three cards are the ceiling. Whoever wants to know the exact number
// reads it in the counter next to it, which is why the stack does not try
// to be a second counter.
const MAX_CARDS = 3;

// Polaroid proportion of the animation (height = width * 1.2), only
// smaller: this one lies next to the counter, it does not carry the
// screen.
const CARD_WIDTH = 72;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.2);
// The image area sits with a thin edge in the card and leaves the wide
// bottom margin a polaroid lives from.
const FRAME = spacing.xs;
const IMAGE = CARD_WIDTH - FRAME * 2;

// How far the outer cards peek out to the side.
const FAN_OFFSET = 20;
// Room for the fan: a card tilted by 10 degrees needs more than its own
// width and height, and the offset comes on top of that sideways.
const STACK_WIDTH = 128;
const STACK_HEIGHT = 100;

// The poses in the order the cards get taken, so a single moment lies
// centred at the front instead of off to one side. `layer` keeps the
// stacking order of the animation independent of that: the centre card
// stays on top.
const POSES = [
  { translateX: 0, rotate: '2deg', layer: 3 },
  { translateX: -FAN_OFFSET, rotate: '-10deg', layer: 1 },
  { translateX: FAN_OFFSET, rotate: '10deg', layer: 2 },
];

export function SealedStack({ count }: { count: number }) {
  const { colors } = useTheme();
  const cards = POSES.slice(0, Math.max(0, Math.min(count, MAX_CARDS)));

  return (
    <View
      testID="sealed-stack"
      style={styles.stack}
      // The counter right next to it already says the number. A reader
      // walking through the cards afterwards would count the same thing a
      // second time without saying so.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {cards.map((pose) => (
        <View
          key={pose.layer}
          testID="sealed-card"
          style={[
            styles.card,
            {
              backgroundColor: colors['bg-0'],
              borderColor: colors.line,
              zIndex: pose.layer,
              transform: [{ translateX: pose.translateX }, { rotate: pose.rotate }],
            },
          ]}
        >
          <View style={[styles.image, { backgroundColor: colors['bg-1'] }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { width: STACK_WIDTH, height: STACK_HEIGHT },
  // A hairline instead of a shadow: the cards lie, they do not float
  // (DESIGN-LANGUAGE §3).
  card: {
    position: 'absolute',
    left: (STACK_WIDTH - CARD_WIDTH) / 2,
    top: (STACK_HEIGHT - CARD_HEIGHT) / 2,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    padding: FRAME,
  },
  // Square and sharp-edged, like the image area of a real polaroid.
  image: { width: IMAGE, height: IMAGE },
});
