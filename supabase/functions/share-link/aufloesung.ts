// Die reine Logik der Aktion `aufloesen` — der ZWEITE Leseweg auf Medien und
// der erste ohne jede Anmeldung. Ein Fehler hier ist kein Absturz, sondern ein
// stilles Leck.
//
// Diese Datei enthält kein I/O: kein Deno.serve, kein Netz, kein
// Supabase-Client, keine S3-Zugangsdaten. Sie folgt darin
// media-urls/lesenZugriff.ts (die Prüfkette des Mitglieder-Lesewegs) und
// reveal-trip/reveal.ts (die Entscheidungslogik des Statuswechsels). Der Grund
// steht ausführlich im Kopf von lesenZugriff.ts und ist hier bindend
// wiederholt: Ein Test mit `ignore: !stackBereit` ist auf einer Maschine ohne
// Docker von einem BESTANDENEN Test in keiner Zusammenfassung zu
// unterscheiden. Jede Zusicherung dieser Function, die sich ohne laufenden
// Stack prüfen lässt, wird deshalb hier gehalten und in aufloesung_test.ts
// belegt — der Integrationstest ist die zweite Schicht, nie die einzige.
//
// Was hier steht und darum ohne Docker prüfbar ist:
//   1. `beurteileToken` — die Prüfkette samt der Zusicherung, dass ihre vier
//      Ablehnungen BYTE-GLEICH sind (LINK_ABLEHNUNG).
//   2. `sammleMomente` — das Blättern über die PostgREST-max_rows-Grenze,
//      inklusive Doubletten-Schutz und Abbruchbedingungen.
//   3. `baueMedien` — die Ableitung der Speicherschlüssel (nie aus
//      posts.storage_key) und die Form eines einzelnen Moments.
//   4. `formeReise` / `baueAufloesungsAntwort` — die Form der Antwort, also
//      der Beleg für das, was `aufloesen` NICHT herausgibt.
//
// Was hier NICHT stehen kann und darum share_link_integration_test.ts
// zufällt: dass die SQL-Abfragen wirklich nach `trip_id` und
// `upload_status = 'uploaded'` filtern, dass die S3-Signatur trägt, und dass
// der öffentliche Aufruf ohne Authorization-Header durch das Gateway kommt.

import { erwarteteSchluessel } from '../media-urls/keys.ts';

export type TripStatus = 'active' | 'revealed' | 'archived';

// Genau die vier Spalten, an denen die Gültigkeit eines Links hängt. Absichtlich
// nicht die ganze Zeile: `created_at` spielt für die Entscheidung keine Rolle,
// und was nicht übergeben wird, kann auch nicht versehentlich in die Antwort
// geraten.
export type ShareLinkZeile = {
  token: string;
  trip_id: string;
  expires_at: string | null;
  revoked: boolean;
};

// Die Reise, wie `aufloesen` sie braucht: `status` für die Prüfkette, die
// anderen drei für die Antwort. `id`, `owner_id`, `invite_code`, `plan`,
// `revealed_at` und `cover_key` stehen bewusst NICHT darin — siehe formeReise.
export type AufloesungsTrip = {
  status: TripStatus;
  name: string;
  start_date: string;
  end_date: string;
};

export type TokenUrteil =
  | { erlaubt: true }
  | { erlaubt: false; nachricht: string; status: number };

