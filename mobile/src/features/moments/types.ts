export type JobZustand = 'wartet' | 'laeuft' | 'fertig';

// Ein Job trägt alles, was die posts-Zeile braucht, plus den Fortschritt.
// post_id und die Schlüssel stehen schon beim Aufnehmen fest (Spec §5) —
// nur so legt ein Wiederanlauf nach Absturz keine zweite Zeile an.
export type QueueJob = {
  id: string;
  post_id: string;
  trip_id: string;
  // Beim Einreihen festgehalten (Task-13-Fix-Runde-2), NICHT beim Schreiben aus
  // der Sitzung gelesen: sonst könnte ein Moment, der bloss in der
  // Warteschlange liegt (zustand: 'wartet', noch nicht verarbeitet), unter dem
  // Namen der nächsten angemeldeten Person auf demselben Gerät landen — ganz
  // ohne Race, sobald sich A ab- und B anmeldet, bevor der Job je lief. Siehe
  // preview.tsx (setzt es) und queueLogic.naechsterJob (wählt nur Jobs der
  // aktuell angemeldeten Person aus).
  author_id: string;
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
