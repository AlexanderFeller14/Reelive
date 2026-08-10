// Unit-Tests für die reine Logik von `aufloesen`, sie laufen OHNE
// `supabase start` und OHNE ein zweites Terminal mit `functions serve`, im
// Gegensatz zu share_link_integration_test.ts (das echte HTTP-Aufrufe braucht
// und darum `ignore: !stackBereit` trägt).
//
// Das ist die bindende Lehre aus Phase 5: Ein übersprungener Test ist von
// einem bestandenen in keiner Zusammenfassung zu unterscheiden. Keine
// Zusicherung dieser Function darf ausschliesslich in einer Datei stehen, die
// sich ohne Docker selbst überspringt.
//
// Ausführen (braucht keine Berechtigung, kein Netz, keinen Stack):
//   cd supabase/functions/share-link
//   npx deno test aufloesung_test.ts
//
// Belegt:
//   1. Die VIER Ablehnungen von beurteileToken sind byte-gleich, Status-Code
//      UND serialisierter Antwort-Body. Dazu die fünfte Ablehnung (Token zu
//      lang), die index.ts aus derselben Konstante bildet.
//   2. Die Reihenfolge der Prüfkette und ihre Grenzfälle (Ablauf auf die
//      Sekunde, kaputtes Ablaufdatum, 'archived' bleibt lesbar).
//   3. Das Blättern über die max_rows-Grenze: nichts verloren, nichts
//      doppelt, keine Endlosschleife.
//   4. Die Schlüssel werden ABGELEITET, nie aus storage_key übernommen, und
//      eine Zeile, deren storage_key woanders hinzeigt, fällt heraus.
//   5. Die Antwort trägt GENAU die Felder des Vertrags. Reaktionen,
//      Kommentare, Mitglieder, invite_code und author_id sind nicht dabei,
//      auch dann nicht, wenn sie in den Eingabezeilen stehen.
//   6. Seit Phase 7 gehören lat/lng dazu (Spec R4): sie gehen unverändert
//      durch, `null` bleibt `null`, und ein Moment ohne Ort verschwindet
//      nicht. Dass sie NUR hinter einem bestandenen Urteil herausgehen,
//      hängt an Punkt 1, deshalb steht dort die Aussage dazu.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  type AufloesungsTrip,
  baueAufloesungsAntwort,
  baueMedien,
  beurteileToken,
  LINK_ABLEHNUNG,
  type MomentZeile,
  type SeitenErgebnis,
  formeReise,
  sammleMomente,
  type ShareLinkZeile,
  TOKEN_MAX_LAENGE,
  type TokenUrteil,
  tokenLaengePlausibel,
} from './aufloesung.ts';
import { erwarteteSchluessel } from '../media-urls/keys.ts';

const TRIP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const JETZT = new Date('2026-08-08T12:00:00.000Z');

function gueltigeZeile(ueberschreibe: Partial<ShareLinkZeile> = {}): ShareLinkZeile {
  return {
    token: '7f3c1a9e2b4d6058a1c3e5f70921b8d4',
    trip_id: TRIP_ID,
    expires_at: null,
    revoked: false,
    ...ueberschreibe,
  };
}

const REVEALED: AufloesungsTrip = {
  status: 'revealed',
  name: 'Lissabon Städtetrip',
  start_date: '2026-05-08',
  end_date: '2026-05-12',
};

// Genau das, was der Aufrufer aus einem Urteil macht: Status-Code und Body.
// Auf DIESER Ebene muss die Gleichheit gelten, nicht auf der eines
// TypeScript-Objekts, was zurückgeht, sind Bytes.
function alsHttpAntwort(urteil: TokenUrteil): string {
  if (urteil.erlaubt) return 'ERLAUBT';
  return `${urteil.status} ${JSON.stringify({ fehler: urteil.nachricht })}`;
}

// ===========================================================================
// 1. Die eine Zusicherung, an der alles hängt
// ===========================================================================

