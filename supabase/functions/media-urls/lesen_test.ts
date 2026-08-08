// Integrationstest für die Aktion `lesen` — den ersten Leseweg des Systems.
//
// Warum dieser Test schwerer wiegt als seine Zeilenzahl: Bis Phase 5 war die
// Versiegelung dadurch geschützt, dass `media-urls` ausschliesslich PUT-URLs
// ausstellte. Es gab schlicht keinen Weg, an fremde (oder eigene) Bytes zu
// kommen. Jetzt gibt es einen, und was ihn zurückhält, ist eine Prüfkette in
// TypeScript statt eine fehlende Funktion. Dieser Test ist der Beleg, dass
// die Kette hält — vor allem Fall 1: **vor dem Reveal gibt es keine URL, auch
// nicht für die Autorin des Moments.** Das ist kein Grenzfall, das ist das
// Produkt.
//
// Belegt (Nummern wie im Task-Brief):
//   1. Vor dem Reveal antwortet `lesen` mit 403, auch für die Autorin.
//   2. Für ein Nicht-Mitglied 403 — geprüft NACH dem Reveal, sonst würde
//      schon die Versiegelung abweisen und die Mitgliedschaftsprüfung bliebe
//      ungetestet.
//   3. Nach dem Reveal bekommt ein Mitglied URLs, und ein GET darauf gibt die
//      hochgeladenen Bytes zurück.
//   4. Ein PUT auf eine Lese-URL scheitert (SigV4 nimmt die HTTP-Methode als
//      erste Zeile des Canonical Request auf) — und das Objekt bleibt danach
//      nachweislich unverändert.
//   5. Momente mit upload_status='pending' fehlen in der Antwort.
// Dazu, weil billig und aus der Angreifer-Sicht naheliegend: unbekannte
// trip_id → 404, archivierte Reise → weiterhin lesbar, Gültigkeit der
// Lese-URLs = 3600 s gegenüber 600 s beim Upload, thumb_url entfällt bei
// thumb_key = null — und: eine Zeile, deren gespeicherter storage_key auf
// eine FREMDE Reise zeigt, bekommt trotzdem nur eine URL auf den
// abgeleiteten Pfad der eigenen (Zeile D unten).
//
// Aufbau wie confirm_integration_test.ts: kein Unit-Test (index.ts exportiert
// bewusst nichts, Deno.serve steht direkt im Modul), sondern echte
// HTTP-Aufrufe gegen einen laufenden lokalen Stack. Ohne Stack überspringt
// sich der Test mit einer Log-Zeile, statt einen Rechner ohne Docker rot zu
// färben.
//
// Ausführen (Terminal 1 offen lassen: `supabase functions serve media-urls
// --env-file supabase/functions/.env`), dann in Terminal 2:
//   cd supabase/functions/media-urls
//   npx deno test --allow-net --allow-run=supabase lesen_test.ts
//
// Läuft die Function ausnahmsweise woanders (z. B. direkt auf dem Host, weil
// der Edge-Runtime-Container gerade die Quellen eines anderen Arbeitsordners
// serviert), zeigt MEDIA_URLS_URL den Test dorthin — dann zusätzlich
// --allow-env. Ohne diese Berechtigung fällt der Test still auf den
// Standardpfad zurück, statt an einer Permission-Abfrage hängen zu bleiben.

import { assert, assertEquals, assertExists, assertFalse } from 'jsr:@std/assert';
import { erwarteteSchluessel } from './keys.ts';

const LEA_ID = '11111111-1111-4111-8111-111111111111';
// Ben ist in seed.sql angelegt, aber in keiner Reise Mitglied — genau die
// Rolle, die hier gebraucht wird. Sein Fall deckt zugleich die entfernte
// Mitreisende ab: `trip_members`-Zeile weg heisst ab da dasselbe wie nie
// dagewesen, unabhängig davon, dass sie die trip_id kennt.
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const BUCKET = 'media';
const MEDIUM_INHALT = 'echte-jpeg-bytes-fuer-den-lesetest';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Selbst signiertes HS256-JWT gegen das lokale Projekt-Secret — dieselbe
// Technik wie in confirm_integration_test.ts (auth.sms.test_otp deckt in
// config.toml nur zwei Nummern ab und liefert ohnehin kein Token für einen
// automatisierten Lauf).
async function mintJwt(secret: string, userId: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: 'authenticated', exp: now + 3600, iat: now, sub: userId, role: 'authenticated' };
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

