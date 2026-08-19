import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { supabaseBaseUrl } from '@/lib/supabaseUrl';
import { AVATAR_BUCKET, newAvatarKey } from './avatar';
import type { Crop } from './crop';

// Grösster Anzeigeort ist der 44-px-Kreis, das trägt 512 auch auf einem
// 3x-Display mit Reserve. Bei Qualität 0.8 sind das rund 50 KB.
const KANTE = 512;
const JPEG_QUALITAET = 0.8;

// Das Bild kommt NICHT mehr quadratisch herein: der System-Zuschnitt
// (`allowsEditing`) ist raus, weil er auf iOS den alten
// UIImagePickerController erzwingt und bei grossen Vorlagen vom System
// abgeräumt wird — die App bekommt dann ein «abgebrochen», das von einem
// echten Abbruch nicht zu unterscheiden ist (Fehlersuche 2026-08-13,
// gemessen: canceled=true ohne jede Ausnahme). Also schneidet die App selbst
// zu, und der Zuschnitt gehört hierher, wo das Bild ohnehin durchläuft.
//
// Mittig auf die KÜRZERE Kante, dann skalieren. Nicht einfach beide Kanten auf
// 512 setzen: das staucht ein Hoch- oder Querformat zum Quadrat, und im runden
// Rahmen sieht man das sofort an gequetschten Gesichtern.
//
// Dasselbe kontextbasierte Muster wie features/moments/medien.ts, inklusive
// release() im finally: die SharedObjects werden auch im Fehlerfall frei.
async function alsQuadratJpeg(uri: string, gewaehlt?: Crop): Promise<string> {
  let bereich: Crop;
  if (gewaehlt) {
    // Die Person hat den Ausschnitt selbst gewählt (AvatarZuschnitt). Dann
    // entfällt das Messen: die Masse kennt der Zuschnitt-Screen bereits, und
    // ein zweites renderAsync() auf ein grosses Original wäre reine Arbeit.
    bereich = gewaehlt;
  } else {
    // Kein gewählter Ausschnitt (Kamera-Selfie): mittig auf die kürzere Kante.
    // Die Masse kennt die kontextbasierte API erst nach renderAsync(), also
    // einmal unverändert laden — gleiches Vorgehen wie quellmasseErmitteln()
    // in medien.ts.
    const messkontext = ImageManipulator.manipulate(uri);
    let breite: number;
    let hoehe: number;
    try {
      const original = await messkontext.renderAsync();
      try {
        breite = original.width;
        hoehe = original.height;
      } finally {
        original.release();
      }
    } finally {
      messkontext.release();
    }
    const seite = Math.min(breite, hoehe);
    bereich = {
      originX: Math.round((breite - seite) / 2),
      originY: Math.round((hoehe - seite) / 2),
      width: seite,
      height: seite,
    };
  }

  const { originX, originY } = bereich;
  const seite = bereich.width;

  const kontext = ImageManipulator.manipulate(uri);
  try {
    // Erst beschneiden, dann skalieren: andersherum würde auf dem vollen,
    // ungeschnittenen Bild skaliert und der Ausschnitt danach nicht mehr
    // passen.
    kontext.crop({ originX, originY, width: seite, height: seite });
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
  const basis = supabaseBaseUrl;
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
  // Optional, weil nicht jeder Weg einen gewählten Ausschnitt hat: aus der
  // Galerie kommt einer (AvatarZuschnitt), ein Kamera-Selfie ist bereits
  // aufnahmefertig und wird mittig beschnitten.
  ausschnitt?: Crop,
): Promise<{ avatarKey: string | null; error: string | null }> {
  const schluessel = newAvatarKey(userId);

  try {
    const fertig = await alsQuadratJpeg(lokaleUri, ausschnitt);
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
