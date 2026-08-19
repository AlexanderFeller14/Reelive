// Der Dokumente-Ordner trägt die Container-UUID der Installation im Pfad, und
// jeder App-Neubau vergibt eine neue: ein absolut gespeicherter Pfad zeigt
// nach dem nächsten Update ins Leere, obwohl iOS die Dateien mitgenommen hat —
// so gingen am 2026-08-17 vier wartende Momente verloren. Die Warteschlange
// speichert deshalb nur noch den Teil UNTERHALB von Documents und löst beim
// Lesen gegen den aktuellen Ort auf.
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///container-NEU/Documents/' } },
}));

import { fuerAblage, fuerLesen } from '../queuePfade';

test('fuerAblage legt nur den Teil unterhalb von Documents ab', () => {
  expect(fuerAblage('file:///container-ALT/Documents/momente/p1/medium.mov')).toBe(
    'momente/p1/medium.mov'
  );
});

test('fuerAblage lässt Pfade ausserhalb von Documents unangetastet', () => {
  expect(fuerAblage('file:///tmp/reelive-x.mov')).toBe('file:///tmp/reelive-x.mov');
});

test('fuerLesen hängt die relative Form an den aktuellen Documents-Ort', () => {
  expect(fuerLesen('momente/p1/medium.mov')).toBe(
    'file:///container-NEU/Documents/momente/p1/medium.mov'
  );
});

// Alt-Zeilen von vor dem Fix tragen noch den absoluten Pfad der damaligen
// Installation. Beim Lesen werden sie am AKTUELLEN Documents-Ort neu
// verankert — der alte Container existiert nicht mehr, die Dateien darunter
// hat iOS aber in den neuen mitgenommen.
test('fuerLesen verankert absolute Alt-Zeilen am aktuellen Documents-Ort neu', () => {
  expect(fuerLesen('file:///container-ALT/Documents/momente/p1/medium.mov')).toBe(
    'file:///container-NEU/Documents/momente/p1/medium.mov'
  );
});

test('fuerLesen lässt absolute Pfade ausserhalb von Documents unangetastet', () => {
  // Der Worker behandelt sie wie bisher (und meldet dann eine fehlende
  // Datei), statt dass hier ein Documents-Pfad erfunden wird.
  expect(fuerLesen('file:///tmp/reelive-x.mov')).toBe('file:///tmp/reelive-x.mov');
});
