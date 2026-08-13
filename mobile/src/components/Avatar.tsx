import { Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, radius, spacing, type } from '@/theme/tokens';
import { avatarUrl } from '@/features/auth/avatar';

// DESIGN-LANGUAGE v2 §4: rund, 32–44 px, 2 px weisser Ring, Gruppen −8 px
// überlappend. Ohne Bild trägt der Kreis die Initiale.
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
    // Das Bild ist quadratisch und würde sonst über die Rundung hinausstehen.
    overflow: 'hidden',
  };
}

// Name UND Schlüssel gehören zusammen: Wer ein Gesicht zeichnet, braucht das
// Bild, wenn es eines gibt, und sonst den Namen für die Initiale. Zwei
// getrennte Listen (Namen hier, Schlüssel dort) liefen unweigerlich
// auseinander.
export type Gesicht = { name: string; avatarKey: string | null };

// `kino` ist ein expliziter Schalter und nicht aus dem Theme ableitbar:
// ThemeProvider ist light-only, im Recap-Player und im geteilten Recap gilt
// aber die Kino-Palette. Gleiche Begründung wie bei Sheet.kino.
export function Avatar({
  name, avatarKey = null, size = 36, kino = false,
}: {
  name: string;
  avatarKey?: string | null;
  size?: number;
  kino?: boolean;
}) {
  const { colors } = useTheme();
  const flaeche = kino ? cinema['bg-1'] : colors['bg-1'];
  // In der hellen Palette trennt der Ring überlappende Gesichter von der
  // Fläche dahinter (Facepile, DESIGN-LANGUAGE §4) — deshalb dieselbe Farbe
  // wie der Seiten-Hintergrund (`bg-0`), der Ring verschwindet dort mit
  // Absicht optisch in die Umgebung.
  //
  // Im Kino gilt eine andere Lesart derselben Regel, nicht dieselbe Farbwahl:
  // beide bisherigen Einsatzorte (Recap-Player, geteilter Recap) zeigen genau
  // EIN Gesicht auf einem Foto, keine überlappende Gruppe, die sich vom
  // Hintergrund abheben müsste. Dort gilt §4s WÖRTLICHES «2 px weisser Ring»
  // direkt, `cinema['text-1']` ist die hellste Kino-Farbe und der nächste
  // verfügbare Ersatz für Weiss innerhalb der Palette (dieselbe Wahl traf
  // schon die gelöschte lokale AvatarInitiale-Kopie in player.tsx vor
  // Task 9). NICHT mit der hellen Zeile oben vereinheitlichen: die beiden
  // Ringe beantworten unterschiedliche Fragen (Facepile-Separator vs.
  // wörtlicher weisser Ring), sie treffen nur zufällig auf denselben Namen.
  const ring = kino ? cinema['text-1'] : colors['bg-0'];
  const schrift = kino ? cinema['text-1'] : colors['text-2'];
  const url = avatarUrl(avatarKey);
  // §4 endet bei 44 px, alles darüber ist das Hero-Kopfbild des Profil-Tabs
  // (Bildertausch 2026-08-13). Dort wäre die 12-px-Label-Initiale verloren;
  // das Display-Format ist die einzige Grösse der Skala (§2: keine neuen
  // erfinden), die einen 160er-Kreis trägt.
  const initialeStil = size > 44 ? type.display : type.label;

  return (
    <View testID="avatar-kreis" style={kreis(size, flaeche, ring)}>
      {/* Die Initiale steht IMMER im Baum, das Bild legt sich darüber. So
          trägt der Kreis während des Ladens etwas (sonst blitzt eine leere
          Fläche auf und die ganze Facepile springt), und ein Bild, das nicht
          lädt, fällt auf die Initiale zurück statt auf ein Loch. */}
      <Text style={[initialeStil, { color: schrift }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
      {url && (
        <Image
          testID="avatar-bild"
          source={{ uri: url }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          contentFit="cover"
          accessible={false}
        />
      )}
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
export function AvatarGroup({
  gesichter, max = 3, kino = false,
}: {
  gesichter: Gesicht[];
  max?: number;
  kino?: boolean;
}) {
  const { colors } = useTheme();
  const sichtbar = gesichter.slice(0, max);
  const rest = gesichter.length - sichtbar.length;
  const flaeche = kino ? cinema['bg-1'] : colors['bg-1'];
  // Ring und Schrift folgen DERSELBEN Zeile wie in `Avatar` oben, nicht einer
  // zweiten: der «+N»-Kreis steht in derselben überlappenden Reihe wie die
  // Gesichter davor, gezeichnet von derselben `kreis()`-Funktion. Zwei
  // verschiedene Ringe in einer Reihe liest niemand als Absicht, sondern als
  // Fehler.
  //
  // Bis zur Merge-Fixrunde standen hier `cinema['bg-0']`/`cinema['text-2']`,
  // also genau die Werte, die `Avatar` VOR Fix-Runde 1 (Commit 7b95f51) trug.
  // Die Korrektur dort liess die Gruppe absichtlich stehen, weil sie mit
  // `kino` bis heute nirgends gerendert wird — das Ergebnis war aber ein Riss
  // mitten durch eine einzige Komponente, und «heute unbenutzt» ist kein Grund
  // für zwei Antworten auf dieselbe Frage.
  //
  // WELCHE Lesart am Ende gilt, ist damit NICHT entschieden, nur
  // vereinheitlicht. Für eine überlappende Facepile auf dunklem Grund spricht
  // die Separator-Lesart (Ring in `cinema['bg-0']`, der Farbe des Kino-
  // Hintergrunds — dieselbe Logik, mit der die helle Palette `bg-0` nimmt)
  // mehr als §4s wörtlicher «2 px weisser Ring», den `Avatar` heute umsetzt,
  // weil seine beiden Einsatzorte einzelne Gesichter auf Fotos zeigen. Wer
  // beim ersten echten Kino-Facepile darauf umstellt, stellt BEIDE Stellen um,
  // Kinder UND «+N»; sonst ist der Riss nur auf die andere Seite gewandert.
  const ring = kino ? cinema['text-1'] : colors['bg-0'];
  const schrift = kino ? cinema['text-1'] : colors['text-2'];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {sichtbar.map((gesicht, i) => (
        <View key={`${gesicht.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -spacing.s }}>
          <Avatar name={gesicht.name} avatarKey={gesicht.avatarKey} kino={kino} />
        </View>
      ))}
      {rest > 0 && (
        <View
          testID="avatar-rest"
          style={[kreis(36, flaeche, ring), { marginLeft: -spacing.s }]}
        >
          <Text style={[type.label, { color: schrift }]}>{`+${rest}`}</Text>
        </View>
      )}
    </View>
  );
}
