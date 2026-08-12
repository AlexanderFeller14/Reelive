import { platzhalterCover } from '../platzhalterCover';

// Die Eigenschaft, wegen der die Wahl überhaupt an der Position hängt und
// nicht an der Trip-id: zwei Karten nebeneinander tragen nie dasselbe Bild.
test('aufeinanderfolgende Positionen tragen verschiedene Cover', () => {
  expect(platzhalterCover(0)).not.toBe(platzhalterCover(1));
});

// Und die Reihe läuft danach von vorn weiter, statt ins Leere zu greifen.
test('die Reihe beginnt nach dem letzten Bild von vorn', () => {
  expect(platzhalterCover(2)).toBe(platzhalterCover(0));
  expect(platzhalterCover(3)).toBe(platzhalterCover(1));
});

test('jede Position liefert ein Bild', () => {
  for (let i = 0; i < 8; i += 1) expect(platzhalterCover(i)).toBeTruthy();
});
