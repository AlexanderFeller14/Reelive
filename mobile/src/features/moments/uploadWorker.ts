import * as Network from 'expo-network';

import * as queueDb from './queueDb';
import * as queueLogic from './queueLogic';
import * as postsApi from './postsApi';
import * as einstellungen from './einstellungen';
import type { QueueJob } from './types';

// Einzige Stelle, die Jobs verändert (Task-6-Brief). Jeder Teilschritt wird für
// sich persistiert — ein Absturz zwischen zwei Schritten darf beim nächsten
// Durchlauf nie wiederholen, was schon geschafft ist (Spec §5, «kein Moment
// geht verloren»).

const INTERVALL_MS = 5_000;

// Task-13-Fix-Runde-1: ein Job, der beim Abmelden gerade auf Netz-Ein-/Ausgabe
// wartet (bei einem Video leicht mehrere Sekunden), darf danach nicht weiter-
// schreiben. postsApi.momentAnlegen() liest die Autorenschaft erst BEIM
// SCHREIBEN aus der aktuell aktiven Sitzung (nicht beim Einreihen) — meldet
// sich währenddessen eine andere Person auf demselben Gerät an, würde die
// Aufnahme sonst unter deren Namen landen. starte()/stoppe() zählen diese
// Generation hoch; jeder Durchlauf merkt sich seine beim Start, verarbeiteJob
// prüft sie vor jedem einzelnen Schreibvorgang (Insert, Upload, Update,
// Bestätigung, Löschen) erneut — nicht nur einmal am Anfang, weil sich der
// Stand zwischen zwei await-Punkten geändert haben kann.
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
// gecacht (kein Promise-Caching) — sonst bliebe die Queue nach einem
// einmaligen Init-Fehler für den Rest der Session tot.
let initialisiert = false;
async function sicherstellenInitialisiert(): Promise<void> {
  if (initialisiert) return;
  await queueDb.initQueue();
  initialisiert = true;
}

async function teilHochladen(url: string, uri: string, contentType: string): Promise<void> {
  const antwort = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    // React Natives fetch/XHR akzeptiert { uri } als Body und streamt die lokale
    // Datei direkt (siehe react-native/Libraries/Network/convertRequestBody.js,
    // RequestBody-Union enthält {uri: string}) — kein zusätzlicher Lese-Roundtrip.
    body: { uri } as unknown as BodyInit,
  });
  if (!antwort.ok) {
    throw new Error('Hochladen fehlgeschlagen.');
  }
}

// Arbeitet EINEN bereits ausgewählten Job komplett ab (alle fälligen Schritte),
// nicht nur einen einzelnen Schritt — siehe einenJobAbarbeiten() für die Auswahl.
// meineGeneration: die Worker-Laufzeit, zu der dieser Durchlauf beim Start
// gehörte (siehe gehoertZurLaufendenGeneration oben) — wird vor jedem
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
          // Nachzügler von vorher). Wiederholen hilft nie — Job verwerfen, Grund
          // festhalten, statt ihn endlos zu wiederholen (Task-6-Brief §Step 4).
          if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
          await queueDb.jobEntfernen(aktuell.id);
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

    const urls = await postsApi.signierteUrls(aktuell.post_id);
    if (!urls) throw new Error('Signierte URLs konnten nicht geholt werden.');

    if (!aktuell.medium_geladen) {
      if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
      await teilHochladen(urls.medium_url, aktuell.medium_uri, aktuell.typ === 'video' ? 'video/mp4' : 'image/jpeg');
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
    if (bestaetigt.error) throw new Error(bestaetigt.error);

    // fertig ⇒ sofort entfernen statt erst noch den Zustand zu persistieren:
    // ein zusätzliches update() vor dem delete() wäre ein überflüssiger Schreibvorgang.
    if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
    await queueDb.jobEntfernen(aktuell.id);
  } catch (fehler) {
    // Auch der Fehlschlag-Zähler ist ein Schreibvorgang: eine beendete
    // Generation darf ihn nicht mehr hinterlassen (siehe Kommentar oben).
    if (!gehoertZurLaufendenGeneration(meineGeneration)) return;
    const nachher = queueLogic.nachFehlschlag(aktuell, jetzt);
    await queueDb.jobAktualisieren(nachher);
    console.error('[uploadWorker] Job fehlgeschlagen, wird erneut versucht', aktuell.id, fehler);
  }
}

// Ein `laeuft`-Flag genügt gegen Überlappung, solange nur dieser Worker schreibt
// (Task-6-Brief). Ein zweiter Aufruf während eines laufenden Durchlaufs (z.B. der
// 5-Sekunden-Tick, während ein Upload noch unterwegs ist) tut nichts.
let laeuft = false;

// Exportiert und macht genau einen Auswahl-plus-Abarbeiten-Durchlauf — nur so
// ist die Schleife ohne echten Timer testbar (Task-6-Brief §Step 4).
export async function einenJobAbarbeiten(): Promise<void> {
  if (laeuft) return;
  laeuft = true;
  // Erfasst VOR jedem await dieses Durchlaufs, welcher Worker-Laufzeit er
  // angehört — stoppe() kann dazwischen laufen, während dieser Durchlauf noch
  // auf Netzwerk/SQLite wartet (siehe verarbeiteJob).
  const meineGeneration = generation;
  try {
    await sicherstellenInitialisiert();
    const [netz, nurWlan, jobs] = await Promise.all([
      Network.getNetworkStateAsync(),
      einstellungen.nurUeberWlan(),
      queueDb.alleJobs(),
    ]);
    const aufWlan = netz.type === WIFI;
    const jetzt = Date.now();
    const job = queueLogic.naechsterJob(jobs, jetzt, aufWlan, nurWlan);
    if (!job) return;
    await verarbeiteJob(job, jetzt, meineGeneration);
  } catch (fehler) {
    // Schutz gegen einen kaputten Durchlauf (z.B. SQLite/Netzwerk-Ausnahme VOR der
    // Job-Auswahl): darf die Intervall-Schleife nie zum Stehen bringen.
    console.error('[uploadWorker] Durchlauf fehlgeschlagen', fehler);
  } finally {
    laeuft = false;
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
// zweites Intervall/Abo an (und zählt die Generation dann auch nicht hoch —
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
// passiert nichts. Zählt die Generation hoch — jeder Durchlauf, der diese
// Laufzeit noch kannte, erkennt sich damit beim nächsten Schreibversuch als
// überholt (siehe verarbeiteJob) und bricht ab, statt zu schreiben. Setzt
// zusätzlich `laeuft` zurück: ein solcher überholter Durchlauf darf ein
// unmittelbar folgendes starte() (Wechsel zu einer anderen Person auf
// demselben Gerät) nicht blockieren, bis sein eigener, längst irrelevant
// gewordener Netzwerk-Call ausklingt.
export function stoppe(): void {
  if (intervallId !== null) {
    clearInterval(intervallId);
    intervallId = null;
  }
  netzAbo?.remove();
  netzAbo = null;
  generation += 1;
  laeuft = false;
}