Deno.test('aufloesen: die vier Ablehnungen sind byte-gleich, Status und Body', () => {
  const faelle: Array<[string, TokenUrteil]> = [
    // a) Token unbekannt
    ['Token unbekannt', beurteileToken(null, null, JETZT)],
    // b) Token widerrufen
    ['Token widerrufen', beurteileToken(gueltigeZeile({ revoked: true }), REVEALED, JETZT)],
    // c) Token abgelaufen
    [
      'Token abgelaufen',
      beurteileToken(gueltigeZeile({ expires_at: '2026-08-08T11:59:59.000Z' }), REVEALED, JETZT),
    ],
    // d) Reise nicht aufgedeckt
    ['Reise nicht aufgedeckt', beurteileToken(gueltigeZeile(), { ...REVEALED, status: 'active' }, JETZT)],
  ];

  // Erst gegen den erwarteten Wortlaut, sonst wären vier gleich falsche
  // Antworten ebenfalls "gleich".
  const erwartet = `404 ${JSON.stringify({ fehler: 'Dieser Link funktioniert nicht mehr.' })}`;
  for (const [name, urteil] of faelle) {
    assertEquals(alsHttpAntwort(urteil), erwartet, `${name} weicht ab`);
  }

  // Und dann paarweise gegeneinander: was hier zusammenfällt, kann kein
  // Orakel mehr sein.
  for (const [nameA, a] of faelle) {
    for (const [nameB, b] of faelle) {
      assertEquals(alsHttpAntwort(a), alsHttpAntwort(b), `${nameA} unterscheidet sich von ${nameB}`);
    }
  }
});

Deno.test('aufloesen: ein zu langer Token bekommt dieselbe Ablehnung wie ein unbekannter', () => {
  // index.ts bildet diesen Fall aus derselben Konstante, statt einen eigenen
  // Text zu erfinden, sonst wäre die Längengrenze selbst ein Signal
  // ("dieser Token hat wenigstens die richtige Form").
  assertFalse(tokenLaengePlausibel('x'.repeat(TOKEN_MAX_LAENGE + 1)));
  assert(tokenLaengePlausibel('x'.repeat(TOKEN_MAX_LAENGE)));
  assertFalse(tokenLaengePlausibel(''));

  assertEquals(
    alsHttpAntwort(LINK_ABLEHNUNG),
    alsHttpAntwort(beurteileToken(null, null, JETZT)),
  );
});

Deno.test('aufloesen: die Ablehnung lässt sich vom Aufrufer nicht verändern', () => {
  // Alle vier Zweige geben DENSELBEN Wert zurück. Wäre er veränderbar, würde
  // ein einziges versehentliches `urteil.nachricht = …` beim Aufrufer alle
  // vier gleichzeitig umschreiben.
  const urteil = beurteileToken(null, null, JETZT);
  assertFalse(urteil.erlaubt);
  try {
    (urteil as { nachricht: string }).nachricht = 'Token existiert nicht.';
  } catch {
    // Im strict mode wirft die Zuweisung, beides ist recht, solange der Wert
    // danach unverändert ist.
  }
  assertEquals(
    alsHttpAntwort(beurteileToken(null, null, JETZT)),
    `404 ${JSON.stringify({ fehler: 'Dieser Link funktioniert nicht mehr.' })}`,
  );
});

// ===========================================================================
// 2. Prüfkette und Grenzfälle
// ===========================================================================

Deno.test('aufloesen: gültiger Token auf einer aufgedeckten Reise wird zugelassen', () => {
  assertEquals(beurteileToken(gueltigeZeile(), REVEALED, JETZT), { erlaubt: true });
});

Deno.test('aufloesen: archivierte Reise bleibt lesbar, weggelegt ist nicht zugesperrt', () => {
  assertEquals(
    beurteileToken(gueltigeZeile(), { ...REVEALED, status: 'archived' }, JETZT),
    { erlaubt: true },
  );
});

