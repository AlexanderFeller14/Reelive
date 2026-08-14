import {
  uebergeben,
  abholen,
  gespeicherteDatei,
  videoUebergeben,
  videoAbholen,
  type FotoUebergabe,
} from '../uebergabe';
import type { PictureRef } from 'expo-camera';
import type { VideoPlayer } from 'expo-video';

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

// Die Video-Übergabe (Gerätefund 2026-08-14): der vorgewärmte Player UND ein
// Poster (Bild 0 des Videos) reisen gemeinsam zur Vorschau — die VideoView
// braucht am Gerät ~0,8 s, bis sie selbst einen fertig geladenen Player
// zeichnet; solange steht das Poster, und der Wechsel ist unsichtbar, weil
// die Schleife bei Bild 0 beginnt. Zur Laufzeit zählt nur, dass dasselbe
// Paar wieder herauskommt — und dass ein liegengebliebener Player
// freigegeben wird (natives Objekt, explizites release nötig).
const fakePlayer = () => ({ release: jest.fn() }) as unknown as VideoPlayer;

test('videoAbholen liefert die Übergabe genau einmal', () => {
  const p = fakePlayer();
  videoUebergeben({ player: p, poster: 'file://poster.jpg' });
  const geholt = videoAbholen();
  expect(geholt?.player).toBe(p);
  expect(geholt?.poster).toBe('file://poster.jpg');
  expect(videoAbholen()).toBeNull();
});

test('eine neue Übergabe ersetzt eine liegengebliebene und gibt deren Player frei', () => {
  const alt = fakePlayer();
  const neu = fakePlayer();
  videoUebergeben({ player: alt, poster: null });
  videoUebergeben({ player: neu, poster: null });
  expect((alt as unknown as { release: jest.Mock }).release).toHaveBeenCalled();
  expect(videoAbholen()?.player).toBe(neu);
  expect(videoAbholen()).toBeNull();
});

// savePictureAsync ist plattform-uneins (expo-camera SDK 57): Android liefert
// `uri`, iOS liefert `url`, der TS-Typ verspricht einheitlich `uri`. Wer nur
// `.uri` liest, bekommt auf dem iPhone undefined, und das Einsenden eines
// Fotos brach kommentarlos ab (Gerätefund 2026-08-14). `gespeicherteDatei`
// begradigt das an der Quelle.
function refMitErgebnis(ergebnis: object): PictureRef {
  return { savePictureAsync: async () => ergebnis } as unknown as PictureRef;
}

test('gespeicherteDatei nimmt die iOS-Form (url) an und liefert uri', async () => {
  await expect(gespeicherteDatei(refMitErgebnis({ url: 'file://ios.jpg' }))).resolves.toEqual({
    uri: 'file://ios.jpg',
  });
});

test('gespeicherteDatei reicht die Android-Form (uri) unverändert durch', async () => {
  await expect(gespeicherteDatei(refMitErgebnis({ uri: 'file://android.jpg' }))).resolves.toEqual({
    uri: 'file://android.jpg',
  });
});

test('gespeicherteDatei lehnt ab, wenn weder uri noch url kommt, statt still undefined zu liefern', async () => {
  await expect(gespeicherteDatei(refMitErgebnis({ width: 100 }))).rejects.toThrow(
    /weder uri noch url/
  );
});
