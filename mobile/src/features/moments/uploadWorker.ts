import { File } from 'expo-file-system';
import * as Network from 'expo-network';

import * as queueDb from './queueDb';
import * as queueLogic from './queueLogic';
import * as postsApi from './postsApi';
import * as medien from './medien';
import * as einstellungen from './einstellungen';
import type { QueueJob } from './types';

// Einzige Stelle, die Jobs verändert (Task-6-Brief). Jeder Teilschritt wird für
// sich persistiert, ein Absturz zwischen zwei Schritten darf beim nächsten
// Durchlauf nie wiederholen, was schon geschafft ist (Spec §5, «kein Moment
// geht verloren»).

const INTERVALL_MS = 5_000;

// Task-13-Fix-Runde-1: ein Job, der beim Abmelden gerade auf Netz-Ein-/Ausgabe
// wartet (bei einem Video leicht mehrere Sekunden), darf danach nicht weiter-
// schreiben. starte()/stoppe() zählen diese Generation hoch; jeder Durchlauf
// merkt sich seine beim Start, verarbeiteJob prüft sie vor jedem einzelnen
// Schreibvorgang (Insert, Upload, Update, Bestätigung, Löschen) erneut, nicht
// nur einmal am Anfang, weil sich der Stand zwischen zwei await-Punkten
// geändert haben kann. Das deckt den RACE (mitten im Schreiben abgemeldet),
// aber NICHT den häufigeren, racefreien Fall: ein Job liegt bloss in der
// Warteschlange (zustand: 'wartet'), während sich A ab- und B anmeldet, der
// nächste reguläre Tick liefe unter B's frischer, gültiger Generation und der
// obige Check ginge trivial durch. DAFÜR sorgt Fix-Runde-2: die Autorenschaft
// wird beim Einreihen an QueueJob.author_id festgehalten (nicht mehr beim
// Schreiben aus der Sitzung gelesen, siehe postsApi.momentAnlegen), und
// naechsterJob() wählt unten nur Jobs der GERADE angemeldeten Person aus
// (postsApi.aktuelleAutorId()). Beide Mechanismen ergänzen sich, keiner
// ersetzt den anderen.
let generation = 0;
function gehoertZurLaufendenGeneration(meineGeneration: number): boolean {
  return meineGeneration === generation;
}

// Nicht der enum-Reexport (Network.NetworkStateType), sondern der rohe String:
// getNetworkStateAsync() liefert type: 'WIFI' zur Laufzeit ohnehin als String,
// und so bleibt der Vergleich unabhängig davon, was ein Test von expo-network mockt.
const WIFI = 'WIFI';

// create table if not exists ist zwar idempotent, muss aber nicht bei jedem
// 5-Sekunden-Tick erneut laufen. Ein fehlgeschlagener Versuch wird NICHT
// gecacht (kein Promise-Caching), sonst bliebe die Queue nach einem
// einmaligen Init-Fehler für den Rest der Session tot.
let initialisiert = false;
async function sicherstellenInitialisiert(): Promise<void> {
  if (initialisiert) return;
  await queueDb.initQueue();
  initialisiert = true;
}

// Hochladen ueber expo-file-system statt ueber fetch.
//
// Die Vorfassung uebergab `{ uri }` als Body an fetch und verliess sich darauf,
// dass React Native daraus die lokale Datei streamt. Das galt fuer den alten
// Netzwerk-Stack; unter React Native 0.86 lehnt fetch das ab, und zwar erst zur
// LAUFZEIT AUF DEM GERAET: «TypeError: Unsupported BodyInit type». Kein Test
// konnte das sehen, weil dort global.fetch gemockt ist und ein Mock jeden Body
// klaglos annimmt. Am 2026-08-11 auf einem iPhone gefunden, wo jeder
// eingesendete Moment endlos in der Warteschlange kreiste.
//
// `File.upload` ist der dafuer vorgesehene Weg (SDK-57-Doku) und streamt die
// Datei nativ, ohne sie vorher komplett in den Speicher zu lesen. Das ist bei
// Videos der Unterschied zwischen «laeuft» und «Absturz wegen Speicher».