Deno.test('aufloesen: expires_at in der Zukunft ist gültig, auf die Sekunde genau nicht mehr', () => {
  assertEquals(
    beurteileToken(gueltigeZeile({ expires_at: '2026-08-08T12:00:00.001Z' }), REVEALED, JETZT),
    { erlaubt: true },
  );
  // Der Zeitpunkt des Ablaufs gehört nicht mehr dazu.
  assertFalse(
    beurteileToken(gueltigeZeile({ expires_at: '2026-08-08T12:00:00.000Z' }), REVEALED, JETZT).erlaubt,
  );
});

Deno.test('aufloesen: ein unlesbares Ablaufdatum gilt als abgelaufen, nicht als "ohne Ablauf"', () => {
  // Die gefährliche Verwechslung: Ein Wert, den Date.parse nicht versteht,
  // ergibt NaN. Jeder Vergleich mit NaN ist false, eine naive Prüfung
  // (`ablauf <= jetzt`) liesse den Link damit unbegrenzt gültig sein.
  assertEquals(
    alsHttpAntwort(beurteileToken(gueltigeZeile({ expires_at: 'irgendwann' }), REVEALED, JETZT)),
    alsHttpAntwort(LINK_ABLEHNUNG),
  );
});

Deno.test('aufloesen: ein widerrufener Token bleibt abgelehnt, auch ohne Ablaufdatum und auf einer offenen Reise', () => {
  // Die Reihenfolge zählt: revoked wird VOR dem Ablauf und VOR dem
  // Reise-Status geprüft, damit ein Widerruf nie von einer anderen Bedingung
  // abhängt.
  assertFalse(beurteileToken(gueltigeZeile({ revoked: true, expires_at: null }), REVEALED, JETZT).erlaubt);
});

Deno.test('aufloesen: eine Token-Zeile ohne Reise wird abgelehnt statt durchgelassen', () => {
  // Kann heute nicht auftreten (trip_id ist not null mit on delete cascade),
  // eine fehlende Reise ist trotzdem kein Grund, Medien herauszugeben.
  assertEquals(alsHttpAntwort(beurteileToken(gueltigeZeile(), null, JETZT)), alsHttpAntwort(LINK_ABLEHNUNG));
});

Deno.test('aufloesen: ein widerrufener Link kommt nie bis zu den Koordinaten', () => {
  // K15. Prüft keine neue Logik, sondern nagelt die REIHENFOLGE fest: seit
  // Phase 7 tragen die Momente lat/lng (Spec R4), und dies ist der einzige
  // Weg, auf dem Koordinaten an Menschen ohne Konto gelangen. baueMedien,
  // und damit jede Koordinate, läuft erst, wenn dieses Urteil `erlaubt`
  // sagt; ein negatives Urteil lässt in index.ts gar keinen Pfad zur Abfrage
  // der Momente offen. Widerruf ist der Fall, der zählt: er trifft einen
  // Link, der die Koordinaten gestern noch zeigen DURFTE.
  const urteil = beurteileToken(gueltigeZeile({ revoked: true }), REVEALED, JETZT);
  assertEquals(urteil.erlaubt, false);
  // Und die Ablehnung bleibt die eine byte-gleiche: dass der Link einmal galt,
  // steht nicht in der Antwort.
  assertEquals(alsHttpAntwort(urteil), alsHttpAntwort(LINK_ABLEHNUNG));
});

// ===========================================================================
// 3. Blättern über die max_rows-Grenze
// ===========================================================================

