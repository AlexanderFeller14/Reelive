import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { FadeIn } from '@/components/FadeIn';
import { PressScale } from '@/components/PressScale';
import { StatusBarCover } from '@/components/StatusBarCover';
import { AddTripRow, TripRow } from '@/components/TripRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import type { CachedTrip } from '@/features/trips/tripsCache';

// "Für welche Reise?" (spec 2026-08-27 "Reisewahl"): the light list the
// camera tab shows when more than one trip is running and none is chosen
// yet, and the switcher behind the head pill of the viewfinder. Reads top
// to bottom in the Airbnb inbox mould: H1, one sentence, a caption, then a
// row per running trip separated by hairlines, and the add row last.
//
// Whether there is a way back depends on how it was opened: from the
// viewfinder (`onClose` set) the head carries the round close button and
// the current trip its check; opened automatically there is nothing to go
// back to, so neither shows.
const CLOSE = 40;

export function TripPickerScreen({
  trips, today, selectedId = null, onSelect, onClose, onCreate,
}: {
  trips: CachedTrip[];
  today: string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClose?: () => void;
  onCreate: () => void;
}) {
  const { colors } = useTheme();
  // Read top to bottom, and therefore in need of the spared top edge (the
  // viewfinder lays its pill on the camera image instead).
  const topInset = useTopInset(spacing.xl);
  const divided = [styles.divided, { borderTopColor: colors.line }];

  return (
    <View style={[styles.screen, { backgroundColor: colors['bg-0'] }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <View style={styles.head}>
          <Text style={[type.h1, styles.title, { color: colors['text-1'] }]}>Für welche Reise?</Text>
          {onClose && (
            <PressScale
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
              onPress={onClose}
            >
              <View style={[styles.close, { backgroundColor: colors['bg-1'] }]}>
                <X size={20} color={colors['text-1']} strokeWidth={1.75} />
              </View>
            </PressScale>
          )}
        </View>
        <Text style={[type.secondary, styles.subtitle, { color: colors['text-2'] }]}>
          Dein Moment landet auf ihrer Filmrolle.
        </Text>
        <Text style={[type.label, styles.caption, { color: colors['text-2'] }]}>Laufende Reisen</Text>
        {trips.map((trip, index) => (
          <FadeIn key={trip.id} position={index}>
            {/* The hairline sits between rows, never above the first (§3). */}
            <View style={index > 0 ? divided : undefined}>
              <TripRow
                trip={trip}
                today={today}
                position={index}
                selected={trip.id === selectedId}
                onPress={() => onSelect(trip.id)}
              />
            </View>
          </FadeIn>
        ))}
        <FadeIn position={trips.length}>
          <View style={divided}>
            <AddTripRow onPress={onCreate} />
          </View>
        </FadeIn>
      </ScrollView>
      {/* The one scrolling list of the camera tab, so the one place there
          that needs the opaque strip. The viewfinder and the preview stay
          without it, there the photo scrim carries the top edge (§1). */}
      <StatusBarCover />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.screen },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.base,
  },
  // The shrink share belongs to the title, the button keeps its 40.
  title: { flexShrink: 1 },
  close: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: { marginTop: spacing.s },
  caption: { marginTop: spacing.l, marginBottom: spacing.m },
  divided: { borderTopWidth: 1 },
});
