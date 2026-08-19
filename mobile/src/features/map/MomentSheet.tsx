import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/Button';
import { PressScale } from '@/components/PressScale';
import { SHEET_SCROLL_RATIO } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import type { RecapMoment } from '@/features/recap/types';
import { timeInZone } from '@/features/recap/timeOfDay';
import { momentLabel } from './pin';
import type { MapPoint } from './types';

// What a tap on a pin shows: the single moment and, where several sit on
// the same coordinate, their list (Spec §5.7). The same surface, needed in
// two places: on the map in the app (recap/[id]/karte.tsx) and on the map
// of the shared recap (teilen/[token].tsx).
//
// It lived here twice in the project until now, about 250 lines, in this
// order: first the app version, then the shared one, which took it over.
// Both carried comments pointing at the other one, and that's exactly the
// state where a change in one place silently reaches only half the app.
//
// What REALLY distinguishes the two screens is two things, and both are
// props here: the button's label (the app jumps into its recap player, the
// shared recap into the player on the same page) and the testID prefix.
//
// This file lives in features/map, not in components: it knows `MapPoint`,
// i.e. the map. And it deliberately pulls in NOTHING native, react-native-maps
// doesn't appear here. The shared recap also runs in the browser bundle
// (see teilen/__tests__/modulgraph.test.ts), and an import from there would
// be the end of the web export.

// What an image can be loaded from. Deliberately narrower than the two
// types the callers hold (`MedienUrl` from urlVorrat.ts additionally
// carries `post_id`, `MedienLink` in teilen/[token].tsx is structurally
// this one): exactly these two fields are needed, and asking for less
// accepts both without a screen having to rebuild its type.
export type ImageSource = { medium_url: string; thumb_url: string | null };

// A URL an image can actually be loaded from, or `null`.
//
// `medium_url` is typed as `string` in both source types, but is taken
// over unchecked from an Edge Function's response (urlVorrat.ts checks the
// SHAPE of the response, not every field of every moment; shareApi.ts
// likewise). If the field is missing there, the type lies, and without
// this check an `undefined` would go to the pin as an image source.
export function usableUrl(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function pinImageUrl(
  urls: ReadonlyMap<string, ImageSource>,
  momentId: string
): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return usableUrl(url.thumb_url) ?? usableUrl(url.medium_url);
}

export function sheetImageUrl(
  urls: ReadonlyMap<string, ImageSource>,
  momentId: string
): string | null {
  const url = urls.get(momentId);
  if (!url) return null;
  return usableUrl(url.medium_url) ?? usableUrl(url.thumb_url);
}

// "Mira · 14:32" (Spec §5.7). The time uses the same formatting as in the
// player and at the pin (features/recap/timeOfDay.ts): it shows the time
// in `captured_tz`, the local time back then, not one converted to device
// time.
export function authorAndTime(moment: RecapMoment): string {
  return `${moment.authorName} · ${timeInZone(moment.captured_at, moment.captured_tz)}`;
}

// DESIGN-LANGUAGE §5: "lists = 40ms stagger", the rows of a list appear one
// after another, not as a block. And "prefers-reduced-motion: everything
// becomes a 200ms fade", the same value as in Sheet.tsx (module-private
// there).
const STAGGER_MS = 40;
const REDUCED_DURATION_MS = 200;

// The scrolling area of a sheet. Both sheets use it: the list of a
// cluster, because it can grow arbitrarily long, and the single moment,
// because image (3:2), place and caption together get taller than the
// sheet at large system font sizes, where the primary button would
// otherwise become unreachable. It therefore sits OUTSIDE this area and
// stays put while the content above it scrolls.
//
// The fraction and its reasoning live in components/Sheet.tsx, because
// they follow from that component's own cap.
export function SheetScroll({ testID, children }: { testID: string; children: ReactNode }) {
  const { height: windowHeight } = useWindowDimensions();
  return (
    <ScrollView
      testID={testID}
      style={{ maxHeight: windowHeight * SHEET_SCROLL_RATIO }}
      // The gap between children is otherwise held by `Sheet` itself
      // (styles.inhalt, `gap`), inside the ScrollView it no longer
      // applies, so it's repeated here with the same value.
      contentContainerStyle={styles.scrollContent}
    >
      {children}
    </ScrollView>
  );
}

// A row that fades in. Its own component because every row needs its own
// Animated.Value: §5 requires a 40ms stagger for lists, and that's its own
// delay per row. All lists of the map sheets use it (moments of a cluster,
// trip days, tiles of moments without a place), copies eventually ran at
// different rhythms.
export function FadeIn({ position, children }: { position: number; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  // `useState` with an initializer instead of `useRef(...).current`: both
  // create the value exactly once, but reading a ref while rendering is a
  // lint error (react-hooks/refs).
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // §5: with reduced motion everything becomes a single 200ms fade, the
    // rows then appear together, without staggering. Only `opacity` is
    // animated, so it runs on the UI thread.
    Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? REDUCED_DURATION_MS : motion.duration.base,
      delay: reducedMotion ? 0 : position * STAGGER_MS,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    }).start();
  }, [opacity, reducedMotion, position]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

// What the two screens make differently at their sheets, as ONE value.
//
// `prefix` deliberately has no default and is required: with `''` as a
// default, a forgotten prop wouldn't be an error but two screens with the
// same testIDs, and the day that shows up is the day a test checks the
// wrong screen. The app version passes the empty string, because its IDs
// have stood in the tests since Phase 7 and a prefix there would be a
// rename with no benefit.
export type SheetForm = {
  /** Label of the primary button in the moment sheet. */
  buttonLabel: string;
  /** Placed before every testID, e.g. `'teilen-'`. Empty is allowed. */
  prefix: string;
};

