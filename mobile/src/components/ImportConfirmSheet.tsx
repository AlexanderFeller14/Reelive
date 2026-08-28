import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Film } from 'lucide-react-native';
import { Sheet } from './Sheet';
import { CinemaButton, CinemaTextLink } from './CinemaButton';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import type { AcceptedMedia } from '@/features/moments/libraryImport';

type Props = {
  visible: boolean;
  accepted: AcceptedMedia[];
  // The preview-tense refusal summary (refusalSummary(..., 'preview')), or
  // null when everything picked passed the rules.
  summary: string | null;
  onConfirm: () => void;
  onClose: () => void;
  // Forwarded to Sheet, see the prop's comment there: the capture screen
  // hands in the cinema tab bar's height so the submit button and
  // "Abbrechen"/"Verstanden" clear the bar.
  bottomInset?: number;
};

const THUMB = 64;

function momentsText(count: number): string {
  return count === 1 ? '1 Moment' : `${count} Momente`;
}

// The confirmation after the picker (decision 2026-08-27): what would go
// in, as thumbnails and a count, what stays out and why, then the choice
// to submit or to cancel. A cancel releases every picked copy (the caller
// does that in onClose); nothing has entered the queue at this point.
export function ImportConfirmSheet({ visible, accepted, summary, onConfirm, onClose, bottomInset }: Props) {
  const count = accepted.length;
  if (count === 0) {
    return (
      <Sheet
        visible={visible}
        title="Nichts zum Einsenden"
        onClose={onClose}
        cinemaMode
        bottomInset={bottomInset}
      >
        {summary ? <Text style={[type.body, { color: cinema['text-1'] }]}>{summary}</Text> : null}
        <CinemaButton label="Verstanden" onPress={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} title="Einsenden?" onClose={onClose} cinemaMode bottomInset={bottomInset}>
      {/* A video's frame is not on hand yet (prepareVideo renders it only
          when submitting), so a video shows as a dark film tile; photos
          come straight from the picker copy. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {accepted.map((item) =>
          item.media.kind === 'photo' ? (
            <Image
              key={item.media.uri}
              testID="import-thumb-photo"
              accessible={false}
              source={{ uri: item.media.uri }}
              style={styles.thumb}
              contentFit="cover"
            />
          ) : (
            <View key={item.media.uri} testID="import-thumb-video" style={[styles.thumb, styles.videoTile]}>
              <Film size={22} color={cinema['text-2']} strokeWidth={1.75} />
            </View>
          )
        )}
      </ScrollView>
      <Text style={[type.body, { color: cinema['text-1'] }]}>
        {count === 1 ? '1 Moment passt in den Reisezeitraum.' : `${count} Momente passen in den Reisezeitraum.`}
      </Text>
      {summary ? <Text style={[type.secondary, { color: cinema['text-2'] }]}>{summary}</Text> : null}
      <CinemaButton label={`${momentsText(count)} einsenden`} onPress={onConfirm} />
      <CinemaTextLink label="Abbrechen" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: spacing.s },
  // Thumbnails at radius 12 (DESIGN-LANGUAGE §3), a fixed square so the
  // strip scrolls instead of the sheet growing.
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, overflow: 'hidden' },
  videoTile: { backgroundColor: cinema['bg-0'], alignItems: 'center', justifyContent: 'center' },
});
