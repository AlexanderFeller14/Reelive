-- ============================================================================
-- posts.media_ext, die tatsächliche Container-Endung eines Moments
-- ----------------------------------------------------------------------------
-- Warum es diese Spalte gibt (Phase-4-Final-Review, Important 5):
--
-- `expo-camera` erzeugt auf iOS eine QuickTime-Datei (.mov), auf Android eine
-- .mp4. Der Client lud die iOS-Bytes trotzdem unter `….mp4` mit Content-Type
-- `video/mp4` hoch; der Bucket nahm das an, weil er den DEKLARIERTEN Typ prüft,
-- nicht den Inhalt. Ergebnis: dauerhaft falsch etikettierte Objekte, und weil
-- der Speicherschlüssel pro Moment unveränderlich ist, nachträglich nicht mehr
-- zu heilen.
--
-- Die Edge Function `media-urls` leitet den Schlüssel bewusst SELBST aus der
-- posts-Zeile ab und übernimmt nie einen Pfad aus dem Anfrage-Body (Spec §6).
-- Damit sie die richtige Endung ableiten kann, braucht sie dieselbe Information,
-- und zwar aus der Datenbank, nicht aus der Anfrage. Genau das ist diese
-- Spalte. Die Eigenschaft „die Function signiert nur, was sie selbst
-- hergeleitet hat" bleibt damit erhalten:
--   * Der Wert kommt aus der gelesenen Zeile, nie aus dem Body.
--   * Die Check-Constraint unten macht daraus eine geschlossene Liste, der
--     Client kann keinen beliebigen Pfadbestandteil unterschieben.
--   * `authenticated` hat seit Phase 1 kein UPDATE auf posts; die Endung steht
--     mit dem Insert fest, genauso wie trip_id, author_id und type.
--
-- Bestandszeilen: Videos wurden bisher immer als .mp4 hochgeladen, sie
-- bekommen genau diesen Wert, damit die Constraint sie nicht rückwirkend
-- verletzt und die abgeleiteten Schlüssel auf die tatsächlich liegenden
-- Objekte zeigen.
-- ============================================================================

alter table public.posts add column media_ext text not null default 'jpg';

update public.posts set media_ext = 'mp4' where type = 'video';

-- Die Endung muss zur Aufnahmeart passen. Ein Foto ist immer JPEG (der Client
-- kodiert es beim Komprimieren ohnehin neu); ein Video ist mp4 ODER mov.
-- Der Default 'jpg' ist dadurch harmlos: für ein Foto ist er richtig, und ein
-- Video ohne ausdrückliche Endung scheitert LAUT an dieser Constraint, statt
-- still falsch etikettiert zu werden.
alter table public.posts add constraint posts_media_ext_passt_zum_typ check (
  (type = 'photo' and media_ext = 'jpg')
  or (type = 'video' and media_ext in ('mp4', 'mov'))
);

-- Ohne diesen Spalten-Grant scheitert JEDER Client-Insert mit "permission
-- denied", 20260803090600_role_hardening.sql hat `insert` auf posts von
-- authenticated entzogen und nur eine ausdrückliche Spaltenliste zurückgegeben.
-- Eine neue Spalte wandert dort NICHT automatisch mit (genau die Falle, die
-- der Kommentar in mobile/src/features/moments/postsApi.ts beschreibt).
grant insert (media_ext) on public.posts to authenticated;
