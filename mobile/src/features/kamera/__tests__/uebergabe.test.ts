import { uebergeben, abholen, type FotoUebergabe } from '../uebergabe';
import type { PictureRef } from 'expo-camera';

// Ein PictureRef ist zur Laufzeit nur ein natives Handle; für das Modul
// zählt allein, dass dasselbe Objekt wieder herauskommt.
const fakeRef = (name: string) => ({ name }) as unknown as PictureRef;

const uebergabe = (ref: PictureRef, uri = 'file://gespeichert.jpg'): FotoUebergabe => ({
  ref,
  datei: Promise.resolve({ uri }),
});

test('abholen liefert die Übergabe genau einmal', async () => {
  const u = uebergabe(fakeRef('a'));
  uebergeben(u);
  expect(abholen()).toBe(u);
  expect(abholen()).toBeNull();
});

test('eine neue Übergabe ersetzt eine liegengebliebene', () => {
  uebergeben(uebergabe(fakeRef('alt')));
  const neu = uebergabe(fakeRef('neu'));
  uebergeben(neu);
  expect(abholen()).toBe(neu);
  expect(abholen()).toBeNull();
});

test('eine scheiternde Datei bleibt für den Abholer als Ablehnung erhalten', async () => {
  const fehler = new Error('kein Speicherplatz');
  uebergeben({ ref: fakeRef('x'), datei: Promise.reject(fehler) });
  // Die Mikrotasks durchlaufen lassen: hinge KEIN Handler an der Ablehnung,
  // schlüge Jest hier mit «Unhandled promise rejection» fehl.
  await new Promise((weiter) => setTimeout(weiter, 0));
  await expect(abholen()!.datei).rejects.toBe(fehler);
});