// ---------------------------------------------------------------------------
// DIE EINE ZUSICHERUNG, AN DER ALLES HÄNGT
// ---------------------------------------------------------------------------
// Alle Ablehnungen von `aufloesen` sind DIESE eine Konstante. Nicht vier
// Objektliterale, die zufällig denselben Inhalt tragen, sondern ein einziger
// Wert, den jeder Ablehnungszweig zurückgibt.
//
// Warum das zählt: Token unbekannt, Token widerrufen, Token abgelaufen und
// Reise nicht aufgedeckt müssen für einen Aussenstehenden ununterscheidbar
// sein. Unterschiede sie irgendetwas — Text, Status-Code, ein zusätzliches
// Feld —, wäre die Function ein Orakel, an dem sich gültige von ungültigen
// Token trennen liessen: «404 mit Text A heisst, dieser Token existiert, er
// ist nur abgelaufen» ist bereits die halbe Auskunft. `aufloesung_test.ts`
// nagelt die Gleichheit auf der Ebene fest, auf der sie zählt: gleicher
// Status-Code UND gleicher serialisierter Antwort-Body.
//
// Object.freeze, weil dieser Wert an vier Stellen zurückgegeben und vom
// Aufrufer nur gelesen wird — ein versehentliches `urteil.nachricht = …` beim
// Aufrufer würde sonst alle vier Zweige gleichzeitig verändern.
//
// Der Text ist derselbe, den der öffentliche Web-Player anzeigt («Dieser Link
// funktioniert nicht mehr.», Plan Task 5 Step 3) — er verrät nicht, ob es den
// Token je gab.
export const LINK_ABLEHNUNG: { erlaubt: false; nachricht: string; status: number } = Object.freeze({
  erlaubt: false,
  nachricht: 'Dieser Link funktioniert nicht mehr.',
  status: 404,
});

// Obergrenze für den Token aus dem Anfrage-Body. Der echte Token ist 32
// Hex-Zeichen (share_links.token, default encode(gen_random_bytes(16),'hex')),
// aber die Spalte ist `text` und eine Owner-Person könnte theoretisch einen
// eigenen Wert einsetzen — eine Zeichenklasse zu erzwingen wäre also falsch.
// Eine Längengrenze ist es nicht: sie hält nur davon ab, ein Megabyte
// Zeichenkette in eine PostgREST-Query zu giessen. Wer sie reisst, bekommt
// LINK_ABLEHNUNG wie jeder unbekannte Token — kein eigener Fehlertext, sonst
// wäre die Grenze selbst wieder ein unterscheidbares Signal.
export const TOKEN_MAX_LAENGE = 512;

export function tokenLaengePlausibel(token: string): boolean {
  return token.length > 0 && token.length <= TOKEN_MAX_LAENGE;
}

// Die Prüfkette. Reihenfolge wie in Spec §5.1: Token existiert → nicht
// widerrufen → nicht abgelaufen → Reise ist 'revealed' oder 'archived'.
//
// `jetzt` wird übergeben statt intern erzeugt: eine Funktion, die `Date.now()`
// selbst aufruft, lässt sich nicht ohne Uhr-Trickserei auf den Grenzfall
// «läuft in dieser Sekunde ab» testen.
//
// `reise === null` bei vorhandener Zeile kann heute nicht auftreten
// (`share_links.trip_id` ist `not null` mit `on delete cascade`), wird aber
// abgelehnt statt durchgelassen: eine fehlende Reise ist kein Grund, Medien
// herauszugeben.
export function beurteileToken(
  zeile: ShareLinkZeile | null,
  reise: { status: TripStatus } | null,
  jetzt: Date,
): TokenUrteil {
  // 1. Token unbekannt.
  if (!zeile) return LINK_ABLEHNUNG;

  // 2. Widerrufen. Kein Löschen, sondern ein Flag (Spec §5.1) — damit ein
  //    Support-Fall beantwortbar bleibt. Nach aussen ist der Unterschied
  //    trotzdem unsichtbar.
  if (zeile.revoked) return LINK_ABLEHNUNG;

  // 3. Abgelaufen. `null` heisst «ohne Ablauf». Ein Wert, den Date.parse nicht
  //    versteht, gilt als abgelaufen und nicht als «kein Ablauf» — eine
  //    kaputte Zeitangabe darf einen Link nie unbegrenzt gültig machen.
  //    `<=` statt `<`: die Sekunde des Ablaufs gehört nicht mehr dazu.
  if (zeile.expires_at !== null) {
    const ablauf = Date.parse(zeile.expires_at);
    if (!Number.isFinite(ablauf) || ablauf <= jetzt.getTime()) return LINK_ABLEHNUNG;
  }

  // 4. Die Versiegelung, zum zweiten Mal — hier ohne jede Anmeldung, deshalb
  //    unabhängig von der Prüfkette in media-urls/lesenZugriff.ts, aber mit
  //    derselben Menge: 'revealed' und 'archived' zeigen, 'active' nicht.
  //    «Weggelegt ist nicht zugesperrt» (20260803090600_role_hardening.sql).
  //    Den Zustand «wieder versiegelt» gibt es heute nicht — die Prüfung
  //    kostet nichts (Spec §5.1, Punkt 3).
  if (!reise) return LINK_ABLEHNUNG;
  if (reise.status !== 'revealed' && reise.status !== 'archived') return LINK_ABLEHNUNG;

  return { erlaubt: true };
}

