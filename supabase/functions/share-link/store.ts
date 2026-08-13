// Der reale I/O-Adapter für share-link, dieselbe Rollenteilung wie
// reveal-trip/revealStore.ts gegenüber reveal.ts: aufloesung.ts bleibt reine
// Logik ohne Supabase-Import, hier stehen genau die Abfragen, die kein
// Unit-Test ersetzen kann und die deshalb der Integrationstest gegen den
// echten Stack prüft:
//
//   - die EINE Abfrage, die Token-Zeile UND Reise zusammen holt (siehe
//     holeTokenMitReise, der Grund ist nicht Bequemlichkeit, sondern
//     Zeitverhalten)
//   - `.eq('trip_id', …)` und `.eq('upload_status', 'uploaded')` beim
//     Einsammeln der Momente (W1 und «nur fertige Uploads»)
//   - die Sortierung nach captured_at, id (Global Constraint)
//   - der Embed auf profiles für Autorenname UND Bild-Schlüssel (seit
//     Task 10: display_name, avatar_key). Die author_id steht in keiner
//     Select-Liste — geheim ist sie damit trotzdem nicht mehr, sie steckt im
//     avatar_key. Begründung an der Abfrage selbst (holeMomenteSeite, Punkt 4)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { AufloesungsTrip, MomentZeile, SeitenErgebnis, ShareLinkZeile, TripStatus } from './aufloesung.ts';

// Fabrik statt eines direkten `createClient(...)`-Aufrufs: nur so lässt sich
// der Rückgabetyp sauber benennen. `ReturnType<typeof createClient>` allein
// inferiert an dieser Stelle einen ANDEREN Typ als der tatsächliche Aufruf
// `createClient(url, key)`, createClient hat interdependente generische
// Default-Typparameter (ausführlich in reveal-trip/revealStore.ts).
export function erstelleAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey);
}
export type AdminClient = ReturnType<typeof erstelleAdminClient>;

// Seitengrösse beim Einsammeln der Momente. Orientiert an max_rows aus
// supabase/config.toml (1000): grösser hat keine Wirkung, weil PostgREST dort
// ohnehin kappt, kleiner kostet nur Round-Trips. Die Richtigkeit der Schleife
// in sammleMomente hängt NICHT daran, dass die beiden Zahlen gleich sind.
export const POSTS_SEITENGROESSE = 1000;

// `name` seit der Teilen-Benachrichtigung mit dabei: der Push-Text nennt die
// Reise («… euren Recap von «Lissabon» geteilt»), und ihn nachträglich aus
// einer zweiten Abfrage zu holen hiesse, denselben Datensatz zweimal zu laden.
export type TripFuerErstellen = { id: string; owner_id: string; status: TripStatus; name: string };
export type TokenBesitzer = { token: string; trip_id: string; owner_id: string; name: string };

export interface ShareStore {
  // Token-Zeile und Reise in EINER Abfrage.
  holeTokenMitReise(
    token: string,
  ): Promise<{ zeile: ShareLinkZeile | null; reise: AufloesungsTrip | null; fehler: unknown }>;

  holeMomenteSeite(tripId: string, von: number, mitZaehlung: boolean): Promise<SeitenErgebnis>;

  holeTripFuerErstellen(tripId: string): Promise<{ data: TripFuerErstellen | null; error: unknown }>;

  legeLinkAn(tripId: string, expiresAt: string | null): Promise<{ token: string | null; error: unknown }>;

  holeTokenBesitzer(token: string): Promise<{ data: TokenBesitzer | null; error: unknown }>;

  widerrufeLink(token: string): Promise<{ error: unknown }>;

  // Die drei Wege der Teilen-Benachrichtigung (benachrichtigung.ts), wortgleich
  // zu denen des Reveal-Stores: dieselbe Tabelle, dieselbe Einschränkung, und
  // beim Löschen dieselbe zusätzliche Begrenzung auf den angeschriebenen Kreis.
  holeMitglieder(tripId: string): Promise<{ data: { user_id: string }[] | null; error: unknown }>;

  holeTokens(userIds: string[]): Promise<{ data: { token: string }[] | null; error: unknown }>;

