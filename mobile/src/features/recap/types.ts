// Nur die Typen, die diese Phase wirklich braucht (Task-5-Brief). Reaktion und
// Kommentar stehen hier bereits mit, weil Task 12 (Reaktionen/Kommentare) auf
// denselben Typen aufsetzen soll statt auf einer zweiten, eigenen Definition,
// beide Tasks laufen parallel, dieser Datei-Ausschnitt ist ihr gemeinsamer Vertrag.

export type RecapMoment = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  duration_s: number | null;
  caption: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  // Koordinaten der Aufnahme. null ist der Normalfall und kein Fehler:
  // ortBestimmen() (Phase 4) liefert bewusst null, wenn die Ortungsdienste
  // nicht erlaubt sind, drinnen kein Fix zustande kommt oder die Frist
  // ablaeuft, der Moment wird trotzdem eingesendet.
  lat: number | null;
  lng: number | null;
  upload_status: 'pending' | 'uploaded';
  // Kommt aus profiles.display_name (Join, siehe recapApi.fetchRecapMomente),
  // ist also kein Feld von posts selbst.
  autor_name: string;
  // Wie autor_name aus dem profiles-Join (recapApi.fetchRecapMomente). Null
  // heisst «kein Bild», dann trägt der Kreis die Initiale.
  autor_avatar_key: string | null;
};

// Eine Gruppe von Momenten desselben Reise-Tages (siehe tage.ts).
export type RecapTag = {
  nummer: number; // zählt ab trips.start_date als Tag 1
  datum: string; // 'YYYY-MM-DD', kanonisch aus start_date + (nummer - 1) Tagen
  ort: string | null;
  momente: RecapMoment[];
};

// Für Task 12 hier mitdefiniert, damit beide Tasks dieselben Typen benutzen.
export type Reaktion = { post_id: string; user_id: string; emoji: string };
export type Kommentar = {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  autor_name: string;
};
