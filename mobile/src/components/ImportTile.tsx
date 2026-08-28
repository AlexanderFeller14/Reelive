import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, Film, TriangleAlert, X } from 'lucide-react-native';
import { Pill } from './Pill';
import { PressScale } from './PressScale';
import { cinema, radius, spacing, type } from '@/theme/tokens';

export type TileStatus = 'ready' | 'converting' | 'preparing' | 'done' | 'failed';

type Props = {
  thumb: string | null;
  kind: 'photo' | 'video';
  durationS: number | null;
  status: TileStatus;
  progress: number;
  reason: string | null;
  onRemove: (() => void) | null;
  size: number;
  testID?: string;
};

const REMOVE_SIZE = 28;

// One element of the review grid (spec 2026-08-28-fotos-import-pruefung):
// the picture (or a placeholder while a video's still frame loads), the
// video badge, the x while the element can still be dropped, and the
// batch status once submitting has started. A refused element is dimmed
// and names its reason instead of offering the x.
export function ImportTile({ thumb, kind, durationS, status, progress, reason, onRemove, size, testID }: Props) {
  const refused = reason !== null;
  const removable = onRemove !== null && !refused && status === 'ready';
  const id = testID ?? 'import-tile';
  return (
    <View style={[styles.tile, { width: size, height: size }]} testID={id}>
      {thumb ? (
        <Image
          testID={`${id}-image`}
          accessible={false}
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : (
        <View testID={`${id}-placeholder`} style={[StyleSheet.absoluteFill, styles.center]}>
          {kind === 'video' ? (
            <Film size={22} color={cinema['text-2']} strokeWidth={1.75} />
          ) : (
            <ActivityIndicator color={cinema['text-2']} />
          )}
        </View>
      )}
      {refused && <View style={[StyleSheet.absoluteFill, styles.dim]} />}
      {kind === 'video' && durationS != null && !refused && (
        <Pill style={styles.badge}>
          <Film size={12} color={cinema['text-1']} strokeWidth={1.75} />
          <Text style={[type.label, { color: cinema['text-1'] }]}>{`${durationS} s`}</Text>
        </Pill>
      )}
      {refused && (
        <Pill testID={`${id}-reason`} style={styles.badge}>
          <Text style={[type.label, { color: cinema['text-1'] }]}>{reason}</Text>
        </Pill>
      )}
      {removable && (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="Aus der Auswahl entfernen"
          testID={`${id}-remove`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.removeWrap}
          onPress={onRemove}
        >
          <Pill style={styles.remove}>
            <X size={16} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </PressScale>
      )}
      {status === 'converting' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <Text style={[type.label, { color: cinema['text-1'] }]}>{`${Math.round(progress * 100)} %`}</Text>
          </Pill>
        </View>
      )}
      {status === 'preparing' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <ActivityIndicator color={cinema['text-1']} />
          </Pill>
        </View>
      )}
      {status === 'done' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} accessibilityLabel="Eingesendet" style={styles.status}>
            <Check size={18} color={cinema['text-1']} strokeWidth={1.75} />
          </Pill>
        </View>
      )}
      {status === 'failed' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Pill testID={`${id}-status`} style={styles.status}>
            <TriangleAlert size={16} color={cinema['text-1']} strokeWidth={1.75} />
            <Text style={[type.label, { color: cinema['text-1'] }]}>Nicht gesichert</Text>
          </Pill>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: cinema['bg-1'],
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  // A refused element steps back: the pill colour as a wash over the
  // picture, the same ink the pills are made of.
  dim: { backgroundColor: cinema['overlay-pill'] },
  badge: {
    position: 'absolute',
    left: spacing.s,
    bottom: spacing.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  removeWrap: { position: 'absolute', top: spacing.s, right: spacing.s },
  remove: {
    width: REMOVE_SIZE,
    height: REMOVE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
});