// Werte NIE hier fest eintippen: sie unterscheiden sich pro Projekt/Rechner.
// `supabase status` ist die einzige Quelle.
async function supabaseStatusEnv(): Promise<Record<string, string> | null> {
  try {
    const cmd = new Deno.Command('supabase', { args: ['status', '-o', 'env'], stdout: 'piped', stderr: 'null' });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return null;
  }
}

// Ohne --allow-env wirft Deno.env.get; das ist hier kein Fehler, sondern der
// Normalfall (siehe Header).
function envOderNull(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

// Erkennt speziell UNSERE Function (JSON mit "fehler"-Feld), nicht nur
// irgendeine Antwort von Kong.
async function functionErreichbar(url: string, anonKey: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const daten = await res.json().catch(() => null);
    return Boolean(daten && typeof daten === 'object' && 'fehler' in daten);
  } catch {
    return false;
  }
}

const statusEnv = await supabaseStatusEnv();
const SUPABASE_URL = statusEnv?.API_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = statusEnv?.ANON_KEY ?? '';
const SERVICE_ROLE_KEY = statusEnv?.SERVICE_ROLE_KEY ?? '';
const JWT_SECRET = statusEnv?.JWT_SECRET ?? '';
const FUNCTION_URL = envOderNull('MEDIA_URLS_URL') ?? `${SUPABASE_URL}/functions/v1/media-urls`;

const stackBereit = Boolean(
  statusEnv && ANON_KEY && SERVICE_ROLE_KEY && JWT_SECRET &&
    (await functionErreichbar(FUNCTION_URL, ANON_KEY)),
);

