// Der reale I/O-Adapter für konto-loeschen — dieselbe Rollenteilung wie
// share-link/store.ts gegenüber aufloesung.ts und reveal-trip/revealStore.ts
// gegenüber reveal.ts: ablauf.ts bleibt reine Logik ohne Supabase-Import, hier
// stehen genau die Abfragen, die kein Unit-Test ersetzen kann und die deshalb
// konto_loeschen_integration_test.ts gegen den echten Stack prüft.
//
// Die vier, auf die es ankommt:
//   - `verlasseFremdeReisen` läuft mit dem JWT DER PERSON, nicht mit
//     Service-Role. Der Grund steht dort und ist kein Detail.
//   - `loescheEigeneTrips` löst die einzige on-delete-restrict-Beziehung des
//     Schemas auf und stösst damit die grösste Kaskade an.
//   - `loescheObjekte` blockweise, mit der (nachgemessenen) Eigenschaft, dass
//     ein bereits gelöschter Schlüssel KEIN Fehler ist.
//   - die Zählabfragen für den Dialog: sie müssen die Wahrheit sagen.
import { createClient } from 'jsr:@supabase/supabase-js@2';
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

// Blockgrösse beim Löschen im Speicher. Die Storage-API nimmt eine Liste von
// Pfaden entgegen; sehr lange Listen gehören trotzdem geteilt, damit ein
// einzelner Aufruf nicht in ein Zeitlimit läuft und der Fortschritt zwischen
// den Blöcken erhalten bleibt (ein zweiter Versuch überspringt dann, was schon
// weg ist — siehe loescheObjekte).
export const OBJEKT_BLOCKGROESSE = 200;

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
  verlasseFremdeReisen(userId: string, eigeneTripIds: string[]): Promise<{ fehler: unknown }>;
  loescheEigeneTrips(tripIds: string[]): Promise<{ fehler: unknown }>;
  loescheAuthNutzer(userId: string): Promise<{ fehler: unknown }>;
}

// PostgREST-`in`-Filter brauchen eine Liste in Klammern. Bei leerer Liste wäre
// `in.()` ein Syntaxfehler — die Aufrufer prüfen deshalb vorher auf leer, und
// diese Hilfsfunktion existiert nur, damit die Quotierung an einer Stelle
// steht. UUIDs enthalten keine Kommas oder Anführungszeichen; die Werte kommen
// ausserdem ausschliesslich aus der Datenbank, nie aus dem Anfrage-Body.
function idListe(ids: string[]): string {
  return `(${ids.join(',')})`;
}

export function erstelleKontoStore(
  supabaseAdmin: AdminClient,
  personenClient: AdminClient,
  bucket: string,
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

    // ALLE Momente der eigenen Reisen — auch die von Mitreisenden. Die Reise
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
    // weg ist — ihre Objekte aber nur, wenn sie hier eingesammelt werden.
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
    // eigene Reisen hat, löscht sie mit — samt der Momente ALLER Mitglieder.
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
      // selbst, jede Person nur einmal gezählt — jemand kann in mehreren
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

    // Blockweise. Wichtig und nachgemessen: Ein Schlüssel, unter dem kein
    // Objekt (mehr) liegt, ist KEIN Fehler — die Storage-API antwortet mit 200
    // und lässt ihn schlicht aus der Ergebnisliste weg. Daraus folgt zweierlei:
    //   1. Ein zweiter Löschversuch nach einem Teilabbruch läuft sauber durch.
    //      Genau darauf stützt sich ablauf.ts, wenn es bei einem Fehler im
    //      Speicherschritt lieber gar nichts in der Datenbank anfasst.
    //   2. «Weniger zurückbekommen als angefragt» darf NICHT als Fehlschlag
    //      gewertet werden — sonst schlüge jede Wiederholung fehl. Der einzige
    //      verlässliche Anzeiger ist das error-Feld.
    async loescheObjekte(schluessel) {
      for (let i = 0; i < schluessel.length; i += OBJEKT_BLOCKGROESSE) {
        const block = schluessel.slice(i, i + OBJEKT_BLOCKGROESSE);
        const { error } = await supabaseAdmin.storage.from(bucket).remove(block);
        if (error) return { fehler: error };
      }
      return { fehler: null };
    },

    // Die eigenen trip_members-Zeilen in FREMDEN Reisen — und zwar im Namen
    // der Person, nicht als Service-Role. Das ist kein Stilfrage:
    //
    // Auf trip_members liegt ein Delete-Trigger
    // (rotate_invite_code_on_member_removal, 20260807090000). Er würfelt einen
    // neuen trips.invite_code, WENN die löschende Person nicht die gelöschte
    // ist — oder wenn gar kein Client-Kontext existiert, weil dann ein
    // Rauswurf nicht auszuschliessen ist. Eine Service-Role hat kein
    // auth.uid(), und GoTrue erst recht nicht. Liesse man die Kaskade beim
    // Löschen des Auth-Nutzers diese Zeilen abräumen, rotierte also der
    // Einladungscode JEDER Reise, in der die Person Mitglied war — und alle
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