function momentZeile(id: string, ueberschreibe: Partial<MomentZeile> = {}): MomentZeile {
  return {
    id,
    type: 'photo',
    media_ext: 'jpg',
    storage_key: erwarteteSchluessel(TRIP_ID, id, 'photo', 'jpg').storage_key,
    thumb_key: erwarteteSchluessel(TRIP_ID, id, 'photo', 'jpg').thumb_key,
    captured_at: '2026-05-08T08:00:00Z',
    captured_tz: 'Europe/Lisbon',
    place_name: 'Lissabon',
    // Ohne Ort ist die Grundstellung, nicht der Ausnahmefall: ortBestimmen()
    // liefert bewusst null, wenn die Ortungsdienste nicht erlaubt sind,
    // drinnen kein Fix zustande kommt oder die Frist abläuft. Wer Koordinaten
    // braucht, setzt sie in seinem Testfall ausdrücklich.
    lat: null,
    lng: null,
    caption: null,
    duration_s: null,
    autor_name: 'Mira',
    ...ueberschreibe,
  };
}

// Ein Server, der wie PostgREST bei einer Obergrenze kappt, ohne Fehler,
// ohne Hinweis. Genau die Eigenschaft, an der ein einzelner Select
// stillschweigend scheitert.
function kappenderServer(anzahl: number, seitengroesse: number) {
  const alle = Array.from({ length: anzahl }, (_, i) => momentZeile(`post-${String(i).padStart(4, '0')}`));
  let abrufe = 0;
  return {
    alle,
    get abrufe() {
      return abrufe;
    },
    holeSeite(von: number, mitZaehlung: boolean): Promise<SeitenErgebnis> {
      abrufe += 1;
      return Promise.resolve({
        zeilen: alle.slice(von, von + seitengroesse),
        anzahl: mitZaehlung ? anzahl : null,
        fehler: null,
      });
    },
  };
}

Deno.test('sammleMomente: blättert über die Seitengrenze hinweg und verliert keinen Moment', async () => {
  const server = kappenderServer(1001, 1000);
  const { zeilen, verloren, fehler } = await sammleMomente(server.holeSeite);
  assertEquals(fehler, null);
  // Ohne Blättern stünden hier 1000, der stille Verlust, um den es geht.
  assertEquals(zeilen.length, 1001);
  assertEquals(zeilen.map((z) => z.id), server.alle.map((z) => z.id));
  assertEquals(verloren, 0);
});

Deno.test('sammleMomente: eine einzige volle Seite kostet keinen zweiten Abruf', async () => {
  const server = kappenderServer(1000, 1000);
  const { zeilen } = await sammleMomente(server.holeSeite);
  assertEquals(zeilen.length, 1000);
  // Die Zählung des ersten Durchgangs spart den sonst nötigen leeren Abruf.
  assertEquals(server.abrufe, 1);
});

Deno.test('sammleMomente: eine Doublette an der Seitengrenze erscheint nur einmal', async () => {
  // Was passiert, wenn zwischen zwei Abrufen ein `confirm` einen Moment mit
  // früherem captured_at auf 'uploaded' setzt: alles danach rutscht eine
  // Position nach hinten, die letzte Zeile der ersten Seite kommt in der
  // zweiten NOCH EINMAL. Der Quervergleich gegen die Zählung fängt nur die
  // Verlust-Richtung, nicht diese.
  const seiten: MomentZeile[][] = [
    [momentZeile('a'), momentZeile('b'), momentZeile('c')],
    [momentZeile('c'), momentZeile('d')],
    [],
  ];
  let i = 0;
  const { zeilen, verloren } = await sammleMomente((_von, mitZaehlung) =>
    Promise.resolve({ zeilen: seiten[i++] ?? [], anzahl: mitZaehlung ? 5 : null, fehler: null })
  );
  assertEquals(zeilen.map((z) => z.id), ['a', 'b', 'c', 'd']);
  // Fünf gezählt, vier verschiedene eingesammelt: die Lücke wird sichtbar
  // gemacht, statt einen vollständigen Recap zu behaupten.
  assertEquals(verloren, 1);
});