// Die lokale Aufnahme ist weg (am 2026-08-13 auf einem iPhone: die App stürzte
// bei JEDEM Start ab, sobald ein solcher Job in der Warteschlange lag).
// `File.upload()` wirft in diesem Fall NICHT nach JavaScript, sondern lässt
// eine native Ausnahme durch («Cannot read file at file:///…/medium.jpg»), die
// den Prozess mit signal 6 beendet — der try/catch unten kommt nie zum Zug.
// Deshalb wird vorher geprüft. Ein eigener Fehlertyp, weil dieser Fall
// dauerhaft ist wie eine Ablehnung durch die Policy: eine gelöschte Datei
// kommt nicht zurück, Wiederholen führt nur wieder in denselben Absturz.
export class LokaleDateiFehlt extends Error {
  constructor(readonly uri: string) {
    super('Diese Aufnahme ist auf dem Gerät nicht mehr auffindbar.');
    this.name = 'LokaleDateiFehlt';
  }
}

async function teilHochladen(url: string, uri: string, contentType: string): Promise<void> {
  const datei = new File(uri);
  if (!datei.exists) throw new LokaleDateiFehlt(uri);
  const antwort = await datei.upload(url, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': contentType },
  });
  // upload() wirft NICHT bei 4xx/5xx, es liefert die Antwort zurueck (anders
  // als bei einem Lesefehler oder Abbruch). Der Status muss also selbst
  // geprueft werden, sonst gilt ein abgelehnter Upload als erledigt und der
  // Moment waere verloren.
  if (antwort.status < 200 || antwort.status >= 300) {
    throw new Error('Hochladen fehlgeschlagen.');
  }
}

// Der eine Weg, auf dem ein Moment die Warteschlange OHNE Erfolg verlässt.
// Zwei Fälle enden hier: die dauerhafte Ablehnung durch die Policy und die
// fehlende lokale Datei. Beide sind endgültig, und Spec §8 verspricht für
// beide «mit Erklärung verworfen».
//
// Die Reihenfolge ist nicht beliebig (Final-Review, Important 9): ZUERST
// festhalten, dann verwerfen. Bricht es zwischen den beiden Schritten ab,
// bleibt der Job liegen und läuft erneut hier durch (insert or replace macht
// das folgenlos). Umgekehrt wäre der Moment wortlos weg. Die Dateien gehen
// zuletzt (Critical 2): ohne Aufräumen blieben Medium und Thumbnail für immer
// liegen, und niemand käme je wieder daran vorbei.
async function jobVerwerfen(job: QueueJob, grund: string, meineGeneration: number): Promise<void> {
  await queueDb.verworfenenMerken({
    id: job.post_id,
    trip_id: job.trip_id,
    author_id: job.author_id,
    grund,
    verworfen_am: Date.now(),
  });
  if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
  await queueDb.jobEntfernen(job.id);
  medien.momentDateienEntfernen(job.post_id);
}