// ---------------------------------------------------------------------------
// Einsammeln der Momente — Blättern über die max_rows-Grenze
// ---------------------------------------------------------------------------
// PostgREST kappt jede Antwort bei max_rows (supabase/config.toml: 1000) —
// ohne Fehler, ohne Hinweis im Ergebnis, ohne dass supabase-js etwas davon
// merkt. media-urls hat das in Phase 5 gelernt; hier steht dasselbe Muster,
// aber als reine Funktion über einer injizierten Seiten-Abfrage, damit
// aufloesung_test.ts es OHNE Stack prüfen kann (in media-urls steckt die
// Schleife in index.ts und ist nur über den Integrationstest erreichbar).

export type MomentZeile = {
  id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
  storage_key: string;
  thumb_key: string | null;
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  // Schon aus dem PostgREST-Embed geflacht (store.ts). Der Autorenname gehört
  // in die Antwort (er steht im Recap ohnehin auf jedem Moment), die
  // author_id NIE.
  autor_name: string | null;
};

export type SeitenErgebnis = {
  zeilen: MomentZeile[];
  // Nur beim ersten Durchgang gefüllt (`mitZaehlung`), sonst null.
  anzahl: number | null;
  fehler: unknown;
};

export type HoleSeiteFn = (von: number, mitZaehlung: boolean) => Promise<SeitenErgebnis>;

export async function sammleMomente(
  holeSeite: HoleSeiteFn,
): Promise<{ zeilen: MomentZeile[]; verloren: number; fehler: unknown }> {
  const zeilen: MomentZeile[] = [];
  // Versatz-Paginierung läuft über eine Menge, die sich unter ihr bewegen
  // kann. Ein `confirm` (media-urls), das während des Blätterns einen Moment
  // mit früherem captured_at auf 'uploaded' setzt, schiebt alles danach um
  // eine Position nach hinten — die letzte Zeile der vorigen Seite erscheint
  // dann als erste der nächsten NOCH EINMAL. Die Verlust-Richtung fängt der
  // Quervergleich unten, die Doppel-Richtung nicht. Darum die Menge der schon
  // gesehenen IDs.
  const gesehen = new Set<string>();
  let abgeholt = 0;
  let gezaehlt: number | null = null;

  for (;;) {
    // Der Versatz ist immer «so viele Zeilen hat der Server schon geliefert».
    // Bewusst nicht Seitennummer × Seitengrösse: dann hinge die Richtigkeit
    // daran, dass eine volle Seite auch wirklich die erwartete Zahl Zeilen
    // bringt — also daran, dass max_rows in config.toml genau diesen Wert hat.
    // Und bewusst nicht die Zahl der BEHALTENEN Zeilen: nur die gelieferte
    // wächst garantiert bei jedem Durchgang, am behaltenen Stand gemessen
    // könnte eine Seite aus lauter Doubletten den Versatz stehen lassen — eine
    // Endlosschleife.
    const seite = await holeSeite(abgeholt, gezaehlt === null);
    if (seite.fehler) return { zeilen, verloren: 0, fehler: seite.fehler };
    if (gezaehlt === null) gezaehlt = seite.anzahl;

    abgeholt += seite.zeilen.length;
    for (const zeile of seite.zeilen) {
      if (gesehen.has(zeile.id)) continue;
      gesehen.add(zeile.id);
      zeilen.push(zeile);
    }

    // Leere Seite: mehr gibt es nicht. Diese Bedingung beendet die Schleife
    // auch dann, wenn die Zählung fehlt — und sie terminiert sicher, weil
    // jeder andere Durchgang den Versatz um mindestens eine Zeile schiebt.
    if (seite.zeilen.length === 0) break;
    // Vollzählig laut Zählung des ersten Durchgangs. Gemessen wird am
    // Gelieferten, nicht am Behaltenen — sonst liefe eine Doublette als «mir
    // fehlt noch eine» in einen Abruf, der dieselbe Doublette noch einmal
    // bringt.
    if (gezaehlt !== null && abgeholt >= gezaehlt) break;
  }

  // Kommen am Ende weniger Zeilen zusammen als die erste Seite versprochen
  // hat, ist unterwegs etwas verlorengegangen. Die Antwort geht trotzdem raus
  // (ein unvollständiger Recap ist besser als gar keiner), aber die Lücke wird
  // gezählt statt niemandem aufzufallen.
  const verloren = gezaehlt === null ? 0 : Math.max(0, gezaehlt - zeilen.length);
  return { zeilen, verloren, fehler: null };
}

