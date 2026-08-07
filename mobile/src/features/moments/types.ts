export type JobZustand = 'wartet' | 'laeuft' | 'fertig';

// Ein Job trägt alles, was die posts-Zeile braucht, plus den Fortschritt.
// post_id und die Schlüssel stehen schon beim Aufnehmen fest (Spec §5) —
// nur so legt ein Wiederanlauf nach Absturz keine zweite Zeile an.
export type QueueJob = {
  id: string;
  post_id: string;
  trip_id: string;
  typ: 'photo' | 'video';
  medium_uri: string;
  thumb_uri: string;
  storage_key: string;
  thumb_key: string;
  caption: string | null;
  captured_at: string;
  captured_tz: string;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  duration_s: number | null;
  zustand: JobZustand;
  versuche: number;
  naechster_versuch: number; // ms seit Epoch
  zeile_angelegt: boolean;
  medium_geladen: boolean;
  thumb_geladen: boolean;
};
