import * as Location from 'expo-location';

// Die Ortsbestimmung darf die Aufnahme nie kosten (Task-8-Kontext): eine
// verweigerte Berechtigung, ein Timeout oder ein fehlgeschlagenes Geocoding
// führen IMMER zu den drei null, nie zu einer geworfenen Exception, der
// Moment wird so oder so eingesendet, nur eben ohne Ort. Deshalb ist jeder
// Schritt einzeln abgesichert statt sich auf ein einziges try/catch zu
// verlassen (ein fehlschlagendes Geocoding soll lat/lng nicht mitreissen).

// Kein GPS-Fix (z.B. drinnen) kann getCurrentPositionAsync ohne Fehler und
// ohne Ergebnis ewig hängen lassen, das darf preview.tsx nie blockieren.
const FRIST_MS = 8_000;

const KEIN_ORT: Ort = { lat: null, lng: null, place_name: null };

export type Ort = { lat: number | null; lng: number | null; place_name: string | null };

export function jetzt(): { captured_at: string; captured_tz: string } {
  return {
    captured_at: new Date().toISOString(),
    captured_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function mitFrist<T>(versprechen: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    versprechen.then(
      (wert) => {
        clearTimeout(timer);
        resolve(wert);
      },
      (fehler) => {
        clearTimeout(timer);
        reject(fehler);
      }
    );
  });
}

export async function ortBestimmen(): Promise<Ort> {
  let berechtigung: { status: string };
  try {
    berechtigung = await Location.requestForegroundPermissionsAsync();
  } catch (fehler) {
    console.error('[ortUndZeit] Berechtigungsabfrage fehlgeschlagen', fehler);
    return KEIN_ORT;
  }
  if (berechtigung.status !== 'granted') return KEIN_ORT;

  let latitude: number, longitude: number;
  try {
    const position = await mitFrist(Location.getCurrentPositionAsync(), FRIST_MS);
    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
  } catch (fehler) {
    console.error('[ortUndZeit] Positionsbestimmung fehlgeschlagen', fehler);
    return KEIN_ORT;
  }

  // Koordinaten sind schon sicher, ein scheiterndes Geocoding kostet nur
  // noch den Ortsnamen, nicht mehr lat/lng.
  let place_name: string | null = null;
  try {
    const [stelle] = await mitFrist(Location.reverseGeocodeAsync({ latitude, longitude }), FRIST_MS);
    place_name = stelle?.city ?? null;
  } catch (fehler) {
    console.error('[ortUndZeit] Geocoding fehlgeschlagen', fehler);
  }

  return { lat: latitude, lng: longitude, place_name };
}