// ---------------------------------------------------------------------------
// Die Form der Antwort — und damit der Beleg für das, was NICHT drinsteht
// ---------------------------------------------------------------------------

export type OeffentlicheReise = {
  name: string;
  start_date: string;
  end_date: string;
};

// Genau die zehn Felder aus dem Interface-Vertrag (Plan Task 2). thumb_url ist
// hier `string | null` und nicht optional wie in media-urls: ein Feld, das nur
// manchmal auftaucht, wird beim Bauen des Players übersehen und fehlt dann
// genau dann, wenn es gebraucht wird.
export type OeffentlicherMoment = {
  post_id: string;
  autor_name: string;
  type: 'photo' | 'video';
  captured_at: string;
  captured_tz: string;
  place_name: string | null;
  caption: string | null;
  duration_s: number | null;
  medium_url: string;
  thumb_url: string | null;
};

export type AufloesungsAntwort = {
  reise: OeffentlicheReise;
  medien: OeffentlicherMoment[];
  gueltig_bis: string;
  ausgelassen: number;
};

// Baut die drei Reise-Felder NEU, statt die gelesene Zeile durchzureichen.
// Das ist der ganze Zweck dieser Funktion: Die Trip-Zeile trägt `id`,
// `owner_id`, `invite_code`, `plan`, `revealed_at`, `cover_key` und `status`.
// `invite_code` allein wäre ein Beitritt zur Reise für jeden, der den
// öffentlichen Link hat — aus «anschauen dürfen» würde «mitmachen können».
// Ein `...zeile`-Spread oder ein durchgereichtes Objekt wäre genau der
// Fehler, den kein Reviewer beim Überfliegen sieht. aufloesung_test.ts füttert
// diese Funktion deshalb mit einer Zeile, die all diese Felder trägt, und
// prüft die Schlüsselmenge des Ergebnisses auf GENAU drei.
export function formeReise(zeile: OeffentlicheReise): OeffentlicheReise {
  return {
    name: zeile.name,
    start_date: zeile.start_date,
    end_date: zeile.end_date,
  };
}

export type SigniereFn = (key: string) => Promise<string>;

