import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { AvatarGroup, type Face } from '@/components/Avatar';
import { SealPeel } from '@/components/SealPeel';
import { DISSOLVE_MS } from '@/features/recap/sealPeel';
import { motion, palette, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

// How long the card takes to withdraw. It starts the MOMENT the seal comes
// off (SealPeel.onLiftOff) and lasts exactly as long as the seal spends
// falling apart, so card, ground and seal all leave together: one movement
// instead of a card that is gone while the seal is still hanging there.
// Deliberately not a motion token: this duration is not a choice of its own,
// it IS the seal's.
export const HANDOVER_MS = DISSOLVE_MS;
// How long the LINES take to clear the stage once the handover begins. The
// day card underneath is staged like this letter on purpose, and its credits
// start stepping in one `base` after the seal comes off: two title cards
// crossfading in place read as doubled text, so the text leaves first, fast,
// and only the empty card surface keeps withdrawing alongside the seal.
export const CONTENT_OUT_MS = motion.duration.base;
// DESIGN-LANGUAGE §5: with reduced motion everything becomes a 200 ms fade.
// No hold either, the pause only earns its keep alongside the movement.
export const REDUCED_HANDOVER_MS = 200;

// Share of the letter's width the wax takes up. The seal spans 500 of the
// 720 stage units (sealPeel.SEAL), so the Skia stage around it has to be
// correspondingly larger, otherwise the peel would roll out of its own canvas
// and be clipped at the edge.
const WAX_SHARE = 0.42;
const SEAL_IN_STAGE = 500 / 720;

// The ticket asset's geometry, measured from the PNG (assets/images/
// reelive-kino-ticket.png, cropped to its own bounding box). Everything the
// layout needs to know about the picture lives here as fractions of its
// size, so a re-export of the asset only has to update these three numbers.
export const TICKET_ASPECT = 758 / 1098;
// Centre of the dotted tear line between ticket and stub: the wax sits ON
// it, sealing the tear. Peeling the wax off is tearing the ticket.
export const TICKET_PERFORATION_Y = 852 / 1098;
// Where the main compartment's lower keyline runs: the lines stay above it,
// the stub below keeps the asset's punched holes and camera emboss.
const TICKET_MAIN_END = 820 / 1098;

// The stage the letter is sealed with: a vintage cinema ticket (Alex's
// asset, 27.08.) carrying what the trip IS (title, span, facts, the faces of
// its senders) in its main compartment, with the wax sealing the perforated
// tear line to the stub. The lines keep the day card's staging (chapter
// line, title, facts, faces), so the show still reads as one film rather
// than a ticket followed by an unrelated opening.
//
// The letter is ALSO the loading window for the trip behind it (the player
// renders it while the load is still running), which is why every line below
// the chapter line is optional: it stands with what it has and lets the rest
// fade in as it arrives, instead of holding empty rows.
//
// Sequenced as state (`mode`) plus effect rather than inside the peel
// handler, the same pattern as SealPeel/RevealSequence: the peel only decides
// WHICH handover runs, the effect starts animation and timer and tears both
// down in its cleanup, so an unmount midway leaves neither behind.
type Mode = 'sealed' | 'handover' | 'fade';

export function SealedLetter({
  width, title, range, facts, faces, onOpening, onOpened, testID,
}: {
  // Width of the card in points. The wax derives its own size from it, so
  // the two never drift apart.
  width: number;
  // All four are null/empty while the trip is still loading, see above.
  title: string | null;
  range: string | null;
  facts: string | null;
  faces: Face[];
  // Reported the moment the seal comes off and the card begins to withdraw:
  // the show behind it may start HERE, while the seal is still dissolving
  // over it.
  onOpening: () => void;
  // Reported once nothing of the letter is left to see, seal included.
  onOpened: () => void;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>('sealed');
  const [opacity] = useState(() => new Animated.Value(1));
  const [scale] = useState(() => new Animated.Value(1));
  const [contentOut] = useState(() => new Animated.Value(1));
  // Starts opaque when the trip was already loaded at mount: the fade below
  // belongs to content ARRIVING, and a letter that has everything from the
  // first frame has nothing to fade in.
  const [contentIn] = useState(() => new Animated.Value(title !== null ? 1 : 0));
  const wasLoaded = useRef(title !== null);
  // Always the current callback, so a new identity from outside does not
  // restart the running handover (the screen defines it inline).
  const onOpenedRef = useRef(onOpened);
  useEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);
  const onOpeningRef = useRef(onOpening);
  useEffect(() => {
    onOpeningRef.current = onOpening;
  }, [onOpening]);

  const stage = (width * WAX_SHARE) / SEAL_IN_STAGE;
  const cardHeight = width / TICKET_ASPECT;
  const hasContent = title !== null;

  // The lines do not pop in when the load finishes, they arrive. No title
  // growing along with it: that breath is the day card's signature, and
  // repeating it here seconds earlier would spend it twice.
  useEffect(() => {
    if (!hasContent || wasLoaded.current) return;
    wasLoaded.current = true;
    const entrance = Animated.timing(contentIn, {
      toValue: 1,
      duration: reducedMotion ? REDUCED_HANDOVER_MS : motion.duration.gentle,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [hasContent, reducedMotion, contentIn]);

  useEffect(() => {
    if (mode === 'sealed') return;
    const reduced = mode === 'fade';
    const easing = Easing.bezier(...motion.easeSmooth);
    const leaving = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduced ? REDUCED_HANDOVER_MS : HANDOVER_MS,
        easing,
        useNativeDriver: true,
      }),
      // The letter withdraws by growing a touch, the way a title card gives
      // way to what it announced. Skipped entirely with reduced motion.
      Animated.timing(scale, {
        toValue: reduced ? 1 : 1.03,
        duration: reduced ? 0 : HANDOVER_MS,
        easing,
        useNativeDriver: true,
      }),
      // The lines go first (see CONTENT_OUT_MS): they multiply with the
      // card's own opacity, so this only ever runs AHEAD of it.
      Animated.timing(contentOut, {
        toValue: 0,
        duration: reduced ? REDUCED_HANDOVER_MS : CONTENT_OUT_MS,
        easing,
        useNativeDriver: true,
      }),
    ]);
    leaving.start();
    return () => leaving.stop();
  }, [mode, opacity, scale, contentOut]);

  // Both moments come from the seal, so there is only ONE clock: it comes off
  // (the card withdraws, the show starts), and later nothing of it is left
  // (the letter is done).
  const liftOff = () => {
    if (mode !== 'sealed') return;
    // Captured HERE, not read inside the effect: someone toggling the setting
    // mid-handover must not restart what is already leaving.
    setMode(reducedMotion ? 'fade' : 'handover');
    onOpeningRef.current();
  };

  return (
    // Fills the screen, because the show is already running UNDERNEATH once
    // the seal is off: without a ground of its own the first moment would
    // show through around the card from the first frame.
    <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Withdraws on the SAME opacity as the card, so the show fades in
          rather than being uncovered in one cut. The ground is the cinema
          hall the ticket admits into (trial, 27.08.); the painted colour
          stays underneath so nothing shines through during its first
          decode. */}
      <Animated.View
        testID="letter-backdrop"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette['bg-0'], opacity }]}
        pointerEvents="none"
      >
        <Image
          testID="letter-backdrop-image"
          source={require('@/assets/images/kino.png')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      </Animated.View>
      {/* The wax is a SIBLING of the card, not a child: it hangs over the
          lower edge, and a rounded card that clips (Android) would cut it in
          half. */}
      <View style={[styles.stage, { width }]}>
      <Animated.View testID="letter-card" style={[styles.card, { opacity, transform: [{ scale }] }]}>
        {/* The picture IS the card: frame, embossing, perforation and stub
            all come from the asset, no surface or hairline of our own. */}
        <Image
          testID="letter-ticket"
          source={require('@/assets/images/reelive-kino-ticket.png')}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
        />
        <Animated.View testID="letter-inner" style={[styles.inner, { opacity: contentOut }]}>
        <Text style={[type.bodyMedium, styles.chapter]}>Dein Recap</Text>

        {hasContent && (
          <Animated.View style={[styles.content, { opacity: contentIn }]}>
            {/* Stretched so adjustsFontSizeToFit measures the full width, the
                title centred within it: exactly the day card's construction,
                so a long place name shrinks instead of wrapping. */}
            <View style={styles.titleWrap}>
              <Text
                testID="letter-title"
                style={[type.display, styles.title]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.35}
              >
                {title}
              </Text>
            </View>
            {range && (
              <Text testID="letter-range" style={[type.body, styles.meta]}>{range}</Text>
            )}
            {facts && (
              <Text testID="letter-facts" style={[type.body, styles.metaTight]}>{facts}</Text>
            )}
            {faces.length > 0 && (
              <View testID="letter-faces" style={styles.cast}>
                <AvatarGroup faces={faces} />
              </View>
            )}
          </Animated.View>
        )}

        </Animated.View>
      </Animated.View>

      {/* Deliberately NOT under the card's `opacity`: the card withdraws while
          the seal is still dissolving over it, and fading the wax along with
          it would cut its own dissolve short. Centred on the perforation, so
          the peel reads as tearing the ticket open. */}
      <View
        testID="letter-wax"
        style={[
          styles.wax,
          {
            width: stage,
            height: stage,
            marginLeft: -stage / 2,
            top: cardHeight * TICKET_PERFORATION_Y - stage / 2,
          },
        ]}
      >
        <SealPeel
          size={stage}
          onLiftOff={liftOff}
          onPeeled={() => onOpenedRef.current()}
          testID={testID ? `${testID}-seal` : undefined}
        />
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred in the full-screen root above.
  stage: { alignItems: 'center', alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  // The ticket dictates the card's shape; height follows the asset so the
  // perforation maths above holds at any width.
  card: {
    alignSelf: 'stretch',
    aspectRatio: TICKET_ASPECT,
  },
  // The lines live in the ticket's main compartment, above the perforation,
  // centred clear of the notch cut into the top edge. Own node with its own
  // opacity, so they can leave ahead of the card.
  inner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: `${TICKET_MAIN_END * 100}%`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '11%',
  },
  // Tracked wide the way film chapters are set.
  chapter: { color: palette['text-2'], letterSpacing: 3.5 },
  content: { alignSelf: 'stretch', alignItems: 'center' },
  titleWrap: { alignSelf: 'stretch', marginTop: spacing.s },
  title: { color: palette['text-1'], textAlign: 'center' },
  meta: { color: palette['text-2'], marginTop: spacing.base },
  metaTight: { color: palette['text-2'], marginTop: spacing.xs },
  cast: { flexDirection: 'row', marginTop: spacing.m },
  wax: { position: 'absolute', left: '50%' },
});
