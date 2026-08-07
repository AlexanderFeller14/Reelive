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
async function verarbeiteJob(job: QueueJob, jetzt: number): Promise<void> {
  let aktuell = job;
  try {
    if (!aktuell.zeile_angelegt) {
      const angelegt = await postsApi.momentAnlegen(aktuell);
      if (angelegt.error) {
        if (angelegt.dauerhaftAbgelehnt) {
          // Reise wurde währenddessen aufgedeckt und captured_at liegt nach dem
          // Reveal: posts_insert_member lehnt das für immer ab (Phase 1 erlaubt nur
          // Nachzügler von vorher). Wiederholen hilft nie — Job verwerfen, Grund
          // festhalten, statt ihn endlos zu wiederholen (Task-6-Brief §Step 4).
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
      await queueDb.jobAktualisieren(aktuell);
    }

    const urls = await postsApi.signierteUrls(aktuell.post_id);
    if (!urls) throw new Error('Signierte URLs konnten nicht geholt werden.');

    if (!aktuell.medium_geladen) {
      await teilHochladen(urls.medium_url, aktuell.medium_uri, aktuell.typ === 'video' ? 'video/mp4' : 'image/jpeg');
      aktuell = { ...aktuell, medium_geladen: true };
      await queueDb.jobAktualisieren(aktuell);
    }

    if (!aktuell.thumb_geladen) {
      await teilHochladen(urls.thumb_url, aktuell.thumb_uri, 'image/jpeg');
      aktuell = { ...aktuell, thumb_geladen: true };
      await queueDb.jobAktualisieren(aktuell);
    }

    const bestaetigt = await postsApi.uploadBestaetigen(aktuell.post_id);
    if (bestaetigt.error) throw new Error(bestaetigt.error);

    // fertig ⇒ sofort entfernen statt erst noch den Zustand zu persistieren:
    // ein zusätzliches update() vor dem delete() wäre ein überflüssiger Schreibvorgang.
    await queueDb.jobEntfernen(aktuell.id);
  } catch (fehler) {
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
    await verarbeiteJob(job, jetzt);
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
// zweites Intervall/Abo an.
export function starte(): void {
  if (intervallId !== null) return;
  intervallId = setInterval(() => {
    void einenJobAbarbeiten();
  }, INTERVALL_MS);
  netzAbo = Network.addNetworkStateListener((zustand) => {
    if (zustand.isConnected) void einenJobAbarbeiten();
  });
}

// Ebenfalls idempotent: ohne laufenden Worker (oder ein zweites Mal aufgerufen)
// passiert nichts.
export function stoppe(): void {
  if (intervallId !== null) {
    clearInterval(intervallId);
    intervallId = null;
  }
  netzAbo?.remove();
  netzAbo = null;
}
