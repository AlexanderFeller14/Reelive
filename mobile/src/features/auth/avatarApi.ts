import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { AVATAR_BUCKET, neuerAvatarSchluessel } from './avatar';

// Grösster Anzeigeort ist der 44-px-Kreis, das trägt 512 auch auf einem
// 3x-Display mit Reserve. Bei Qualität 0.8 sind das rund 50 KB.
const KANTE = 512;
const JPEG_QUALITAET = 0.8;

// Das Bild kommt quadratisch aus dem System-Zuschnitt (allowsEditing), beide
// Kanten zu setzen verzerrt es also nicht. Dasselbe kontextbasierte Muster wie
// features/moments/medien.ts, inklusive release() im finally: die SharedObjects
// werden auch im Fehlerfall freigegeben.
async function alsQuadratJpeg(uri: string): Promise<string> {
  const kontext = ImageManipulator.manipulate(uri);
  try {
    kontext.resize({ width: KANTE, height: KANTE });
    const gerendert = await kontext.renderAsync();
    try {
      const ergebnis = await gerendert.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_QUALITAET,
      });
      return ergebnis.uri;
    } finally {
      gerendert.release();
    }
  } finally {
    kontext.release();
  }
}

// NICHT supabase.storage.from().upload(): der Storage-Client erwartet ein Blob,
// und `fetch(uri).blob()` ist unter React Native unzuverlässig. Stattdessen
// dasselbe File.upload()-Muster wie features/moments/uploadWorker.ts, das im
// Projekt erprobt ist.
async function hochladen(schluessel: string, uri: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Nicht angemeldet.');
  const basis = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!basis) throw new Error('Supabase-URL fehlt.');

  const antwort = await new File(uri).upload(
    `${basis}/storage/v1/object/${AVATAR_BUCKET}/${schluessel}`,
    {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    }
  );
  // upload() wirft bei 4xx/5xx NICHT, es liefert die Antwort zurück (derselbe
  // Stolperstein wie in uploadWorker.ts). Ohne diese Prüfung ginge ein
  // abgelehnter Upload als erledigt durch, und die Spalte zeigte ins Leere.
  if (antwort.status < 200 || antwort.status >= 300) {
    throw new Error(`Upload abgelehnt (${antwort.status}).`);
  }
}

// Räumt ein altes Objekt weg. Bewusst OHNE Fehlerrückgabe: ein liegen-
// gebliebenes Objekt kostet ~50 KB, ein zurückgenommenes Bild kostet die
// Person ihre gerade getroffene Wahl. Die harmlosere Fehlerrichtung gewinnt.
async function altesWegraeumen(alterKey: string | null): Promise<void> {
  if (!alterKey) return;
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([alterKey]);
    if (error) console.error('[avatarApi] altes Bild blieb liegen', error);
  } catch (fehler) {
    console.error('[avatarApi] altes Bild blieb liegen', fehler);
  }
}

// Reihenfolge (Spec §5.3): hochladen → Spalte setzen → altes Objekt löschen.
// So zeigt die Zeile nie auf etwas, das noch nicht oder nicht mehr da ist.
export async function setzeAvatar(
  userId: string,
  lokaleUri: string,
  alterKey: string | null,
): Promise<{ avatarKey: string | null; error: string | null }> {
  const schluessel = neuerAvatarSchluessel(userId);

  try {
    const fertig = await alsQuadratJpeg(lokaleUri);
    await hochladen(schluessel, fertig);
  } catch (fehler) {
    console.error('[avatarApi] Hochladen fehlgeschlagen', fehler);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht hochgeladen werden. Probier es gleich nochmal.',
    };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: schluessel })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key setzen fehlgeschlagen', error);
    // Das frische Objekt liegt schon im Speicher, die Spalte kennt es aber
    // nicht. Wegräumen, sonst bleibt es für immer, ohne dass jemand seinen
    // Pfad noch kennt (dieselbe Überlegung wie in konto-loeschen/ablauf.ts).
    await altesWegraeumen(schluessel);
    return {
      avatarKey: null,
      error: 'Das Bild konnte nicht gespeichert werden. Probier es gleich nochmal.',
    };
  }

  await altesWegraeumen(alterKey);
  return { avatarKey: schluessel, error: null };
}

// Umgekehrte Reihenfolge: erst die Spalte leeren, dann das Objekt. Andersherum
// zeigte die Zeile auf etwas, das es nicht mehr gibt.
export async function entferneAvatar(
  userId: string,
  alterKey: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_key: null })
    .eq('id', userId);
  if (error) {
    console.error('[avatarApi] avatar_key leeren fehlgeschlagen', error);
    return { error: 'Das Bild konnte nicht entfernt werden. Probier es gleich nochmal.' };
  }
  await altesWegraeumen(alterKey);
  return { error: null };
}