  loescheTokens(tokens: string[], userIds: string[]): Promise<{ error: unknown }>;

  // Der Anzeigename der Owner-Person fuer den Text der Meldung. Ein Fehler
  // hier kostet nur den Namen, nicht die Meldung (siehe versendeTeilenPush).
  holeAnzeigename(userId: string): Promise<{ data: string | null; error: unknown }>;
}

// Rohform des PostgREST-Embeds: `trips(...)` kommt als eingebettetes Objekt
// (many-to-one über share_links.trip_id) zurück, in seltenen Fällen als
// null-Objekt. supabase-js kennt ohne generierte Datenbank-Typen die Form
// nicht, darum hier einmal benannt und einmal gecastet, statt an fünf Stellen
// `any` zu verteilen.
type ShareLinkMitTrip = {
  token: string;
  trip_id: string;
  expires_at: string | null;
  revoked: boolean;
  trips: { status: TripStatus; name: string; start_date: string; end_date: string } | null;
};

type PostMitProfil = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  // double precision in Postgres (20260803090100_content_tables.sql), also
  // number in JSON, und nullable, weil ein Moment ohne Ortsfreigabe der
  // Normalfall ist.
  lat: number | null;
  lng: number | null;
  caption: string | null;
  duration_s: number | null;
  // avatar_key seit Task 10 mit im Embed: derselbe Join, der schon
  // display_name holt, kostet damit keinen zusätzlichen Round-Trip. Nullable,
  // weil ein Profil ohne Bild der Normalfall ist (Avatar() zeichnet dann die
  // Initiale, siehe mobile/src/components/Avatar.tsx).
  profiles: { display_name: string; avatar_key: string | null } | null;
};

