export type JobZustand = 'wartet' | 'laeuft' | 'fertig';

// Ein Moment, den der Worker dauerhaft verwerfen musste (Spec §8: «mit
// Erklärung verworfen»). Bis zum Final-Review verschwand so einer wortlos,
// der Job wurde gelöscht und eine Konsolenzeile geschrieben, die niemand
// sieht. Der Eintrag überlebt Neustarts (SQLite, neben der Warteschlange) und
// bleibt liegen, bis die betroffene Person ihn im Reise-Detail zur Kenntnis
// nimmt. Er trägt bewusst keine Medien mehr: die Dateien sind zu diesem
// Zeitpunkt aufgeräumt (Critical 2), es geht allein um die Erklärung.
export type VerworfenerMoment = {
  id: string;
  trip_id: string;
  author_id: string;
  grund: string;
  verworfen_am: number; // ms seit Epoch
};

// Ein Job trägt alles, was die posts-Zeile braucht, plus den Fortschritt.
// post_id und die Schlüssel stehen schon beim Aufnehmen fest (Spec §5),
// nur so legt ein Wiederanlauf nach Absturz keine zweite Zeile an.
export type QueueJob = {
  id: string;
  post_id: string;
  trip_id: string;
  // Beim Einreihen festgehalten (Task-13-Fix-Runde-2), NICHT beim Schreiben aus
  // der Sitzung gelesen: sonst könnte ein Moment, der bloss in der
  // Warteschlange liegt (zustand: 'wartet', noch nicht verarbeitet), unter dem
  // Namen der nächsten angemeldeten Person auf demselben Gerät landen, ganz
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
