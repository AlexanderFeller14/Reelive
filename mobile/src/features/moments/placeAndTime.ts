import * as Location from 'expo-location';

const TIMEOUT_MS = 8_000;

const NO_PLACE: Place = { lat: null, lng: null, place_name: null };

export type Place = { lat: number | null; lng: number | null; place_name: string | null };

export function now(): { captured_at: string; captured_tz: string } {
  return {
    captured_at: new Date().toISOString(),
    captured_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function determinePlace(): Promise<Place> {
  let permission: { status: string };
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch (error) {
    console.error('[ortUndZeit] Berechtigungsabfrage fehlgeschlagen', error);
    return NO_PLACE;
  }
  if (permission.status !== 'granted') return NO_PLACE;

  let latitude: number, longitude: number;
  try {
    const position = await withTimeout(Location.getCurrentPositionAsync(), TIMEOUT_MS);
    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
  } catch (error) {
    console.error('[ortUndZeit] Positionsbestimmung fehlgeschlagen', error);
    return NO_PLACE;
  }

  let place_name: string | null = null;
  try {
    const [geocoded] = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), TIMEOUT_MS);
    place_name = geocoded?.city ?? null;
  } catch (error) {
    console.error('[ortUndZeit] Geocoding fehlgeschlagen', error);
  }

  return { lat: latitude, lng: longitude, place_name };
}