// Arbeitet EINEN bereits ausgewählten Job komplett ab (alle fälligen Schritte),
// nicht nur einen einzelnen Schritt, siehe einenJobAbarbeiten() für die Auswahl.
// meineGeneration: die Worker-Laufzeit, zu der dieser Durchlauf beim Start
// gehörte (siehe gehoertZurLaufendenGeneration oben), wird vor jedem
// Schreibvorgang erneut geprüft, nicht nur einmal beim Eintritt.
async function verarbeiteJob(job: QueueJob, jetzt: number, meineGeneration: number): Promise<void> {
  let aktuell = job;
  try {
    if (!aktuell.zeile_angelegt) {
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      const angelegt = await postsApi.momentAnlegen(aktuell);
      if (angelegt.error) {
        if (angelegt.dauerhaftAbgelehnt) {
          // Reise wurde währenddessen aufgedeckt und captured_at liegt nach dem
          // Reveal: posts_insert_member lehnt das für immer ab (Phase 1 erlaubt nur
          // Nachzügler von vorher). Wiederholen hilft nie, Job verwerfen, Grund
          // festhalten, statt ihn endlos zu wiederholen (Task-6-Brief §Step 4).
          if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
          await jobVerwerfen(aktuell, angelegt.error, meineGeneration);
          console.error(
            '[uploadWorker] Moment dauerhaft von der Policy abgelehnt, Job verworfen',
            aktuell.id,
            angelegt.error
          );
          return;
        }
        throw new Error(angelegt.error);
      }
      aktuell = { ...aktuell, zeile_angelegt: true };
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      await queueDb.jobAktualisieren(aktuell);
    }

    const { urls, dauerhaftAbgelehnt } = await postsApi.signierteUrls(aktuell.post_id);
    if (!urls) {
      // Dritter dauerhafter Fall (404, siehe postsApi.signierteUrls): die
      // posts-Zeile gibt es serverseitig nicht mehr. Erneut anlegen wäre
      // falsch — der Moment gehört zu einem Stand, den es nicht mehr gibt.
      if (dauerhaftAbgelehnt) {
        if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
        await jobVerwerfen(
          aktuell,
          'Dieser Moment ist auf dem Server nicht mehr vorhanden.',
          meineGeneration
        );
        console.error('[uploadWorker] Moment serverseitig verschwunden, Job verworfen', aktuell.id);
        return;
      }
      throw new Error('Signierte URLs konnten nicht geholt werden.');
    }

    if (!aktuell.medium_geladen) {
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      // Content-Type aus dem Speicherschlüssel statt aus der Aufnahmeart
      // (Important 5): auf iOS ist ein Video QuickTime, kein MP4. Der Bucket
      // prüft den DEKLARIERTEN Typ und hätte die falsche Angabe klaglos
      // angenommen, dauerhaft falsch etikettierte Objekte, nach dem Upload
      // nicht mehr zu heilen.
      await teilHochladen(
        urls.medium_url,
        aktuell.medium_uri,
        medien.contentTypeFuerSchluessel(aktuell.storage_key)
      );
      aktuell = { ...aktuell, medium_geladen: true };
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      await queueDb.jobAktualisieren(aktuell);
    }

    if (!aktuell.thumb_geladen) {
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      await teilHochladen(urls.thumb_url, aktuell.thumb_uri, 'image/jpeg');
      aktuell = { ...aktuell, thumb_geladen: true };
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      await queueDb.jobAktualisieren(aktuell);
    }

    if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
    const bestaetigt = await postsApi.uploadBestaetigen(aktuell.post_id);
    if (bestaetigt.error) {
      // Final-Review, Important 4: ein unvollständiges Objekt war eine
      // Sackgasse. medium_geladen/thumb_geladen wurden gesetzt, sobald der PUT
      // 2xx lieferte, und nie zurückgenommen. Liegt im Speicher ein 0-Byte-
      // oder abgeschnittenes Objekt, antwortet confirm korrekt mit "Upload ist
      // noch nicht vollständig", aber der nächste Durchlauf übersprang beide
      // Uploads und rief nur wieder confirm. Für immer, alle fünf Sekunden.
      // Die Flags werden deshalb zurückgesetzt, BEVOR der Fehlschlag
      // gespeichert wird (das übernimmt der catch-Zweig mit `aktuell`), damit
      // der nächste Anlauf wirklich neu hochlädt.
      if (bestaetigt.unvollstaendig) {
        aktuell = { ...aktuell, medium_geladen: false, thumb_geladen: false };
      }
      throw new Error(bestaetigt.error);
    }

    // fertig ⇒ sofort entfernen statt erst noch den Zustand zu persistieren:
    // ein zusätzliches update() vor dem delete() wäre ein überflüssiger Schreibvorgang.
    if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
    await queueDb.jobEntfernen(aktuell.id);
    // Erfolgspfad (Critical 2): erst die Zeile, dann die Dateien, in dieser
    // Reihenfolge, weil ein Absturz dazwischen höchstens einen verwaisten
    // Ordner hinterlässt. Umgekehrt bliebe ein Job zurück, dessen Dateien
    // fehlen, und der PUT scheiterte danach für immer.
    medien.momentDateienEntfernen(aktuell.post_id);
  } catch (fehler) {
    // Auch der Fehlschlag-Zähler ist ein Schreibvorgang: eine beendete
    // Generation darf ihn nicht mehr hinterlassen (siehe Kommentar oben).
    if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
    // Zweiter dauerhafter Fall neben der Policy-Ablehnung oben: die Aufnahme
    // liegt nicht mehr auf dem Gerät. Der Job darf hier NICHT in den normalen
    // Backoff, sonst liefe er bei jedem App-Start erneut in dieselbe Wand.
    if (fehler instanceof LokaleDateiFehlt) {
      await jobVerwerfen(aktuell, fehler.message, meineGeneration);
      console.error(
        '[uploadWorker] lokale Aufnahme fehlt, Job verworfen',
        aktuell.id,
        fehler.uri
      );
      return;
    }
    const nachher = queueLogic.nachFehlschlag(aktuell, jetzt);
    await queueDb.jobAktualisieren(nachher);
    console.error('[uploadWorker] Job fehlgeschlagen, wird erneut versucht', aktuell.id, fehler);
  }
}

