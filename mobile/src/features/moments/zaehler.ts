import * as tripsApi from '@/features/trips/tripsApi';
import { wartendeAnzahl } from './queueLogic';
import * as queueDb from './queueDb';

// Der Zähler ist vor dem Reveal die einzige Information über versiegelte
// Momente überhaupt — niemand sieht die Aufnahmen selbst. Er darf deshalb
// nach einer Offline-Aufnahme nie rückwärts springen: er zählt den
// Serverstand PLUS die eigenen, noch nicht hochgeladenen Momente derselben
// Reise aus der Warteschlange dazu (wartendeAnzahl statt eigener "!== fertig"-
// Prüfung, um diese Regel nicht zweimal zu pflegen).
export async function eigenerZaehler(tripId: string): Promise<number> {
  const [zaehler, jobs] = await Promise.all([tripsApi.eigeneZaehler(), queueDb.alleJobs()]);
  const serverstand = zaehler[tripId] ?? 0;
  const eigeneJobs = jobs.filter((job) => job.trip_id === tripId);
  return serverstand + wartendeAnzahl(eigeneJobs);
}