if (!stackBereit) {
  console.warn(
    'lesen_test: übersprungen — braucht `supabase start` UND ' +
      '`supabase functions serve media-urls --env-file supabase/functions/.env` ' +
      'in einem zweiten Terminal. Details im Datei-Header.',
  );
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

// Liest den Body genau einmal (als Text), prüft den Status damit als
// Fehlermeldung und parst danach erst als JSON — .json() UND .text() auf
// derselben Response wäre "Body already consumed".
async function erwarteJson(res: Response, erwarteterStatus: number): Promise<unknown> {
  const text = await res.text();
  assertEquals(res.status, erwarteterStatus, text);
  return text.length > 0 ? JSON.parse(text) : null;
}

type LeseAntwort = {
  medien: Array<{ post_id: string; medium_url: string; thumb_url?: string }>;
  gueltig_bis: string;
};

Deno.test({
  name: 'lesen gibt Medien erst nach dem Reveal heraus, und nur an Mitglieder',
  ignore: !stackBereit,
  async fn() {
    // Eigene Reise + eigene Momente statt seed.sql-Fixtures: robust gegenüber
    // Änderungen an seed.sql, hinterlässt dort keine Spuren. Der
    // trips_add_owner_membership-Trigger legt die trip_members-Zeile für Lea
    // automatisch an. Die Reise startet mit status='active' — versiegelt.
    const tripRes = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        name: 'Integrationstest media-urls lesen',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        owner_id: LEA_ID,
      }),
    });
    const [trip] = (await erwarteJson(tripRes, 201)) as Array<{ id: string; status: string }>;
    const tripId: string = trip.id;
    assertEquals(trip.status, 'active');

    const leaJwt = await mintJwt(JWT_SECRET, LEA_ID);
    const benJwt = await mintJwt(JWT_SECRET, BEN_ID);
    const leaHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${leaJwt}`, 'content-type': 'application/json' };
    const benHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${benJwt}`, 'content-type': 'application/json' };

    const lesen = (headers: Record<string, string>, id: string) =>
      fetch(FUNCTION_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ aktion: 'lesen', trip_id: id }),
      });

    // Schlüssel des hochgeladenen Moments, für das Aufräumen im finally.
    let hochgeladeneSchluessel: string[] = [];

    try {
      // --- Fixtures -------------------------------------------------------
      // A: ein echter, fertig hochgeladener Moment (der einzige mit Bytes im
      //    Speicher). captured_at bewusst als frühestes der drei.
      const postARes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: 'trips/falsch/platzhalter.jpg',
          captured_at: '2026-01-01T08:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postA] = (await erwarteJson(postARes, 201)) as Array<{ id: string }>;

      // B: eingesendet, aber nie fertig hochgeladen — darf in keiner Antwort
      //    auftauchen (Fall 5). Ein Objekt dazu gibt es nicht.
      const postBRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: `trips/${tripId}/pending.jpg`,
          captured_at: '2026-01-01T09:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postB] = (await erwarteJson(postBRes, 201)) as Array<{ id: string; upload_status: string }>;
      assertEquals(postB.upload_status, 'pending');

      // C: uploaded, aber ohne thumb_key. Über `confirm` kann dieser Zustand
      //    heute nicht mehr entstehen (es schreibt immer beide Schlüssel) —
      //    die Spalte ist aber nullable, und genau darauf zielt der Test:
      //    signiert werden darf keine URL auf "null". Die id wird hier
      //    vorgegeben, damit der storage_key derselbe abgeleitete Pfad ist,
      //    den auch `confirm` schreiben würde — eine ansonsten normale Zeile.
      const postCId = crypto.randomUUID();
      const postCRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postCId,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: erwarteteSchluessel(tripId, postCId, 'photo', 'jpg').storage_key,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T10:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      const [postC] = (await erwarteJson(postCRes, 201)) as Array<{ id: string }>;

      // D: der Angriffsfall. Eine Zeile in DIESER Reise, deren storage_key
      //    auf eine fremde Reise zeigt. So eine Zeile kann heute keine
      //    `authenticated`-Person erzeugen — upload_status ist vom
      //    Spalten-Grant ausgenommen (20260803090600_role_hardening.sql) und
      //    UPDATE gibt es gar nicht, hier im Test schreibt sie deshalb die
      //    Service-Role. Der Test hält trotzdem fest, was passieren MUSS,
      //    wenn diese Zusicherung je fällt: `lesen` signiert den
      //    abgeleiteten Pfad, nie den gespeicherten. Sonst wäre eine
      //    einzige gelockerte Migration genug, um über eine eigene Reise
      //    beliebige fremde Medien auszulesen.
      const fremderPfad = 'trips/00000000-0000-4000-8000-00000000dead/00000000-0000-4000-8000-00000000beef.jpg';
      const postDId = crypto.randomUUID();
      const postDRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          id: postDId,
          trip_id: tripId,
          author_id: LEA_ID,
          type: 'photo',
          storage_key: fremderPfad,
          thumb_key: null,
          upload_status: 'uploaded',
          captured_at: '2026-01-01T11:00:00+01:00',
          captured_tz: 'Europe/Zurich',
        }),
      });
      await erwarteJson(postDRes, 201);

      // A tatsächlich hochladen — über denselben Weg wie die App: sign, PUT,
      // confirm. Erst danach trägt die Zeile die server-abgeleiteten
      // Schlüssel, und nur die darf `lesen` signieren.
      const signRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: leaHeaders,
        body: JSON.stringify({ aktion: 'sign', post_id: postA.id }),
      });
      const uploadUrls = (await erwarteJson(signRes, 200)) as { medium_url: string; thumb_url: string };
      hochgeladeneSchluessel = [
        new URL(uploadUrls.medium_url).pathname.split(`/${BUCKET}/`)[1],
        new URL(uploadUrls.thumb_url).pathname.split(`/${BUCKET}/`)[1],
      ];

      // Die Gültigkeit der Upload-URL steht in der URL selbst — der direkte
      // Beleg, dass die 600 s der Upload-Konstante unangetastet bleiben,
      // ohne von Uhren oder Laufzeiten abzuhängen.
      assertEquals(new URL(uploadUrls.medium_url).searchParams.get('X-Amz-Expires'), '600');

      for (const [url, inhalt] of [
        [uploadUrls.medium_url, MEDIUM_INHALT],
        [uploadUrls.thumb_url, 'echte-thumb-bytes'],
      ]) {
        const put = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: inhalt });
        assertEquals(put.status, 200, await put.text());
      }
      const confirmRes = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: leaHeaders,
        body: JSON.stringify({ aktion: 'confirm', post_id: postA.id }),
      });
      assertEquals(await erwarteJson(confirmRes, 200), { ok: true });

      // --- Fall 1: vor dem Reveal keine URL, auch nicht für die Autorin ---
      // Lea ist Eigentümerin der Reise, Mitglied und Autorin aller drei
      // Momente. Wenn irgendjemand vor dem Reveal etwas sehen dürfte, dann
      // sie — genau deshalb steht hier 403. Die Bytes liegen zu diesem
      // Zeitpunkt nachweislich im Speicher (confirm oben war erfolgreich):
      // es fehlt nichts ausser der Erlaubnis.
      const versiegelt = await lesen(leaHeaders, tripId);
      assertEquals(await erwarteJson(versiegelt, 403), { fehler: 'Diese Reise ist noch versiegelt.' });

      // Unbekannte Reise: 404, bevor überhaupt etwas anderes geprüft wird.
      const unbekannt = await lesen(leaHeaders, '00000000-0000-4000-8000-0000000000ff');
      assertEquals(await erwarteJson(unbekannt, 404), { fehler: 'Reise nicht gefunden.' });

      // --- Reveal ---------------------------------------------------------
      // Direkt per Service-Role statt über reveal-trip: dieser Test prüft
      // `lesen`, nicht den Statuswechsel, und soll nicht von einer zweiten
      // servierten Function abhängen. Die Check-Constraint der Tabelle
      // verlangt beide Spalten zusammen.
      const revealRes = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ status: 'revealed', revealed_at: 'now' }),
      });
      await erwarteJson(revealRes, 200);

      // --- Fall 2: Nicht-Mitglied ----------------------------------------
      // Jetzt ist die Reise offen — die Versiegelung weist Ben also nicht
      // mehr ab. Was ihn abweist, ist ausschliesslich die fehlende
      // trip_members-Zeile.
      const fremd = await lesen(benHeaders, tripId);
      assertEquals(await erwarteJson(fremd, 403), { fehler: 'Kein Zugriff auf diese Reise.' });

      // --- Fall 3 + 5: Mitglied bekommt URLs, pending fehlt ---------------
      const vorherStempel = Date.now();
      const okRes = await lesen(leaHeaders, tripId);
      const antwort = (await erwarteJson(okRes, 200)) as LeseAntwort;

      // Genau A, C und D, in captured_at-Reihenfolge; B (pending) fehlt.
      assertEquals(antwort.medien.map((m) => m.post_id), [postA.id, postC.id, postDId]);

      const eintragA = antwort.medien[0];
      const eintragC = antwort.medien[1];
      const eintragD = antwort.medien[2];

      // thumb_key = null ⇒ kein thumb_url-Feld, statt einer Signatur auf
      // ".../null".
      assertExists(eintragA.thumb_url);
      assertEquals(eintragC.thumb_url, undefined);
      assertFalse(eintragC.medium_url.includes('null'));

      // Der signierte Pfad ist der abgeleitete, nicht der gespeicherte:
      // Zeile D zeigt auf eine fremde Reise, die URL darf da nicht hin.
      assertFalse(
        eintragD.medium_url.includes('00000000-0000-4000-8000-00000000dead'),
        'lesen hat den gespeicherten (fremden) storage_key signiert',
      );
      assert(
        new URL(eintragD.medium_url).pathname.endsWith(
          erwarteteSchluessel(tripId, postDId, 'photo', 'jpg').storage_key,
        ),
        `unerwarteter Pfad: ${eintragD.medium_url}`,
      );
      // Und die normale Zeile C zeigt genau dorthin, wo sie soll — die
      // Ableitung ist für legitime Daten deckungsgleich mit der Spalte.
      assert(
        new URL(eintragC.medium_url).pathname.endsWith(
          erwarteteSchluessel(tripId, postC.id, 'photo', 'jpg').storage_key,
        ),
        `unerwarteter Pfad: ${eintragC.medium_url}`,
      );

      // Gültigkeit: 3600 s, direkt aus der signierten URL abgelesen — die
      // zweite, von der Upload-Konstante getrennte Zahl.
      assertEquals(new URL(eintragA.medium_url).searchParams.get('X-Amz-Expires'), '3600');
      assertEquals(new URL(eintragA.thumb_url).searchParams.get('X-Amz-Expires'), '3600');

      // gueltig_bis passt dazu und ist nie später als die echte Ablaufzeit.
      // Das Fenster ist absichtlich weit: die Function läuft im Container,
      // der Test auf dem Host — ein paar Sekunden Uhrenversatz sind normal,
      // 600 gegen 3600 unterscheidet es trotzdem zweifelsfrei.
      const restSekunden = (Date.parse(antwort.gueltig_bis) - vorherStempel) / 1000;
      assert(
        restSekunden > 3000 && restSekunden <= 3601,
        `gueltig_bis liegt ${restSekunden}s in der Zukunft, erwartet ~3600s`,
      );

      // Der GET liefert wirklich die hochgeladenen Bytes — nicht nur einen
      // Statuscode, der auch von einer Fehlerseite kommen könnte.
      const getMedium = await fetch(eintragA.medium_url);
      assertEquals(getMedium.status, 200);
      assertEquals(await getMedium.text(), MEDIUM_INHALT);
      const getThumb = await fetch(eintragA.thumb_url);
      assertEquals(getThumb.status, 200);
      assertEquals(await getThumb.text(), 'echte-thumb-bytes');

      // --- Fall 4: PUT auf eine Lese-URL ---------------------------------
      // SigV4 nimmt die HTTP-Methode als erste Zeile in den Canonical
      // Request auf; dessen Hash steckt im String-to-Sign. Der Server
      // berechnet für ein PUT deshalb eine andere Signatur als die in der
      // URL und lehnt ab. Die URL trägt die Methode nirgends sichtbar — das
      // hier ist der Beleg, dass sie trotzdem gebunden ist.
      const putVersuch = await fetch(eintragA.medium_url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: 'ueberschrieben-durch-angreifer',
      });
      assert(
        putVersuch.status >= 400,
        `PUT auf eine Lese-URL wurde mit ${putVersuch.status} angenommen`,
      );
      const putText = await putVersuch.text();
      assert(
        /SignatureDoesNotMatch/i.test(putText) || putVersuch.status === 403,
        `PUT scheiterte, aber nicht an der Signatur: ${putVersuch.status} ${putText}`,
      );

      // Und der entscheidende Nachweis: das Objekt ist unverändert.
      const nachPut = await fetch(eintragA.medium_url);
      assertEquals(nachPut.status, 200);
      assertEquals(await nachPut.text(), MEDIUM_INHALT);

      // --- Archiv bleibt lesbar ------------------------------------------
      // «Archiviert» heisst weggelegt, nicht zugesperrt (dieselbe Menge wie
      // in posts_select_revealed_members).
      const archivRes = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ status: 'archived' }),
      });
      await erwarteJson(archivRes, 200);

      const archiviert = await lesen(leaHeaders, tripId);
      const archivAntwort = (await erwarteJson(archiviert, 200)) as LeseAntwort;
      assertEquals(archivAntwort.medien.map((m) => m.post_id), [postA.id, postC.id, postDId]);

      // Im Archiv bleibt ein Nicht-Mitglied ein Nicht-Mitglied.
      const fremdImArchiv = await lesen(benHeaders, tripId);
      assertEquals(await erwarteJson(fremdImArchiv, 403), { fehler: 'Kein Zugriff auf diese Reise.' });
    } finally {
      // Test-Objekte aus dem Bucket entfernen, damit wiederholte Läufe nicht
      // liegen bleiben. Bewusst schlankere Header als restHeaders(): ein
      // "content-type: application/json" ohne Body quittiert die Storage-API
      // (Fastify) mit 400. Fehlschläge werden gemeldet, nicht verschluckt.
      for (const key of hochgeladeneSchluessel) {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        }).catch((err) => {
          console.warn(`Aufräumen von ${key} fehlgeschlagen (Netzwerk):`, err);
          return null;
        });
        if (res && !res.ok) {
          console.warn(`Aufräumen von ${key} fehlgeschlagen: HTTP ${res.status}`, await res.text());
        }
      }

      // Cascade räumt trip_members und posts der Test-Reise mit auf.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${tripId}`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch((err) => {
        console.warn('Aufräumen der Test-Reise fehlgeschlagen (Netzwerk):', err);
        return null;
      });
      if (res && !res.ok) {
        console.warn(`Aufräumen der Test-Reise fehlgeschlagen: HTTP ${res.status}`, await res.text());
      }
    }
  },
});
