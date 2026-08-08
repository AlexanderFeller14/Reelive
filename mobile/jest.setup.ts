// Screen-Tests rendern einzelne Screens, nicht die App — der SafeAreaProvider
// aus src/app/_layout.tsx ist dort also nie gemountet, und useSafeAreaInsets
// wirft ohne ihn. Die Bibliothek liefert genau dafür einen eigenen Mock mit
// (Insets 0, Frame in iPhone-Grösse); er gilt hier für alle Testdateien,
// damit ihn nicht jede einzeln aufsetzen muss.
//
// Insets 0 heisst: die Tests laufen auf dem Gerät OHNE Dynamic Island, wo
// useOberkante den gestalteten Abstand unverändert durchreicht. Die Rechnung
// für Geräte MIT Insel steht in src/theme/__tests__/useOberkante.test.tsx,
// die den Hook direkt mit gesetzten Insets prüft.
// `.default`, weil der Mock die Bibliothek als Default-Export nachbildet —
// ohne das kommt beim Testlauf ein { default: … } an und useSafeAreaInsets
// ist dort keine Funktion.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);
