// Der reale I/O-Adapter für konto-loeschen, dieselbe Rollenteilung wie
// share-link/store.ts gegenüber aufloesung.ts und reveal-trip/revealStore.ts
// gegenüber reveal.ts: ablauf.ts bleibt reine Logik ohne Supabase-Import, hier
// stehen genau die Abfragen, die kein Unit-Test ersetzen kann und die deshalb
// konto_loeschen_integration_test.ts gegen den echten Stack prüft.
//
// Die fünf, auf die es ankommt:
//   - `verlasseFremdeReisen` läuft mit dem JWT DER PERSON, nicht mit
//     Service-Role. Der Grund steht dort und ist kein Detail.
//   - `loescheEigeneTrips` löst die einzige on-delete-restrict-Beziehung des
//     Schemas auf und stösst damit die grösste Kaskade an.
//   - `loescheObjekte` blockweise, mit der (nachgemessenen) Eigenschaft, dass
//     ein bereits gelöschter Schlüssel KEIN Fehler ist.
//   - `loescheAvatar` im eigenen Bucket `avatare`, dieselbe Eigenschaft,
//     nur über die Storage-API statt über S3 (Begründung dort).
//   - die Zählabfragen für den Dialog: sie müssen die Wahrheit sagen.
//
// ---------------------------------------------------------------------------
// Warum `loescheObjekte` über das S3-Protokoll läuft, nicht über die
// Supabase-Storage-API
// ---------------------------------------------------------------------------
// Bis zum Abschluss-Review von Phase 6 löschte diese Datei über
// `supabaseAdmin.storage.from(bucket).remove(...)`, die einzige Stelle im
// ganzen Repo, die den Speicher über die Storage-API statt über S3 anspricht.
// media-urls und share-link signieren beide über `S3_ENDPOINT` (aws4fetch,
// SigV4). README.md verspricht für den Wechsel auf Cloudflare R2, es
// wechselten "nur Endpoint und Zugangsdaten", ein Versprechen, das für diese
// Function nicht galt: Ein deployter R2-Bucket ist der Storage-API gar nicht
// bekannt (die kennt nur den lokalen Supabase-Storage-Dienst), also hätte
// `remove()` dort entweder still nichts getroffen (unbekannte Schlüssel sind
// laut demselben "kein Fehler"-Prinzip kein Fehlschlag) oder dauerhaft mit
// einem Fehler geantwortet, je nachdem, ob der Storage-Dienst überhaupt noch
// existiert. Beides hätte W6 ("ein gelöschtes Konto hinterlässt kein Objekt")
// lokal grün und im echten Deployment lautlos falsch gemacht.
//
// Jetzt löscht auch diese Function über `S3_ENDPOINT`, mit denselben fünf
// Umgebungsvariablen wie media-urls/share-link (siehe index.ts), über
// dieselbe aws4fetch-Signierung. Der R2-Wechsel trifft damit wirklich nur
// Endpoint und Zugangsdaten, für alle drei Functions gleichermassen.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { AwsClient } from 'npm:aws4fetch@1';
import type { PostZeile, SeitenErgebnis } from './ablauf.ts';

export function erstelleAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof erstelleAdminClient>;