Deno.test('sammleMomente: eine Seite aus lauter Doubletten führt nicht in eine Endlosschleife', async () => {
  // Der Versatz wächst am GELIEFERTEN, nicht am BEHALTENEN Stand. Würde er
  // an den behaltenen Zeilen gemessen, stünde er hier für immer still.
  let abrufe = 0;
  const { zeilen } = await sammleMomente((_von, mitZaehlung) => {
    abrufe += 1;
    if (abrufe > 5) return Promise.resolve({ zeilen: [], anzahl: null, fehler: null });
    return Promise.resolve({
      zeilen: [momentZeile('a'), momentZeile('a')],
      anzahl: mitZaehlung ? 99 : null,
      fehler: null,
    });
  });
  assertEquals(zeilen.map((z) => z.id), ['a']);
  assert(abrufe <= 6, `sammleMomente hat ${abrufe} Abrufe gebraucht`);
});

Deno.test('sammleMomente: ein Fehler bricht ab und wird durchgereicht', async () => {
  const { fehler, zeilen } = await sammleMomente(() =>
    Promise.resolve({ zeilen: [], anzahl: null, fehler: { message: 'kaputt' } })
  );
  assertEquals(fehler, { message: 'kaputt' });
  assertEquals(zeilen.length, 0);
});

Deno.test('sammleMomente: eine leere Reise beendet die Schleife sofort', async () => {
  const { zeilen, verloren } = await sammleMomente((_von, mitZaehlung) =>
    Promise.resolve({ zeilen: [], anzahl: mitZaehlung ? 0 : null, fehler: null })
  );
  assertEquals(zeilen, []);
  assertEquals(verloren, 0);
});

// ===========================================================================
// 4. Schlüssel werden abgeleitet, nicht übernommen
// ===========================================================================

// Ein Signierer, der statt einer echten Signatur nur festhält, WELCHER Pfad
// signiert werden sollte. Kein Mock, der den geprüften Mechanismus ersetzt:
// die Ableitung passiert weiterhin in baueMedien, hier wird nur ihr Ergebnis
// sichtbar gemacht.
function protokollierenderSignierer() {
  const signiert: string[] = [];
  return {
    signiert,
    fn: (key: string) => {
      signiert.push(key);
      return Promise.resolve(`https://s3.example/${key}?X-Amz-Expires=3600`);
    },
  };
}

Deno.test('baueMedien: signiert den ABGELEITETEN Pfad, nicht den gespeicherten thumb_key', async () => {
  const FREMDE_REISE = '00000000-0000-4000-8000-00000000dead';
  const zeile = momentZeile('cccccccc-0000-4000-8000-000000000001', {
    // storage_key stimmt, thumb_key zeigt in eine fremde Reise. Der Eintrag
    // bleibt also in der Antwort, genau daran zeigt sich, dass auch der
    // Thumb-Pfad abgeleitet wird. Ein Thumbnail ist der Inhalt eines Moments
    // in klein; sicherheitlich steht hier dasselbe auf dem Spiel wie beim
    // Medium.
    thumb_key: `trips/${FREMDE_REISE}/beliebig_t.jpg`,
  });
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(TRIP_ID, [zeile], signierer.fn);

  assertEquals(ausgelassen, 0);
  assertEquals(medien.length, 1);
  const erwartet = erwarteteSchluessel(TRIP_ID, zeile.id, 'photo', 'jpg');
  assertEquals(signierer.signiert, [erwartet.storage_key, erwartet.thumb_key]);
  for (const key of signierer.signiert) {
    assertFalse(key.includes(FREMDE_REISE), `ein fremder Pfad wurde signiert: ${key}`);
  }
});

Deno.test('baueMedien: eine Zeile, deren storage_key woanders hinzeigt, fällt heraus und wird gezählt', async () => {
  const gut = momentZeile('cccccccc-0000-4000-8000-000000000001');
  const boese = momentZeile('cccccccc-0000-4000-8000-000000000002', {
    storage_key: 'trips/00000000-0000-4000-8000-00000000dead/beliebig.jpg',
  });
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(TRIP_ID, [gut, boese], signierer.fn);

  assertEquals(medien.map((m) => m.post_id), [gut.id]);
  assertEquals(ausgelassen, 1);
  for (const key of signierer.signiert) {
    assertFalse(key.includes('dead'), `für eine ausgelassene Zeile wurde signiert: ${key}`);
  }
});