// Aus den gelesenen posts-Zeilen die öffentlichen Einträge samt signierter
// URLs. `tripId` kommt aus der share_links-ZEILE, nie aus dem Anfrage-Body —
// darin steckt Versprechen W1 («ein Share-Link zeigt nur die Reise, zu der er
// gehört»).
export async function baueMedien(
  tripId: string,
  zeilen: MomentZeile[],
  signiere: SigniereFn,
): Promise<{ medien: OeffentlicherMoment[]; ausgelassen: number }> {
  const eintraege = await Promise.all(
    zeilen.map(async (zeile): Promise<OeffentlicherMoment | null> => {
      // Der signierte Pfad wird abgeleitet (media-urls/keys.ts), nicht aus
      // storage_key übernommen. Begründung ausführlich in
      // media-urls/index.ts: storage_key ist der EINZIGE Bestandteil des
      // Pfades, den je ein Client geschrieben hat. Für den ÖFFENTLICHEN
      // Leseweg wiegt das schwerer als für den Mitglieder-Leseweg, denn hier
      // steht kein JWT und keine Mitgliedschaft mehr dazwischen.
      const abgeleitet = erwarteteSchluessel(tripId, zeile.id, zeile.type, zeile.media_ext);

      // Weicht der gespeicherte Pfad von der Ableitung ab, fällt der Eintrag
      // heraus. Zwei Dinge können das auslösen, und für beide ist Auslassen
      // die richtige Antwort: eine untergeschobene Zeile (die darf erst recht
      // keine öffentliche URL bekommen) oder eine Zeile aus einem anderen
      // Schlüsselschema (dann liegen die Bytes woanders, und die abgeleitete
      // URL zeigte ins Nichts).
      if (zeile.storage_key !== abgeleitet.storage_key) {
        console.error(
          'share-link: storage_key weicht vom abgeleiteten Pfad ab, Moment wird ausgelassen.',
          { post_id: zeile.id, gespeichert: zeile.storage_key, abgeleitet: abgeleitet.storage_key },
        );
        return null;
      }

      return {
        post_id: zeile.id,
        // display_name ist in profiles `not null` und author_id eine
        // Pflicht-Fremdschlüsselspalte — der Fall tritt nicht ein. Ein
        // fehlender Name darf trotzdem nie zu `null` oder `undefined` im
        // Vertrag führen.
        autor_name: zeile.autor_name ?? '',
        type: zeile.type,
        captured_at: zeile.captured_at,
        captured_tz: zeile.captured_tz,
        place_name: zeile.place_name,
        caption: zeile.caption,
        duration_s: zeile.duration_s,
        medium_url: await signiere(abgeleitet.storage_key),
        // thumb_key ist nullable und wird nur als Ja/Nein gelesen. Ohne diese
        // Abfrage entstünde bei null eine Signatur auf den Pfad ".../null" —
        // eine gültige URL auf ein Objekt, das es nicht gibt. Der Pfad kommt
        // auch hier aus der Ableitung: ein Thumbnail ist der Inhalt eines
        // Moments in klein, für die Versiegelung also nichts Geringeres als
        // das Medium selbst.
        thumb_url: zeile.thumb_key ? await signiere(abgeleitet.thumb_key) : null,
      };
    }),
  );

  const medien = eintraege.filter((e): e is OeffentlicherMoment => e !== null);
  return { medien, ausgelassen: eintraege.length - medien.length };
}

// Die vollständige Antwort. Eigene Funktion statt eines Objektliterals in
// index.ts, damit aufloesung_test.ts die Schlüsselmenge der GANZEN Antwort
// festnageln kann und nicht nur die ihrer Teile.
//
// `ausgelassen` ist rein additiv (dieselbe Zahl und derselbe Grund wie in
// media-urls/lesen): Das Aussortieren oben und ein Verlust beim Blättern sind
// gegenüber dem Player sonst genauso still, wie ein blosser Log-Alarm
// gegenüber dem Betrieb still wäre. Es steht immer da, auch als 0.
export function baueAufloesungsAntwort(
  reise: OeffentlicheReise,
  medien: OeffentlicherMoment[],
  gueltigBis: string,
  ausgelassen: number,
): AufloesungsAntwort {
  return {
    reise: formeReise(reise),
    medien,
    gueltig_bis: gueltigBis,
    ausgelassen,
  };
}