// Ein Client, der als die anfragende PERSON handelt (anon-Key + ihr JWT), nicht
// als Service-Role. PostgREST führt seine Anfragen damit als `authenticated`
// mit gesetztem auth.uid() aus.
export function erstellePersonenClient(supabaseUrl: string, anonKey: string, jwt: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Seitengrösse beim Einsammeln der Momente. An max_rows aus
// supabase/config.toml (1000) orientiert; die Richtigkeit der Schleife in
// sammleAlle hängt nicht daran, dass die beiden Zahlen gleich sind.
export const POSTS_SEITENGROESSE = 1000;

// Blockgrösse beim Löschen im Speicher. Anders als die Storage-API (ein
// Aufruf, eine Liste von Pfaden) kennt das S3-Protokoll pro Objekt nur ein
// einzelnes DELETE, `loescheObjekteBlockweise` schickt darum pro Block bis zu
// OBJEKT_BLOCKGROESSE Anfragen NEBENEINANDER (Promise.all) los, statt alle
// Schlüssel auf einmal: Ein einzelner Block bleibt damit innerhalb eines
// Zeitlimits, und der Fortschritt zwischen den Blöcken bleibt erhalten, ein
// zweiter Versuch nach einem Teilabbruch überspringt dann nur, was schon weg
// ist (siehe loescheObjekteBlockweise).
export const OBJEKT_BLOCKGROESSE = 200;

// Der Avatar-Bucket, konstant statt Umgebungsvariable: anders als die
// S3-Variablen (die zwischen lokal und R2 wechseln) heisst dieser Bucket
// lokal und produktiv gleich `avatare` (supabase/config.toml,
// [storage.buckets.avatare]), es gibt also nichts zu konfigurieren.
const AVATAR_BUCKET = 'avatare';

export type TripZeile = { id: string; cover_key: string | null };
export type Zahlen = {
  eigene_reisen: number;
  momente_in_eigenen_reisen: number;
  betroffene_personen: number;
  eigene_momente_anderswo: number;
};

export interface KontoStore {
  holeEigeneTrips(userId: string): Promise<{ data: TripZeile[] | null; error: unknown }>;
  holeAvatarKey(userId: string): Promise<{ data: string | null; error: unknown }>;

  holePostsSeiteInTrips(tripIds: string[], von: number, mitZaehlung: boolean): Promise<SeitenErgebnis<PostZeile>>;
  holeEigenePostsSeiteAusserhalb(
    userId: string,
    eigeneTripIds: string[],
    von: number,
    mitZaehlung: boolean,
  ): Promise<SeitenErgebnis<PostZeile>>;

  zaehle(userId: string, eigeneTripIds: string[]): Promise<{ data: Zahlen | null; error: unknown }>;

  loescheObjekte(schluessel: string[]): Promise<{ fehler: unknown }>;
  loescheAvatar(key: string | null): Promise<{ fehler: unknown }>;
  verlasseFremdeReisen(userId: string, eigeneTripIds: string[]): Promise<{ fehler: unknown }>;
  loescheEigeneTrips(tripIds: string[]): Promise<{ fehler: unknown }>;
  loescheAuthNutzer(userId: string): Promise<{ fehler: unknown }>;
}

// PostgREST-`in`-Filter brauchen eine Liste in Klammern. Bei leerer Liste wäre
// `in.()` ein Syntaxfehler, die Aufrufer prüfen deshalb vorher auf leer, und
// diese Hilfsfunktion existiert nur, damit die Quotierung an einer Stelle
// steht. UUIDs enthalten keine Kommas oder Anführungszeichen; die Werte kommen
// ausserdem ausschliesslich aus der Datenbank, nie aus dem Anfrage-Body.
function idListe(ids: string[]): string {
  return `(${ids.join(',')})`;
}

// ---------------------------------------------------------------------------
// Löschen im Speicher, über S3, ein DELETE pro Schlüssel
// ---------------------------------------------------------------------------

// Ergebnis EINES DELETE. `ok` ist die einzige Grösse, die
// `loescheObjekteBlockweise` auswertet, `status`/`fehler` stehen nur für die
// Fehlermeldung zur Verfügung, falls `ok` false ist.
export type LoeschErgebnisEins = { ok: boolean; status: number; fehler?: unknown };
export type LoescheEinsFn = (schluessel: string) => Promise<LoeschErgebnisEins>;

// Die reine Blockierungs-/Kurzschluss-Logik, herausgelöst von der S3-Signierung
// (Stil wie `sammleAlle` in ablauf.ts und `sende`/`inBloecke` in
// reveal-trip/push.ts): eine injizierbare `loescheEins`-Funktion macht das
// hier ohne echtes Netz testbar (siehe store_test.ts), die reale Signierung
// steckt allein in `erstelleS3Loescher` weiter unten.
//
// Blockweise UND innerhalb eines Blocks parallel (Promise.all): Anders als die
// vorige Storage-API-Fassung, die pro Block genau einen HTTP-Aufruf mit einer
// Liste von Pfaden machte, kennt das S3-Protokoll nur ein DELETE pro Objekt.
// Ohne Parallelität innerhalb eines Blocks würde eine Kontolöschung mit
// hunderten Objekten spürbar langsamer als vorher, mit ihr bleibt die
// Anzahl gleichzeitiger Anfragen durch OBJEKT_BLOCKGROESSE gedeckelt, genau
// wie die vorige Fassung die Grösse einer einzelnen Storage-API-Anfrage
// gedeckelt hat.
export async function loescheObjekteBlockweise(
  schluessel: string[],
  loescheEins: LoescheEinsFn,
  blockgroesse: number = OBJEKT_BLOCKGROESSE,
): Promise<{ fehler: unknown }> {
  for (let i = 0; i < schluessel.length; i += blockgroesse) {
    const block = schluessel.slice(i, i + blockgroesse);
    const ergebnisse = await Promise.all(block.map((key) => loescheEins(key)));
    const fehlgeschlagen = ergebnisse.find((e) => !e.ok);
    if (fehlgeschlagen) {
      return {
        fehler: fehlgeschlagen.fehler ?? new Error(`S3 DELETE fehlgeschlagen: HTTP ${fehlgeschlagen.status}`),
      };
    }
  }
  return { fehler: null };
}

// Der reale Adapter: signiert und schickt EIN S3-DELETE. `signQuery: true`
// erzeugt dieselbe Art Anfrage wie `objektGroesse` in media-urls/index.ts (HEAD
// über eine presignte URL), nur mit Methode DELETE statt HEAD.
//
// Wichtig UND nachgemessen, dieselbe Eigenschaft wie vorher bei der
// Storage-API: Ein Schlüssel, unter dem kein Objekt (mehr) liegt, ist KEIN
// Fehler. S3-kompatible Object-Storages (AWS S3, Cloudflare R2, der lokale
// Supabase-Storage-Dienst über sein S3-Gateway) beantworten DELETE auf einen
// nicht (mehr) existierenden Schlüssel genauso wie auf einen existierenden,
// mit einem Erfolgsstatus (typischerweise 204 No Content), nicht mit 404.
// Daraus folgt zweierlei, wortgleich zur Vorfassung:
//   1. Ein zweiter Löschversuch nach einem Teilabbruch läuft sauber durch.
//      Genau darauf stützt sich ablauf.ts, wenn es bei einem Fehler im
//      Speicherschritt lieber gar nichts in der Datenbank anfasst.
//   2. «Kein Fehler» bedeutet NICHT «das Objekt existierte», die einzige
//      Instanz, die das beweisen kann, ist ein Test, der ein Objekt VORHER
//      ablegt und NACHHER über einen unabhängigen Weg auf Abwesenheit prüft
//      (konto_loeschen_integration_test.ts tut genau das über die
//      Storage-REST-API, unabhängig vom S3-Pfad hier). Ein Test, der nur
//      "kein Fehler zurückgekommen" prüft, bewiese nichts, das ist exakt die
//      Falle, vor der Punkt 2 warnt: "weniger zurückbekommen als angefragt"
//      darf nicht als Fehlschlag gelten, aber es beweist auch keinen Erfolg.
export function erstelleS3Loescher(
  aws: AwsClient,
  s3Endpoint: string,
  bucket: string,
  fetchImpl: typeof fetch = fetch,
): LoescheEinsFn {
  return async (schluessel) => {
    const url = new URL(`${s3Endpoint}/${bucket}/${schluessel}`);
    try {
      const signiert = await aws.sign(url.toString(), { method: 'DELETE', aws: { signQuery: true } });
      const antwort = await fetchImpl(signiert);
      await antwort.body?.cancel();
      if (!antwort.ok) return { ok: false, status: antwort.status };
      return { ok: true, status: antwort.status };
    } catch (err) {
      return { ok: false, status: 0, fehler: err };
    }
  };
}

export function erstelleKontoStore(
  supabaseAdmin: AdminClient,
  personenClient: AdminClient,
  loescheEins: LoescheEinsFn,
): KontoStore {
  return {
    async holeEigeneTrips(userId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, cover_key')
        .eq('owner_id', userId);
      return { data: data as TripZeile[] | null, error };
    },

    async holeAvatarKey(userId) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('avatar_key')
        .eq('id', userId)
        .maybeSingle();
      const zeile = data as { avatar_key: string | null } | null;
      return { data: zeile?.avatar_key ?? null, error };
    },

    // ALLE Momente der eigenen Reisen, auch die von Mitreisenden. Die Reise
    // wird mitgelöscht (Spec §3: «Werden mitgelöscht, samt Medien aller
    // Mitglieder»), also müssen auch deren Objekte weg. Ohne diesen Weg bliebe
    // für jeden fremden Moment in einer eigenen Reise ein Objektpaar liegen,
    // dessen Pfad danach niemand mehr kennt.
    async holePostsSeiteInTrips(tripIds, von, mitZaehlung) {
      if (tripIds.length === 0) return { zeilen: [], anzahl: mitZaehlung ? 0 : null, fehler: null };
      const { data, error, count } = await supabaseAdmin
        .from('posts')
        .select('id, trip_id, type, media_ext', mitZaehlung ? { count: 'exact' } : undefined)
        .in('trip_id', tripIds)
        .order('id', { ascending: true })
        .range(von, von + POSTS_SEITENGROESSE - 1);
      if (error) return { zeilen: [], anzahl: null, fehler: error };
      return {
        zeilen: (data ?? []) as unknown as PostZeile[],
        anzahl: mitZaehlung ? (count ?? null) : null,
        fehler: null,
      };
    },

    // Die eigenen Momente in FREMDEN Reisen. Sie verschwinden über
    // posts.author_id → profiles (on delete cascade), sobald der Auth-Nutzer
    // weg ist, ihre Objekte aber nur, wenn sie hier eingesammelt werden.
    // `not.in` statt eines zweiten Durchgangs, damit kein Moment doppelt
    // gezählt wird, der in einer eigenen Reise liegt UND von der Person stammt.
    async holeEigenePostsSeiteAusserhalb(userId, eigeneTripIds, von, mitZaehlung) {
      let abfrage = supabaseAdmin
        .from('posts')
        .select('id, trip_id, type, media_ext', mitZaehlung ? { count: 'exact' } : undefined)
        .eq('author_id', userId);
      if (eigeneTripIds.length > 0) {
        abfrage = abfrage.not('trip_id', 'in', idListe(eigeneTripIds));
      }
      const { data, error, count } = await abfrage
        .order('id', { ascending: true })
        .range(von, von + POSTS_SEITENGROESSE - 1);
      if (error) return { zeilen: [], anzahl: null, fehler: error };
      return {
        zeilen: (data ?? []) as unknown as PostZeile[],
        anzahl: mitZaehlung ? (count ?? null) : null,
        fehler: null,
      };
    },

    // Die vier Zahlen für den Dialog. Sie müssen die Wahrheit sagen: Wer
    // eigene Reisen hat, löscht sie mit, samt der Momente ALLER Mitglieder.
    // Ein Dialog, der das verschweigt oder kleinrechnet, macht aus einer
    // Entscheidung eine Falle.
    async zaehle(userId, eigeneTripIds) {
      const zaehleZeilen = async (
        tabelle: 'posts' | 'trip_members',
        baue: (
          q: ReturnType<ReturnType<AdminClient['from']>['select']>,
        ) => ReturnType<ReturnType<AdminClient['from']>['select']>,
      ): Promise<{ anzahl: number; error: unknown }> => {
        const { count, error } = await baue(
          supabaseAdmin.from(tabelle).select('*', { count: 'exact', head: true }),
        );
        return { anzahl: count ?? 0, error };
      };

      const momenteInEigenen = eigeneTripIds.length === 0
        ? { anzahl: 0, error: null }
        : await zaehleZeilen('posts', (q) => q.in('trip_id', eigeneTripIds));
      if (momenteInEigenen.error) return { data: null, error: momenteInEigenen.error };

      const eigeneAnderswo = await zaehleZeilen('posts', (q) => {
        const mitAutor = q.eq('author_id', userId);
        return eigeneTripIds.length > 0 ? mitAutor.not('trip_id', 'in', idListe(eigeneTripIds)) : mitAutor;
      });
      if (eigeneAnderswo.error) return { data: null, error: eigeneAnderswo.error };

      // Betroffene Personen: alle Mitglieder der eigenen Reisen ausser einem
      // selbst, jede Person nur einmal gezählt, jemand kann in mehreren
      // eigenen Reisen sein. Deshalb die Zeilen holen und in JS entdoppeln
      // statt count zu nehmen: PostgREST kann kein `count(distinct …)`.
      let betroffene = 0;
      if (eigeneTripIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('trip_members')
          .select('user_id')
          .in('trip_id', eigeneTripIds)
          .neq('user_id', userId);
        if (error) return { data: null, error };
        betroffene = new Set(((data ?? []) as Array<{ user_id: string }>).map((z) => z.user_id)).size;
      }

      return {
        data: {
          eigene_reisen: eigeneTripIds.length,
          momente_in_eigenen_reisen: momenteInEigenen.anzahl,
          betroffene_personen: betroffene,
          eigene_momente_anderswo: eigeneAnderswo.anzahl,
        },
        error: null,
      };
    },

    // Die eigentliche Logik (Blockung, Kurzschluss bei Fehlern) steht in
    // loescheObjekteBlockweise oben, hier nur noch die Verdrahtung mit dem
    // real signierenden `loescheEins`, das index.ts aus den S3-Umgebungs-
    // variablen baut (erstelleS3Loescher).
    async loescheObjekte(schluessel) {
      return loescheObjekteBlockweise(schluessel, loescheEins);
    },

    // Der Avatar liegt NICHT im S3-Bucket der Momente, sondern im
    // Supabase-Storage-Bucket `avatare` (Spec 2026-08-12-profilbild-design.md).
    // Deshalb dieser Weg statt loescheObjekte/erstelleS3Loescher: derselbe
    // Admin-Client, den der Store ohnehin hält, und ein Bucket-Name als
    // Konstante, weil er lokal und produktiv gleich heisst.
    //
    // Ein bereits gelöschtes Objekt ist kein Fehler (remove() ist idempotent),
    // dieselbe Eigenschaft, auf der die Wiederholbarkeit der ganzen Löschung
    // ruht (siehe erstelleS3Loescher).
    async loescheAvatar(key: string | null): Promise<{ fehler: unknown }> {
      if (!key) return { fehler: null };
      const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([key]);
      return { fehler: error };
    },

    // Die eigenen trip_members-Zeilen in FREMDEN Reisen, und zwar im Namen
    // der Person, nicht als Service-Role. Das ist kein Stilfrage:
    //
    // Auf trip_members liegt ein Delete-Trigger
    // (rotate_invite_code_on_member_removal, 20260807090000). Er würfelt einen
    // neuen trips.invite_code, WENN die löschende Person nicht die gelöschte
    // ist, oder wenn gar kein Client-Kontext existiert, weil dann ein
    // Rauswurf nicht auszuschliessen ist. Eine Service-Role hat kein
    // auth.uid(), und GoTrue erst recht nicht. Liesse man die Kaskade beim
    // Löschen des Auth-Nutzers diese Zeilen abräumen, rotierte also der
    // Einladungscode JEDER Reise, in der die Person Mitglied war, und alle
    // anderen Eingeladenen liefen mit ihrem Link in «Diesen Einladungslink
    // gibt es nicht mehr.». Genau dieser Schaden war der Grund für jene
    // Migration.
    //
    // Ein Konto zu löschen ist inhaltlich ein freiwilliges Gehen, kein
    // Rauswurf. Mit dem JWT der Person greift die Frühausstiegs-Bedingung des
    // Triggers (auth.uid() = old.user_id), und die Links der anderen bleiben
    // gültig. Die Policy trip_members_delete erlaubt genau das
    // (`user_id = auth.uid() and role <> 'owner'`).
    //
    // Die eigenen Reisen sind ausgenommen: dort ist die Rolle 'owner', die
    // Policy verbietet es, und die Zeilen verschwinden ohnehin mit der Reise.
    async verlasseFremdeReisen(userId, eigeneTripIds) {
      let abfrage = personenClient.from('trip_members').delete().eq('user_id', userId);
      if (eigeneTripIds.length > 0) {
        abfrage = abfrage.not('trip_id', 'in', idListe(eigeneTripIds));
      }
      const { error } = await abfrage;
      return { fehler: error };
    },

    // Löst die EINZIGE on-delete-restrict-Beziehung des Schemas auf
    // (trips.owner_id → profiles.id, 20260803090600_role_hardening.sql:87-89).
    // Ohne diesen Schritt scheitert das Löschen des Auth-Nutzers mit 23503.
    // Die Kaskade räumt posts, trip_members, share_links der Reise, und über
    // die Posts auch reactions, comments und reports.
    async loescheEigeneTrips(tripIds) {
      if (tripIds.length === 0) return { fehler: null };
      const { error } = await supabaseAdmin.from('trips').delete().in('id', tripIds);
      return { fehler: error };
    },

    // Zum Schluss. Die Kaskade profiles.id → auth.users räumt das Profil, und
    // von dort aus alles, was noch auf die Person zeigt.
    async loescheAuthNutzer(userId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      return { fehler: error };
    },
  };
}
