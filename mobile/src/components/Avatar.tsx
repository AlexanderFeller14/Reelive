import { Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';

// DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px weisser Ring, Gruppen −8 px
// überlappend. Bis zum Avatar-Upload trägt der Kreis die Initiale.
//
// Die Form steckt in `kreis()`, weil sie zweimal gebraucht wird: einmal für
// ein Gesicht, einmal für den «+5»-Kreis der Gruppe. Beide müssen exakt
// gleich gross und gleich gerundet sein, sonst fällt der letzte Kreis in
// einer überlappenden Reihe sofort als Fremdkörper auf.
function kreis(size: number, flaeche: string, ring: string): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: radius.pill,
    backgroundColor: flaeche,
    borderWidth: 2,
    borderColor: ring,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={kreis(size, colors['bg-1'], colors['bg-0'])}>
      <Text style={[type.label, { color: colors['text-2'] }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

// Die Facepile nach Airbnb-Vorbild: drei Gesichter, der Rest wird gezählt.
//
// Der Rest ist ein vierter KREIS in derselben Reihe, keine Textzeile daneben.
// Das ist der Unterschied, an dem die Gruppe als eine Sache gelesen wird
// («acht Leute») statt als drei Bilder mit einer Fussnote. Er überlappt
// deshalb wie jedes Gesicht davor (§4), abgesetzt wäre er wieder eine
// Fussnote.
//
// Ohne eigenes Tap-Verhalten: wer die Gruppe drückbar braucht, legt
// `PressScale` darum. In der Reise-Karte ist bereits die ganze Karte ein
// Tap-Ziel, ein zweites darin liegendes würde sie zerteilen.
export function AvatarGroup({ names, max = 3 }: { names: string[]; max?: number }) {
  const { colors } = useTheme();
  const sichtbar = names.slice(0, max);
  const rest = names.length - sichtbar.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {sichtbar.map((name, i) => (
        <View key={`${name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -spacing.s }}>
          <Avatar name={name} />
        </View>
      ))}
      {rest > 0 && (
        <View
          testID="avatar-rest"
          style={[kreis(36, colors['bg-1'], colors['bg-0']), { marginLeft: -spacing.s }]}
        >
          <Text style={[type.label, { color: colors['text-2'] }]}>{`+${rest}`}</Text>
        </View>
      )}
    </View>
  );
}
