// Screen-Tests rendern einzelne Screens, nicht die App, der SafeAreaProvider
// aus src/app/_layout.tsx ist dort also nie gemountet, und useSafeAreaInsets
// wirft ohne ihn. Die Bibliothek liefert genau dafür einen eigenen Mock mit
// (Insets 0, Frame in iPhone-Grösse); er gilt hier für alle Testdateien,
// damit ihn nicht jede einzeln aufsetzen muss.
//
// Insets 0 heisst: die Tests laufen auf dem Gerät OHNE Dynamic Island, wo
// useOberkante den gestalteten Abstand unverändert durchreicht. Die Rechnung
// für Geräte MIT Insel steht in src/theme/__tests__/useOberkante.test.tsx,
// die den Hook direkt mit gesetzten Insets prüft.
// `.default`, weil der Mock die Bibliothek als Default-Export nachbildet,
// ohne das kommt beim Testlauf ein { default: … } an und useSafeAreaInsets
// ist dort keine Funktion.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// react-native-maps bringt native Views mit, die im Test-Environment nicht
// existieren. Der Mock rendert stattdessen schlichte Views mit denselben
// Props (inkl. testID) und denselben Kindern, genug, um zu pruefen, WELCHE
// Nadeln der Screen setzt und mit welchem Ausschnitt er die Karte oeffnet,
// ohne eine Karte zu rendern.
//
// Der Mock steht hier statt in der Testdatei, weil er kein Wissen ueber
// einen einzelnen Screen enthaelt: er ist die Fehlstelle der nativen
// Bibliothek, und die trifft jede Testdatei gleich (Kartenscreen heute,
// KartenNadel und geteilte Karte spaeter).
//
// `animateToRegion`/`setRegion`/`fitToCoordinates` haengen bewusst am
// imperativen Handle statt am Prop-Objekt: der Screen ruft sie ueber ein ref
// auf, ein Mock ohne sie liesse jede Kamerafahrt an einem `undefined is not a
// function` scheitern statt an einer Zusicherung.
//
// `setRegion` ist der Sprung (Reduced Motion, DESIGN-LANGUAGE §5).
// `setNativeProps` steht hier bewusst NICHT, obwohl MapView die Methode hat:
// sie reicht an `this.map` weiter, und dieses Ref wird in react-native-maps
// 1.27.2 an kein Element gehaengt (`ref={this.map}` kommt nirgends vor),
// der Aufruf ist auf dem Geraet ein stiller No-op. Ein Mock, der sie anboete,
// beglaubigte eine Kamerabewegung, die nie stattfindet: gruener Test, stehende
// Karte.
jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const Karte = ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({
      animateToRegion: jest.fn(),
      setRegion: jest.fn(),
      fitToCoordinates: jest.fn(),
    }));
    return ReactActual.createElement(View, props, props.children);
  });
  return {
    __esModule: true,
    default: Karte,
    Marker: (props: Record<string, unknown>) => ReactActual.createElement(View, props, props.children),
    Polyline: (props: Record<string, unknown>) => ReactActual.createElement(View, props),
    PROVIDER_DEFAULT: undefined,
  };
});

// avatarUrl() (src/features/auth/avatar.ts) baut die öffentliche Bild-URL aus
// dieser Variable. Ohne sie liefert sie null, und jeder Test, der ein
// Profilbild erwartet, prüfte in Wahrheit nur den Initialen-Fall. Der Wert ist
// frei erfunden und absichtlich keine echte Adresse: es wird nichts geladen,
// die Tests vergleichen nur die zusammengebaute Zeichenkette.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://test.local:54321';