// Verhindert Überlappung INNERHALB derselben Worker-Generation (Task-6-Brief,
// z.B. der 5-Sekunden-Tick, während ein Upload noch unterwegs ist), bewusst
// nicht mehr über ein einzelnes globales Flag (Task-13-Fix-Runde-2): ein
// Durchlauf blockiert nur einen zweiten Durchlauf DERSELBEN Generation. Ein
// neuer Durchlauf nach stoppe()+starte() (Wechsel zu einer anderen Person auf
// demselben Gerät, oder ein sofortiges Wiederanmelden derselben Person) gehört
// einer NEUEN Generation an und wird von einem noch ausklingenden alten
// Durchlauf nicht blockiert, dessen Schreibversuche scheitern ohnehin am
// Generationscheck in verarbeiteJob. Ein rein globales Flag, das stoppe()
// zurücksetzt (Runde 1), hätte dagegen JEDE Überlappung erlaubt, auch zweier
// Durchläufe derselben, noch laufenden Generation.
let laufendeGeneration: number | null = null;

// Exportiert und macht genau einen Auswahl-plus-Abarbeiten-Durchlauf, nur so
// ist die Schleife ohne echten Timer testbar (Task-6-Brief §Step 4).
export async function einenJobAbarbeiten(): Promise<void> {
  // Erfasst VOR jedem await dieses Durchlaufs, welcher Worker-Laufzeit er
  // angehört, stoppe() kann dazwischen laufen, während dieser Durchlauf noch
  // auf Netzwerk/SQLite wartet (siehe verarbeiteJob).
  const meineGeneration = generation;
  if (laufendeGeneration === meineGeneration) return;
  laufendeGeneration = meineGeneration;
  try {
    await sicherstellenInitialisiert();
    const [netz, nurWlan, jobs, aktuelleAutorId] = await Promise.all([
      Network.getNetworkStateAsync(),
      einstellungen.nurUeberWlan(),
      queueDb.alleJobs(),
      postsApi.aktuelleAutorId(),
    ]);
    const aufWlan = netz.type === WIFI;
    const jetzt = Date.now();
    const job = queueLogic.naechsterJob(jobs, jetzt, aufWlan, nurWlan, aktuelleAutorId);
    if (!job) return;
    await verarbeiteJob(job, jetzt, meineGeneration);
  } catch (fehler) {
    // Schutz gegen einen kaputten Durchlauf (z.B. SQLite/Netzwerk-Ausnahme VOR der
    // Job-Auswahl): darf die Intervall-Schleife nie zum Stehen bringen.
    console.error('[uploadWorker] Durchlauf fehlgeschlagen', fehler);
  } finally {
    if (laufendeGeneration === meineGeneration) laufendeGeneration = null;
  }
}

export async function jobEinreihen(job: QueueJob): Promise<void> {
  await sicherstellenInitialisiert();
  await queueDb.jobHinzufuegen(job);
}

export async function wartende(): Promise<number> {
  await sicherstellenInitialisiert();
  const jobs = await queueDb.alleJobs();
  return queueLogic.wartendeAnzahl(jobs);
}

let intervallId: ReturnType<typeof setInterval> | null = null;
let netzAbo: { remove: () => void } | null = null;

// Idempotent: ein zweiter Aufruf, während der Worker schon läuft, legt kein
// zweites Intervall/Abo an (und zählt die Generation dann auch nicht hoch,
// es beginnt ja keine neue Laufzeit).
export function starte(): void {
  if (intervallId !== null) return;
  generation += 1;
  intervallId = setInterval(() => {
    void einenJobAbarbeiten();
  }, INTERVALL_MS);
  netzAbo = Network.addNetworkStateListener((zustand) => {
    if (zustand.isConnected) void einenJobAbarbeiten();
  });
}

// Ebenfalls idempotent: ohne laufenden Worker (oder ein zweites Mal aufgerufen)
// passiert nichts. Zählt die Generation hoch, jeder Durchlauf, der diese
// Laufzeit noch kannte, erkennt sich damit beim nächsten Schreibversuch als
// überholt (siehe verarbeiteJob) und bricht ab, statt zu schreiben. Kein
// gesondertes Zurücksetzen von laufendeGeneration nötig: die ist an die ALTE
// Generation gebunden, ein unmittelbar folgendes starte() erzeugt eine NEUE
// (siehe dort) und wird von einem noch ausklingenden alten Durchlauf deshalb
// nie blockiert (Task-13-Fix-Runde-2).
export function stoppe(): void {
  if (intervallId !== null) {
    clearInterval(intervallId);
    intervallId = null;
  }
  netzAbo?.remove();
  netzAbo = null;
  generation += 1;
}