Deno.test('baueMedien: ohne thumb_key entsteht thumb_url = null statt einer Signatur auf ".../null"', async () => {
  const zeile = momentZeile('cccccccc-0000-4000-8000-000000000003', { thumb_key: null });
  const signierer = protokollierenderSignierer();
  const { medien } = await baueMedien(TRIP_ID, [zeile], signierer.fn);
  assertEquals(medien[0].thumb_url, null);
  assertEquals(signierer.signiert.length, 1);
  assertFalse(signierer.signiert[0].includes('null'));
});

Deno.test('baueMedien: die Reihenfolge der Zeilen bleibt erhalten', async () => {
  const ids = ['post-1', 'post-2', 'post-3'];
  const signierer = protokollierenderSignierer();
  const { medien } = await baueMedien(TRIP_ID, ids.map((id) => momentZeile(id)), signierer.fn);
  assertEquals(medien.map((m) => m.post_id), ids);
});

Deno.test('baueMedien: die Endung kommt aus media_ext der Zeile (iOS .mov, Android .mp4)', async () => {
  const zeile = momentZeile('cccccccc-0000-4000-8000-000000000004', {
    type: 'video',
    media_ext: 'mov',
    duration_s: 12,
    storage_key: erwarteteSchluessel(TRIP_ID, 'cccccccc-0000-4000-8000-000000000004', 'video', 'mov').storage_key,
    thumb_key: null,
  });
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(TRIP_ID, [zeile], signierer.fn);
  assertEquals(ausgelassen, 0);
  assert(signierer.signiert[0].endsWith('.mov'), signierer.signiert[0]);
  assertEquals(medien[0].duration_s, 12);
});

Deno.test('baueMedien: lat und lng gehen unverändert durch', async () => {
  // Seit Phase 7 zeigt der geteilte Recap dieselbe Karte wie die App (Spec
  // R4). Geprüft wird der Wert, nicht nur die Anwesenheit des Feldes: eine
  // vertauschte oder gerundete Koordinate setzt eine Nadel an den falschen
  // Ort, und ein negativer Längengrad (Lissabon liegt westlich von
  // Greenwich) ist der Fall, in dem ein Vorzeichenfehler auffiele.
  const zeile = momentZeile('cccccccc-0000-4000-8000-000000000005', { lat: 38.7139, lng: -9.1301 });
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(TRIP_ID, [zeile], signierer.fn);
  assertEquals(ausgelassen, 0);
  assertEquals(medien[0].lat, 38.7139);
  assertEquals(medien[0].lng, -9.1301);
});

Deno.test('baueMedien: ein Moment ohne Ort behält null, statt zu verschwinden', async () => {
  // Der Normalfall, nicht der Sonderfall: ortBestimmen() liefert bewusst
  // null, wenn die Ortungsdienste nicht erlaubt sind. Der Moment wird
  // trotzdem eingesendet, und muss darum auch im geteilten Recap stehen.
  // Ein `filter` auf gesetzte Koordinaten wäre stiller Datenverlust; die
  // Karte lässt die Nadel weg, die Filmrolle nicht den Moment.
  const zeile = momentZeile('cccccccc-0000-4000-8000-000000000006', { lat: null, lng: null });
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(TRIP_ID, [zeile], signierer.fn);
  assertEquals(ausgelassen, 0);
  assertEquals(medien.length, 1);
  assertEquals(medien[0].lat, null);
  assertEquals(medien[0].lng, null);
});

// ===========================================================================
// 5. Die Antwortform, der Beleg für das, was NICHT herausgeht
// ===========================================================================