export function erstelleShareStore(supabaseAdmin: AdminClient): ShareStore {
  return {
    // EINE Abfrage für Token und Reise, nicht zwei nacheinander, und das ist
    // kein Feinschliff, sondern gehört zur Zusicherung der byte-gleichen
    // Ablehnungen.
    //
    // Mit zwei Abfragen bräuchte ein unbekannter Token EINEN Round-Trip zur
    // Datenbank und ein gültiger Token ZWEI. Die vier Ablehnungen wären dann
    // zwar byte-gleich im Inhalt, aber messbar verschieden in der Zeit: «Token
    // unbekannt» käme systematisch schneller zurück als «Reise nicht
    // aufgedeckt». Genau davor warnt Spec §5.1 ausdrücklich («mit demselben
    // Text und derselben Antwortzeit»). Mit dem Embed führt Postgres beides in
    // EINEM Statement aus (LATERAL Join); alle vier Ablehnungswege bestehen
    // aus genau einem Datenbank-Round-Trip und einer Rückgabe.
    //
    // Was dadurch NICHT verschwindet, ehrlichkeitshalber: der Index-Lookup auf
    // dem Primärschlüssel unterscheidet sich zwischen Treffer und Fehlschlag
    // um Bruchteile einer Mikrosekunde, und ein Treffer zieht zusätzlich die
    // Trip-Zeile. Das liegt weit unter dem Rauschen einer HTTP-Runde über das
    // Netz. Ausbeutbar wäre es nur mit sehr vielen Messungen pro Kandidat,
    // und der Kandidatenraum sind 2^128 Token.
    async holeTokenMitReise(token) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .select('token, trip_id, expires_at, revoked, trips(status, name, start_date, end_date)')
        .eq('token', token)
        .maybeSingle();

      if (error) return { zeile: null, reise: null, fehler: error };

      const roh = data as unknown as ShareLinkMitTrip | null;
      if (!roh) return { zeile: null, reise: null, fehler: null };

      // Die Trip-Felder werden hier von der Token-Zeile GETRENNT, damit
      // beurteileToken die Reise als eigenes Argument bekommt und keine der
      // beiden Zeilen als Ganzes weiterreicht.
      const zeile: ShareLinkZeile = {
        token: roh.token,
        trip_id: roh.trip_id,
        expires_at: roh.expires_at,
        revoked: roh.revoked,
      };
      const reise: AufloesungsTrip | null = roh.trips
        ? {
          status: roh.trips.status,
          name: roh.trips.name,
          start_date: roh.trips.start_date,
          end_date: roh.trips.end_date,
        }
        : null;
      return { zeile, reise, fehler: null };
    },

    // Eine Seite Momente. Die Schleife darüber steht in
    // aufloesung.ts/sammleMomente (reine Logik, ohne Stack testbar); hier
    // stehen nur die vier Bestandteile, die wirklich an Postgres hängen:
    //
    //   1. `.eq('trip_id', tripId)`, die trip_id stammt aus der
    //      share_links-Zeile. Ohne diese Einschränkung liefe die Abfrage über
    //      die ganze posts-Tabelle, und der Ableitungs-Abgleich in baueMedien
    //      wäre die einzige verbleibende Schranke (W1).
    //   2. `.eq('upload_status', 'uploaded')`, ein Moment mit 'pending' hat
    //      kein vollständiges Objekt im Speicher, eine URL darauf wäre ein 404
    //      in der Filmrolle.
    //   3. captured_at aufsteigend, id als zweites Kriterium (Global
    //      Constraint: nie nach created_at, nie nach Upload-Zeit).
    //   4. der Embed `profiles!posts_author_id_fkey(display_name, avatar_key)`
    //      (avatar_key seit Task 10 dazu, derselbe Join, kein zweiter
    //      Round-Trip). Die Disambiguierung ist nötig, weil PostgREST zwischen
    //      posts und profiles ZWEI Beziehungen findet (die Fremdschlüsselspalte
    //      author_id und den many-to-many-Weg über reactions) und sonst mit
    //      PGRST201 abbricht. Geholt werden ausschliesslich display_name und
    //      avatar_key — author_id steht zwar in keiner Select-Liste dieser
    //      Datei, ZURÜCKGEHALTEN wird sie seit dem Profilbild-Feature
    //      (2026-08-12) aber nicht mehr: `avatar_key` lautet
    //      `profiles/<author_id>/<32 hex>.jpg` und trägt die Auth-UUID der
    //      Autorin damit in die anonyme Antwort, sobald sie ein Bild hat.
    //      Bewusst akzeptiert (siehe Nachtrag in
    //      docs/superpowers/specs/2026-08-08-phase-6-teilen-export-store-design.md
    //      §5.1): die UUID gewährt für sich keinen Zugriff — profiles-RLS
    //      verlangt gemeinsame Mitgliedschaft, `select` auf storage.objects
    //      verlangt authenticated, und kein anonymer Endpunkt nimmt eine rohe
    //      uid entgegen. Ablesbar ist einzig, dass zwei geteilte Recaps
    //      dieselbe Autorin haben; ihren Namen zeigt die Antwort ohnehin.
    async holeMomenteSeite(tripId, von, mitZaehlung) {
      const { data, error, count } = await supabaseAdmin
        .from('posts')
        .select(
          'id, type, media_ext, storage_key, thumb_key, captured_at, captured_tz, place_name, lat, lng, caption, duration_s, profiles!posts_author_id_fkey(display_name, avatar_key)',
          mitZaehlung ? { count: 'exact' } : undefined,
        )
        .eq('trip_id', tripId)
        .eq('upload_status', 'uploaded')
        .order('captured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(von, von + POSTS_SEITENGROESSE - 1);

      if (error) return { zeilen: [], anzahl: null, fehler: error };

      const roh = (data ?? []) as unknown as PostMitProfil[];
      const zeilen: MomentZeile[] = roh.map((z) => ({
        id: z.id,
        type: z.type,
        media_ext: z.media_ext,
        storage_key: z.storage_key,
        thumb_key: z.thumb_key,
        captured_at: z.captured_at,
        captured_tz: z.captured_tz,
        place_name: z.place_name,
        lat: z.lat,
        lng: z.lng,
        caption: z.caption,
        duration_s: z.duration_s,
        autor_name: z.profiles?.display_name ?? null,
        // Analog zu autor_name: `?.` statt eines Absturzes für den (heute
        // theoretischen) Fall eines fehlenden Profils, `?? null` für den
        // ECHTEN Normalfall «Profil da, aber ohne Bild».
        autor_avatar_key: z.profiles?.avatar_key ?? null,
      }));
      return { zeilen, anzahl: mitZaehlung ? (count ?? null) : null, fehler: null };
    },

    // `erstellen` prüft Eigentümerschaft und Status selbst, weil die
    // Service-Role an RLS vorbeischreibt und share_links_insert_owner damit
    // gar nicht ausgewertet wird.
    async holeTripFuerErstellen(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trips')
        .select('id, owner_id, status, name')
        .eq('id', tripId)
        .maybeSingle();
      return { data: data as TripFuerErstellen | null, error };
    },

    // token wird NICHT mitgegeben: der Default der Spalte
    // (encode(gen_random_bytes(16), 'hex'), 20260803090100_content_tables.sql)
    // erzeugt ihn in der Datenbank. Ein in der Function erzeugter Token wäre
    // eine zweite Quelle für dieselbe Sache, und der Zufall käme dann aus dem
    // Edge-Runtime statt aus pgcrypto.
    async legeLinkAn(tripId, expiresAt) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .insert({ trip_id: tripId, expires_at: expiresAt })
        .select('token')
        .maybeSingle();
      const zeile = data as { token: string } | null;
      return { token: zeile?.token ?? null, error };
    },

    // Für `widerrufen`: Token-Zeile plus Eigentümerschaft der zugehörigen
    // Reise, wieder in einer Abfrage. Der Grund ist hier ein anderer als bei
    // holeTokenMitReise (nicht Zeitverhalten, sondern schlicht weniger
    // Round-Trips), das Muster dasselbe.
    async holeTokenBesitzer(token) {
      const { data, error } = await supabaseAdmin
        .from('share_links')
        .select('token, trip_id, trips(owner_id, name)')
        .eq('token', token)
        .maybeSingle();
      if (error) return { data: null, error };
      const roh = data as unknown as
        | { token: string; trip_id: string; trips: { owner_id: string; name: string } | null }
        | null;
      if (!roh || !roh.trips) return { data: null, error: null };
      return {
        data: {
          token: roh.token,
          trip_id: roh.trip_id,
          owner_id: roh.trips.owner_id,
          name: roh.trips.name,
        },
        error: null,
      };
    },

    // Bewusst kein Löschen: ein widerrufener Link bleibt unterscheidbar von
    // einem, den es nie gab, damit ein Support-Fall beantwortbar ist (Spec
    // §5.1). Nach aussen zeigen beide dasselbe.
    //
    // Kein Status-Kriterium: ein Widerruf macht einen Link schwächer, nie
    // stärker, und muss darum auf einer archivierten Reise genauso gehen wie
    // auf einer aufgedeckten. Für die Service-Role greift RLS ohnehin nicht;
    // die entsprechende Lockerung für den direkten Client-Weg steht in
    // supabase/migrations/20260808130000_share_links_widerruf_archiviert.sql.
    async widerrufeLink(token) {
      const { error } = await supabaseAdmin
        .from('share_links')
        .update({ revoked: true })
        .eq('token', token);
      return { error };
    },

    // Wortgleich zu erstelleRevealStore (reveal-trip/revealStore.ts): ALLE
    // Mitglieder, einschliesslich der ausloesenden Person. Der Ausschluss
    // passiert in `empfaengerKreis` als reine Filterung, damit ein Test ohne
    // Docker ihn erreicht.
    async holeMitglieder(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', tripId);
      return { data: data as { user_id: string }[] | null, error };
    },

    async holeTokens(userIds) {
      const { data, error } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .in('user_id', userIds);
      return { data: data as { token: string }[] | null, error };
    },

    // userIds zusaetzlich zu tokens, dieselbe Begrenzung und derselbe Grund
    // wie im Reveal-Store: die Ticket-zu-Token-Zuordnung ist positionsbasiert,
    // ein versetzter Block duerfte nie ausserhalb des angeschriebenen Kreises
    // loeschen.
    async loescheTokens(tokens, userIds) {
      const { error } = await supabaseAdmin
        .from('push_tokens')
        .delete()
        .in('token', tokens)
        .in('user_id', userIds);
      return { error };
    },

    async holeAnzeigename(userId) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      const zeile = data as { display_name: string } | null;
      return { data: zeile?.display_name ?? null, error };
    },
  };
}
