// Wer einen Moment entfernen darf, als reine Funktion: kein I/O, kein Client,
// kein Netz. Muster wie media-urls/lesenZugriff.ts, reveal-trip/reveal.ts und
// konto-loeschen/ablauf.ts, und aus demselben Grund: die Entscheidung, an der
// etwas hängt, wird ohne Docker geprüft, der Integrationstest ist die zweite
// Schicht, nie die einzige.

export type PostZeile = {
  id: string;
  trip_id: string;
  author_id: string;
  type: 'photo' | 'video';
  media_ext: string | null;
};

export type TripZeile = {
  status: string;
  owner_id: string;
};

// Wortgleich zur RLS-Policy `posts_delete_after_reveal` (Migration
// 20260803090300_sealing_rls.sql):
//
//   Reise ist 'revealed' UND (Aufrufer ist die Autorin ODER die Owner-Person)
//
// Die Policy bleibt bestehen und wird von pgTAP weiter geprüft. Sie ist aber
// nicht mehr die einzige Instanz, die entscheidet, und das ist der Grund, aus
// dem diese Regel hier NOCHMAL steht: die Function löscht die Medien im
// Speicher, BEVOR sie die Zeile anfasst (Begründung im Handler). Käme die
// Berechtigung erst beim DELETE zur Sprache, liesse sich mit einer fremden
// post_id ein fremder Moment unbrauchbar machen: die Objekte wären weg, das
// DELETE scheiterte danach an der Policy, und übrig bliebe eine Zeile, deren
// Kacheln für alle Mitreisenden ins Leere laden. Eine Moderationsfunktion, mit
// der sich fremde Momente zerstören lassen, ist das Gegenteil von Moderation.
//
// Warum «nach dem Reveal»: vorher ist die Reise versiegelt, niemand sieht die
// Momente der anderen, und es gibt nichts zu melden und nichts zu moderieren.
// Ein Löschweg, der vor dem Reveal offen stünde, wäre ausserdem ein Kanal, über
// den sich die Versiegelung ausprobieren liesse.
export function darfEntfernen(post: PostZeile, trip: TripZeile, userId: string): boolean {
  if (trip.status !== 'revealed') return false;
  return post.author_id === userId || trip.owner_id === userId;
}