// Die verbotene Liste aus Spec §5.1 und dem Task-Brief, dazu die Felder, die
// eine Trip-Zeile sonst noch trägt.
const VERBOTENE_FELDER = [
  'reaktionen',
  'reactions',
  'kommentare',
  'comments',
  'mitglieder',
  'members',
  'trip_members',
  'invite_code',
  'author_id',
  'owner_id',
  'reporter_id',
  'status',
  'revealed_at',
  'plan',
  'storage_key',
  'thumb_key',
  'upload_status',
];

Deno.test('formeReise: gibt GENAU name, start_date und end_date heraus', () => {
  // Die Zeile kommt hier absichtlich mit allem, was public.trips trägt.
  // invite_code allein wäre ein Beitritt zur Reise für jeden, der den
  // öffentlichen Link hat, aus «anschauen dürfen» würde «mitmachen können».
  const volleZeile = {
    id: TRIP_ID,
    name: 'Lissabon Städtetrip',
    cover_key: 'trips/x/cover.jpg',
    start_date: '2026-05-08',
    end_date: '2026-05-12',
    status: 'revealed',
    revealed_at: '2026-05-13T17:00:00Z',
    invite_code: 'a1b2c3d4e5f6',
    owner_id: '33333333-3333-4333-8333-333333333333',
    plan: 'free',
    created_at: '2026-05-01T10:00:00Z',
  };

  const reise = formeReise(volleZeile);
  assertEquals(Object.keys(reise).sort(), ['end_date', 'name', 'start_date']);
  assertEquals(reise, { name: 'Lissabon Städtetrip', start_date: '2026-05-08', end_date: '2026-05-12' });
});

Deno.test('die Antwort von aufloesen trägt genau die Felder des Vertrags', async () => {
  const volleZeile = {
    id: TRIP_ID,
    name: 'Lissabon Städtetrip',
    start_date: '2026-05-08',
    end_date: '2026-05-12',
    status: 'revealed',
    invite_code: 'a1b2c3d4e5f6',
    owner_id: '33333333-3333-4333-8333-333333333333',
  };
  const signierer = protokollierenderSignierer();
  const { medien, ausgelassen } = await baueMedien(
    TRIP_ID,
    [momentZeile('cccccccc-0000-4000-8000-000000000001', { caption: 'Fähre legt ab' })],
    signierer.fn,
  );
  const antwort = baueAufloesungsAntwort(volleZeile, medien, '2026-08-08T13:00:00.000Z', ausgelassen);

  assertEquals(Object.keys(antwort).sort(), ['ausgelassen', 'gueltig_bis', 'medien', 'reise']);
  assertEquals(Object.keys(antwort.reise).sort(), ['end_date', 'name', 'start_date']);
  // Zwölf Felder seit Phase 7 (vorher zehn): lat und lng sind dazugekommen.
  // Diese Liste ist die Stelle, an der eine unbeabsichtigt hinzugefügte
  // Spalte auffällt, auch eine, die harmlos aussieht.
  assertEquals(Object.keys(antwort.medien[0]).sort(), [
    'autor_name',
    'caption',
    'captured_at',
    'captured_tz',
    'duration_s',
    'lat',
    'lng',
    'medium_url',
    'place_name',
    'post_id',
    'thumb_url',
    'type',
  ]);

  // Der Autorenname gehört dazu (er steht im Recap ohnehin auf jedem Moment),
  // die author_id nie.
  assertEquals(antwort.medien[0].autor_name, 'Mira');

  // Und zum Schluss der grobe, aber wirksame Griff: die ganze Antwort als
  // Text. Damit fällt auch ein Feld auf, das jemand später über ein
  // verschachteltes Objekt oder einen ...spread hineinreicht, statt es in die
  // Schlüsselliste oben zu schreiben.
  const alsText = JSON.stringify(antwort);
  for (const feld of VERBOTENE_FELDER) {
    assertFalse(alsText.includes(feld), `die Antwort enthält "${feld}": ${alsText}`);
  }
  assertFalse(alsText.includes(volleZeile.owner_id));
  assertFalse(alsText.includes(volleZeile.invite_code));
});
