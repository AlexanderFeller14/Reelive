import { Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { avatarUrl } from '@/features/auth/avatar';

// DESIGN-LANGUAGE v2 §4: round, 32-44 px, 2 px white ring, groups
// overlapping by -8 px. Without an image the circle carries the initial.
//
// The shape lives in `circle()`, because it's needed twice: once for a
// face, once for the group's "+5" circle. Both must be exactly the same
// size and the same roundness, otherwise the last circle in an overlapping
// row immediately stands out as a foreign body.
function circle(size: number, surface: string, ring: string): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: radius.pill,
    backgroundColor: surface,
    borderWidth: 2,
    borderColor: ring,
    alignItems: 'center',
    justifyContent: 'center',
    // The image is square and would otherwise stick out past the rounding.
    overflow: 'hidden',
  };
}

// Name AND key belong together: whoever draws a face needs the image if
// there is one, and otherwise the name for the initial. Two separate lists
// (names here, keys there) would inevitably drift apart.
export type Face = { name: string; avatarKey: string | null };

// `cinemaMode` is an explicit switch and not derivable from the theme:
// ThemeProvider is light-only, but the cinema palette applies in the
// recap player and the shared recap. Same reasoning as with
// Sheet.cinemaMode.
export function Avatar({
  name, avatarKey = null, size = 36, cinemaMode = false,
}: {
  name: string;
  avatarKey?: string | null;
  size?: number;
  cinemaMode?: boolean;
}) {
  const { colors } = useTheme();
  const surface = cinemaMode ? cinema['bg-1'] : colors['bg-1'];
  // In the light palette, the ring separates overlapping faces from the
  // surface behind them (facepile, DESIGN-LANGUAGE §4), hence the same
  // color as the page background (`bg-0`), the ring deliberately
  // disappears visually into its surroundings there.
  //
  // In the cinema, a different reading of the same rule applies, not the
  // same color choice: both current usage sites (recap player, shared
  // recap) show exactly ONE face on a photo, not an overlapping group that
  // would need to stand out from the background. There, §4's LITERAL "2 px
  // white ring" applies directly, `cinema['text-1']` is the lightest
  // cinema color and the closest available substitute for white within the
  // palette (the same choice was already made by the deleted local
  // AvatarInitiale copy in player.tsx before Task 9). Do NOT unify this
  // with the light-palette line above: the two rings answer different
  // questions (facepile separator vs. literal white ring), they only
  // coincidentally land on the same name.
  const ring = cinemaMode ? cinema['text-1'] : colors['bg-0'];
  const textColor = cinemaMode ? cinema['text-1'] : colors['text-2'];
  const url = avatarUrl(avatarKey);
  // §4 ends at 44 px, anything above that is the profile tab's hero
  // header image (image swap 2026-08-13). There the 12 px label initial
  // would be lost; the display format is the only size on the scale (§2:
  // don't invent new ones) that can carry a 160 px circle.
  const initialStyle = size > 44 ? type.display : type.label;

  return (
    <View testID="avatar-circle" style={circle(size, surface, ring)}>
      {/* The initial always stays in the tree, the image lays on top of
          it. This way the circle carries something while loading (otherwise
          an empty surface would flash and the whole facepile would jump),
          and an image that fails to load falls back to the initial instead
          of a hole. */}
      <Text style={[initialStyle, { color: textColor }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
      {url && (
        <Image
          testID="avatar-image"
          source={{ uri: url }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          contentFit="cover"
          accessible={false}
        />
      )}
    </View>
  );
}

// The facepile, Airbnb-style: three faces, the rest gets counted.
//
// The rest is a fourth CIRCLE in the same row, not a text line next to it.
// That's the difference that makes the group read as one thing ("eight
// people") instead of three pictures with a footnote. It therefore
// overlaps like every face before it (§4), set apart it would be a
// footnote again.
//
// No tap behavior of its own: whoever needs the group to be pressable
// wraps `PressScale` around it. In the trip card, the whole card is
// already a tap target, a second one nested inside it would tear it
// apart.
export function AvatarGroup({
  faces, max = 3, cinemaMode = false,
}: {
  faces: Face[];
  max?: number;
  cinemaMode?: boolean;
}) {
  const { colors } = useTheme();
  const visibleFaces = faces.slice(0, max);
  const rest = faces.length - visibleFaces.length;
  const surface = cinemaMode ? cinema['bg-1'] : colors['bg-1'];
  // Ring and text color follow the SAME line as in `Avatar` above, not a
  // second one: the "+N" circle sits in the same overlapping row as the
  // faces before it, drawn by the same `circle()` function. Nobody reads
  // two different rings in one row as intentional, only as a bug.
  //
  // Before the merge fix round, `cinema['bg-0']`/`cinema['text-2']` stood
  // here, exactly the values `Avatar` carried BEFORE fix round 1 (commit
  // 7b95f51). The correction there deliberately left the group as-is,
  // because it isn't rendered anywhere with `cinemaMode` to this day: the
  // result, though, was a crack running right through a single component,
  // and "unused today" is not a reason for two answers to the same
  // question.
  //
  // WHICH reading ultimately wins is thus NOT decided here, only unified.
  // For an overlapping facepile on a dark background, the separator
  // reading (ring in `cinema['bg-0']`, the color of the cinema background,
  // the same logic by which the light palette takes `bg-0`) makes more
  // sense than §4's literal "2 px white ring", which `Avatar` implements
  // today because both of its usage sites show individual faces on
  // photos. Whoever switches to that on the first real cinema facepile
  // switches BOTH spots, children AND "+N"; otherwise the crack has just
  // moved to the other side.
  const ring = cinemaMode ? cinema['text-1'] : colors['bg-0'];
  const textColor = cinemaMode ? cinema['text-1'] : colors['text-2'];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {visibleFaces.map((face, i) => (
        <View key={`${face.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -spacing.s }}>
          <Avatar name={face.name} avatarKey={face.avatarKey} cinemaMode={cinemaMode} />
        </View>
      ))}
      {rest > 0 && (
        <View
          testID="avatar-rest"
          style={[circle(36, surface, ring), { marginLeft: -spacing.s }]}
        >
          <Text style={[type.label, { color: textColor }]}>{`+${rest}`}</Text>
        </View>
      )}
    </View>
  );
}
