import * as tripsApi from '@/features/trips/tripsApi';
import { wartendeAnzahl } from './queueLogic';
import * as queueDb from './queueDb';

// Der Zähler ist vor dem Reveal die einzige Information über versiegelte
// Momente überhaupt — niemand sieht die Aufnahmen selbst. Er darf deshalb
// nach einer Offline-Aufnahme nie rückwärts springen: er zählt den
// Serverstand PLUS die eigenen, noch nicht hochgeladenen Momente derselben
// Reise aus der Warteschlange dazu (wartendeAnzahl statt eigener "!== fertig"-
// Prüfung, um diese Regel nicht zweimal zu pflegen).
//
// Fix-Runde 1: Ein Job bleibt ab dem Moment, in dem uploadWorker.verarbeiteJob
// die posts-Zeile angelegt hat (zeile_angelegt: true), bis zur bestätigten
// Fertigstellung in der Warteschlange stehen — Medien-/Thumbnail-Upload
// können mehrfach fehlschlagen und erneut versucht werden, ohne dass der Job
// verschwindet. `my_post_counts()` zählt aber jede posts-Zeile unabhängig vom
// Upload-Status, zählt diesen Job also bereits im Serverstand mit. Ohne den
// Ausschluss hier würde er ein zweites Mal gezählt — der Zähler spränge dann
// zurück, sobald der Job schliesslich aus der Warteschlange verschwindet
// (N → N+1 → N+2 → N+1). Nur Jobs OHNE angelegte Zeile sind für den Server
// unsichtbar und dürfen lokal dazugezählt werden.
export async function eigenerZaehler(tripId: string): Promise<number> {
  const [zaehler, jobs] = await Promise.all([tripsApi.eigeneZaehler(), queueDb.alleJobs()]);
  const serverstand = zaehler[tripId] ?? 0;
  const nochNichtAufDemServer = jobs.filter((job) => job.trip_id === tripId && !job.zeile_angelegt);
  return serverstand + wartendeAnzahl(nochNichtAufDemServer);
}
