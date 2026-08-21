import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Play } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { placeholderCover } from '@/features/trips/placeholderCover';

// Task 9 (recap-show plan): replaces header, H1, seal stage and popcorn on
// the recap overview. The seal used to gate this screen; now it only stands
// in the player (Task 2-4), and a tap on a recap card opens the show
// directly (Task 5), so this screen is where the show LANDS rather than
// where it starts. It opens with the trip's own photo instead of stock
// chrome, carrying the way back and the way to watch again as pills on it.
export function RecapHero({
  title, subtitle, coverUrl, position = 0, onBack, onPlay,
}: {
  title: string;
  subtitle: string;
  coverUrl: string | null;
  // The card in the tab list picks its placeholder by list index, so two
  // stacked cards never show the same one (see TripCover). A single hero
  // has no list to stand in, hence optional with the same default.
  position?: number;
  onBack: () => void;
  onPlay: () => void;
}) {
  return (
    <View style={styles.cover}>
      <Image
        testID="recap-hero-image"
        source={coverUrl ? { uri: coverUrl } : placeholderCover(position)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessible={false}
      />
      {/* Photo scrims, the only gradient the app allows (DESIGN-LANGUAGE
          §1): one at each edge, so the pills up top and the title down low
          keep their contrast regardless of what the photo shows there. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'transparent']}
        style={styles.scrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.35)']}
        style={styles.scrimBottom}
        pointerEvents="none"
      />

      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Zurück"
        onPress={onBack}
        style={styles.backWrap}
      >
        <Pill style={styles.iconPill}>
          <ChevronLeft size={24} color={palette['bg-0']} strokeWidth={1.75} />
        </Pill>
      </PressScale>

      <PressScale
        testID="recap-hero-play"
        accessibilityRole="button"
        accessibilityLabel="Recap nochmal ansehen"
        onPress={onPlay}
        style={styles.playWrap}
      >
        <Pill style={styles.playPill}>
          <Play size={16} color={palette['bg-0']} strokeWidth={1.75} />
          <Text style={[type.bodyMedium, { color: palette['bg-0'] }]}>Nochmal ansehen</Text>
        </Pill>
      </PressScale>

      <View style={styles.titleBlock}>
        <Text
          testID="recap-hero-title"
          style={[type.h2, { color: palette['bg-0'] }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        <Text style={[type.secondary, { color: palette['bg-0'] }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same recipe as TripCover (DESIGN-LANGUAGE v2 §4): 3:2, 24 px radius,
  // `overflow: hidden` so the absolutely filled photo and scrims clip at
  // the rounded corners instead of squaring them off.
  cover: { aspectRatio: 3 / 2, borderRadius: radius.card, overflow: 'hidden' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '35%' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  backWrap: { position: 'absolute', top: spacing.m, left: spacing.m },
  playWrap: { position: 'absolute', top: spacing.m, right: spacing.m },
  // 44, the same height as the segment pills below the hero and the map
  // screen's own back pill, so a thumb finds the same target everywhere.
  iconPill: {
    width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
  },
  playPill: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
  },
  titleBlock: {
    position: 'absolute', left: spacing.m, right: spacing.m, bottom: spacing.m, gap: spacing.xs,
  },
});
