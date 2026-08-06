import { Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px weisser Ring, Gruppen −8 px
// überlappend. Bis zum Avatar-Upload (Phase 4) trägt der Kreis die Initiale.
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: colors['bg-1'],
        borderWidth: 2,
        borderColor: colors['bg-0'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={[type.label, { color: colors['text-2'] }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const { colors } = useTheme();
  const sichtbar = names.slice(0, max);
  const rest = names.length - sichtbar.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {sichtbar.map((name, i) => (
        <View key={`${name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar name={name} />
        </View>
      ))}
      {rest > 0 && (
        <Text style={[type.secondary, { color: colors['text-2'], marginLeft: 8 }]}>{`+${rest}`}</Text>
      )}
    </View>
  );
}