// The single moment in the sheet (Spec §5.7): image 3:2 with radius 24
// (DESIGN-LANGUAGE §3), below it author/time, place and caption, and ONE
// primary button (§4: exactly one per screen; the cluster list below
// therefore has none).
//
// A LIGHT sheet, even in the shared recap whose player is cinema: it opens
// over the map, and that, as in the app, is a light tool for finding, not
// a media fullscreen (Spec §5.3). The same moment thus looks the same in
// both places.
export function MomentSheetContent({
  point, imageUrl, form, onView,
}: {
  point: MapPoint;
  imageUrl: string | null;
  form: SheetForm;
  onView: (point: MapPoint) => void;
}) {
  const { colors } = useTheme();
  const { moment } = point;
  return (
    <>
      {/* Image and text scroll, the button stays: at large system font
          sizes, image (3:2), place and caption alone reach past the
          sheet's bottom edge, and the button would no longer be
          reachable. */}
      <SheetScroll testID={`${form.prefix}moment-inhalt`}>
        <View style={[styles.sheetImage, { backgroundColor: colors['bg-1'] }]}>
          {/* Without a usable URL, the calm bg-1 surface stays, no pulse:
              nothing more is coming (same distinction as in the pin
              skeleton, components/KartenNadel.tsx). */}
          {imageUrl !== null && (
            <Image
              testID={`${form.prefix}sheet-bild`}
              source={{ uri: imageUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={motion.duration.fast}
            />
          )}
        </View>
        <View style={styles.sheetText}>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{authorAndTime(moment)}</Text>
          {moment.place_name ? (
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{moment.place_name}</Text>
          ) : null}
          {moment.caption ? (
            <Text style={[type.body, { color: colors['text-1'] }]}>{moment.caption}</Text>
          ) : null}
        </View>
      </SheetScroll>
      <Button variant="primary" label={form.buttonLabel} onPress={() => onView(point)} />
    </>
  );
}

// A row of the cluster list.
export function ClusterEntry({
  point, thumbUrl, position, form, onView,
}: {
  point: MapPoint;
  thumbUrl: string | null;
  position: number;
  form: SheetForm;
  onView: (point: MapPoint) => void;
}) {
  const { colors } = useTheme();
  const { moment } = point;

  return (
    <FadeIn position={position}>
      <PressScale
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={momentLabel(moment)}
        testID={`${form.prefix}gruppe-eintrag-${moment.id}`}
        onPress={() => onView(point)}
      >
        <View style={rowStyles.row}>
          {/* Small and square: radius 12 is the thumbnail value
              (DESIGN-LANGUAGE §3), 24 belongs to the large image above. */}
          <View style={[styles.entryImage, { backgroundColor: colors['bg-1'] }]}>
            {thumbUrl !== null && (
              <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
          </View>
          <View style={rowStyles.text}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{authorAndTime(moment)}</Text>
            {moment.caption ? (
              <Text numberOfLines={1} style={[type.secondary, { color: colors['text-2'] }]}>
                {moment.caption}
              </Text>
            ) : null}
          </View>
        </View>
      </PressScale>
    </FadeIn>
  );
}

// The moments of a cluster that can't be zoomed apart
// (features/map/clusterTap.ts, `zoomExhausted`). Every entry leads into the
// player the same way as a single moment, and none of them is a primary
// button: there's exactly one per screen, and the moment sheet carries it.
export function ClusterSheetContent({
  points, urls, form, onView,
}: {
  points: MapPoint[];
  urls: ReadonlyMap<string, ImageSource>;
  form: SheetForm;
  onView: (point: MapPoint) => void;
}) {
  return (
    // The list scrolls (see SheetScroll): arbitrarily many moments can sit
    // on one spot, and zooming by definition doesn't help there, cut-off
    // entries would be unreachable any other way.
    <SheetScroll testID={`${form.prefix}gruppe-liste`}>
      {points.map((p, position) => (
        <ClusterEntry
          key={p.moment.id}
          point={p}
          thumbUrl={pinImageUrl(urls, p.moment.id)}
          position={position}
          form={form}
          onView={onView}
        />
      ))}
    </SheetScroll>
  );
}

// The shape of a row in a sheet list. Exported because the app's map
// screen needs the same shape for its day list: it sits in the same sheet
// space and must not look different from the cluster list next to it.
export const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  // `flex: 1` takes the rest of the row, without it a long caption would
  // push the row past the edge instead of being cut off by
  // `numberOfLines`.
  text: { flex: 1, gap: spacing.xs },
});

const styles = StyleSheet.create({
  // Spec §5.7: image at 3:2, radius 24 (DESIGN-LANGUAGE §3, the cover
  // value). `overflow: hidden` clips the image to this radius; it carries
  // no shadow, that belongs to the sheet underneath.
  sheetImage: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  // Tighter than the gap the sheet holds between its children: the three
  // rows belong together (4pt grid, §3).
  sheetText: { gap: spacing.xs },
  // The same gap `Sheet` holds between its own children, it no longer
  // applies inside the ScrollView.
  scrollContent: { gap: spacing.base },
  entryImage: { width: 56, height: 56, borderRadius: radius.control, overflow: 'hidden' },
});
