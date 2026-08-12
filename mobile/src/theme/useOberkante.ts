import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from './tokens';

// Der obere Abstand eines Screens, der von oben nach unten gelesen wird.
//
// Die App zeigt nirgends einen Navigations-Header (`headerShown: false` in
// allen drei Layouts), jeder Screen beginnt also bei y = 0, und damit hinter
// Statusleiste und Dynamic Island. Der feste Abstand aus der Design Language
// (48 bzw. 32) reichte auf einem iPhone 17 Pro nicht: dort nimmt das Geraet
// oben 59 Punkte weg, «Schritt 1 von 2» klebte an der Uhr und die H1 lief in
// die Insel. Am Simulator gesehen, nicht hergeleitet.
//
// `Math.max` statt einer Addition: der gestaltete Abstand bleibt der
// gestaltete Abstand, solange er ohnehin genuegt (Geraete ohne Insel, Web).
// Erst wo das Geraet mehr wegnimmt, weicht der Inhalt aus, und dann um
// genau einen Rasterschritt unterhalb des Systembereichs, nicht um 48 weitere
// Punkte. Der 4er-Raster aus §3 gilt fuer gestaltete Abstaende; was das
// Geraet belegt, ist keine Gestaltungsentscheidung.
export function useOberkante(basis: number): number {
  const { top } = useSafeAreaInsets();
  return Math.max(basis, top + spacing.base);
}

// Das Gegenstueck fuer alles, was am unteren Rand klebt. Dieselbe Begruendung,
// andere Kante: der Home-Indicator belegt auf randlosen Geraeten rund 34
// Punkte, und die Reaktionsreihe des Players stand mit ihren gestalteten 32
// direkt darauf. Am Geraet gesehen, nicht hergeleitet.
//
// Auch hier `Math.max` statt Addition, damit Geraete mit Home-Knopf und das
// Web ihren gestalteten Abstand behalten (dort ist `bottom` schlicht 0).
export function useUnterkante(basis: number): number {
  const { bottom } = useSafeAreaInsets();
  return Math.max(basis, bottom + spacing.base);
}
