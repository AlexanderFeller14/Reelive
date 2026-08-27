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
    console.error('[placeAndTime] permission request failed', error);
    return NO_PLACE;
  }
  if (permission.status !== 'granted') return NO_PLACE;

  let latitude: number, longitude: number;
  try {
    const position = await withTimeout(Location.getCurrentPositionAsync(), TIMEOUT_MS);
    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
  } catch (error) {
    console.error('[placeAndTime] location fix failed', error);
    return NO_PLACE;
  }

  const place_name = await describePlace(latitude, longitude);

  return { lat: latitude, lng: longitude, place_name };
}

// Reverse-geocodes coordinates to a city name; null when the lookup fails or
// times out. Shared by the live capture (determinePlace) and the library
// import (libraryImportSubmit), which brings its own coordinates from the
// asset instead of the current position.
export async function describePlace(latitude: number, longitude: number): Promise<string | null> {
  try {
    const [geocoded] = await withTimeout(
      Location.reverseGeocodeAsync({ latitude, longitude }),
      TIMEOUT_MS
    );
    return geocoded?.city ?? null;
  } catch (error) {
    console.error('[placeAndTime] geocoding failed', error);
    return null;
  }
}
