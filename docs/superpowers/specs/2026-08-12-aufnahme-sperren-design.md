# Reelive — Videoaufnahme sperren

**Status:** freigegeben (Brainstorming-Session 2026-08-12)
**Betrifft:** `mobile/src/components/Ausloeser.tsx`, `mobile/src/app/(tabs)/aufnehmen/index.tsx`
**Grundlage:** Produktkonzept «Snapchat-Muster: Tippen = Foto, Halten = Video»

---

## 1. Ausgangslage

Ein Video entsteht heute nur, solange der Daumen auf dem Auslöser liegt. Bis zu dreissig
Sekunden Dauerdruck sind unbequem, und jede Bewegung des Geräts geht durch genau den
Finger, der das Bild ruhig halten soll. Wer die Kamera schwenken oder das Gerät umsetzen
will, verliert die Aufnahme.

Die Sperre löst das: Der Daumen wischt zur Seite, rastet ein und ist frei. Das Video läuft
weiter, bis es beendet wird oder die Höchstdauer greift.

## 2. Entscheide (nicht neu verhandeln)

- **Richtung: nach rechts.** Nicht nach oben, wie bei WhatsApp und Instagram. User-Entscheid.
- **Bedienelemente oben blenden während der Aufnahme aus** und kommen danach zurück.
- **Kein Gesture Handler.** Die Geste läuft über `onTouchMove` und `pressRetentionOffset`
  am bestehenden `Pressable`.

Ausdrücklich **nicht** enthalten: Kamera-Wechsel während laufender Aufnahme, Foto aus dem
gesperrten Zustand heraus, eine Sperre nach links für Linkshänder.

## 3. Zustände

`Ausloeser.tsx` führt heute `ruhe → haelt → video`. Dazu kommt `gesperrt`:

| Zustand | Bedeutung | Übergang |
|---|---|---|
| `ruhe` | nichts läuft | Druck → `haelt` |
| `haelt` | Druck liegt an, Schwelle (500 ms) noch nicht erreicht | Loslassen → Foto; Ablauf → `video` |
| `video` | Aufnahme läuft, Daumen hält | Loslassen diesseits der Schwelle → Ende; jenseits → `gesperrt` |
| `gesperrt` | Aufnahme läuft, Daumen frei | Tipp auf den Auslöser → Ende; Höchstdauer → Ende |

Die Höchstdauer von dreissig Sekunden gilt in `video` wie in `gesperrt` unverändert und
beendet die Aufnahme in beiden Fällen von selbst.

## 4. Die Schloss-Pille

Sie erscheint, sobald aus dem Halten ein Video wird, und steht rechts neben dem Auslöser:

- **Form:** translucente Pille, 44 × 44, Radius 999, über `components/Pille.tsx` —
  identisch zu «Kamera wechseln» und «Blitz» (DESIGN-LANGUAGE §1/§4).
- **Icon:** Lucide `Lock`, Outline, Stroke 1.75, 22 px, in `cinema.text-2`.
- **Position:** Mitte 96 px rechts vom Auslöser-Zentrum. Auf einem iPhone SE (320 breit)
  endet die Pille bei 278, der Screen-Rand liegt bei 296: sie passt auch schmal.
- **Schwelle:** 48 px, also die halbe Strecke. Dahinter wechselt das Icon auf
  `cinema.seal-glow` und ein leichtes haptisches Signal bestätigt, dass die Sperre beim
  Loslassen greift. Kehrt der Daumen zurück, fällt beides zurück.

Gemessen wird die horizontale Verschiebung gegenüber dem Punkt, an dem der Druck begann,
nicht die absolute Bildschirmposition: Der Auslöser sitzt zwar mittig, aber ein Daumen
setzt selten in seiner Mitte auf.

## 5. Der gesperrte Zustand

Die Schloss-Pille verschwindet, sobald eingerastet ist: Sie hat ihren Zweck erfüllt, und
was bleibt, ist ein Bild ohne Bedienrauschen. Der runde Kern des Auslösers wird zum
Quadrat, das gebräuchliche Zeichen für «beendet die Aufnahme». Der Fortschrittsring läuft
unverändert weiter.

Ein Tipp auf den Auslöser beendet die Aufnahme. Sein Vorlese-Name wechselt dabei von
«Auslöser» auf «Aufnahme beenden», damit VoiceOver nicht weiter einen Auslöser ansagt, wo
ein Stopp-Knopf steht.

## 6. Die Kopfzeile während der Aufnahme

Reise-Pille, «Kamera wechseln» und «Blitz» blenden aus, sobald ein Video läuft. Der Grund
ist nicht Ästhetik: Im gesperrten Zustand ist die Hand frei, die Knöpfe wären erreichbar,
und ein Kamera-Wechsel mitten in `recordAsync` kann die laufende Aufnahme abbrechen.

Dafür braucht es kein neues Prop. `index.tsx` führt bereits `modus`, und der steht während
der Aufnahme auf `'video'`.

Die Kopfzeile wird dabei **entfernt, nicht auf `opacity: 0` gesetzt**. Zwei Gründe: Eine
nur durchsichtige Zeile bliebe für VoiceOver ein Angebot, das gerade nicht zu bedienen
ist. Und ein Ausblenden über 250 ms müsste die Zeile bis zum Ende der Animation gemountet
lassen, was jeden Test darüber an eine laufende Uhr bindet. Der Wechsel in die Aufnahme
ist ohnehin ein Moduswechsel, kein Übergang von Inhalt: Dass die Bedienung sofort
verschwindet, sagt «jetzt läuft es».

## 7. Bewegung und Barrierefreiheit

- Erscheinen und Verschwinden der Schloss-Pille: `duration-base` (250 ms), `ease-smooth`.
- Der Formwechsel des Kerns läuft über `transform`, wie der bestehende `kernAktiv`-Zustand.
- Haptik: `light` beim Überschreiten der Schwelle, dieselbe Stufe wie beim Auslösen selbst.
  Nicht `success`, die gehört laut §5 dem Versiegeln und dem Reveal.
- Bei reduzierter Bewegung erscheint und verschwindet die Pille als 200-ms-Fade, ohne
  Bewegung im Raum.
- Die Schloss-Pille trägt `accessibilityLabel="Aufnahme sperren"`. Sie ist eine Anzeige,
  kein eigenes Ziel: Erreicht wird sie über die Geste, nicht über einen Tipp.

## 8. Technische Umsetzung

`Pressable` gibt den Druck ab, sobald der Finger den Bereich verlässt, und würde damit das
Video stoppen, bevor die Sperre je greifen könnte. Zwei Bausteine verhindern das:

- **`pressRetentionOffset`** hält den Druck über den nötigen Weg hinweg fest. Der Wert
  deckt die Strecke bis zur Schloss-Pille mit Reserve ab.
- **`onTouchMove`** liefert die laufende Position. React Native reicht das Prop an die
  darunterliegende View durch, es braucht dafür keine zusätzliche Bibliothek.

Der Verzicht auf `react-native-gesture-handler` ist bewusst, obwohl die Bibliothek im
Projekt liegt: Sie verlangt ein `GestureHandlerRootView` im Wurzel-Layout, und ihre Gesten
lassen sich in Jest nur über interne Testhilfen auslösen. `onTouchMove` bleibt beim
`fireEvent`-Muster, das `Ausloeser.test.tsx` bereits verwendet.

Alle Phasenlogik bleibt in `Ausloeser.tsx`. Die Komponente besitzt die Unterscheidung
zwischen Tippen und Halten schon heute; die Sperre ist ein weiterer Zustand darin, kein
neues Bauteil.

## 9. Fehlerfälle

- **Loslassen diesseits der Schwelle:** Das Video endet wie bisher. Der bestehende Weg
  über `videoStoppen()` bleibt unverändert.
- **Wischen, bevor das Video läuft:** Solange die 500-ms-Schwelle nicht erreicht ist, gibt
  es keine Aufnahme zu sperren, und die Schloss-Pille steht noch nicht. Die Verschiebung
  wird darum erst ab `video` ausgewertet; wer vorher loslässt, bekommt ein Foto, wie ohne
  Wischbewegung auch.
- **Höchstdauer im gesperrten Zustand:** Der Timer beendet die Aufnahme und führt in
  dieselbe Vorschau wie sonst. Der Zustand fällt dabei auf `ruhe` zurück.
- **Screen verlassen, während gesperrt aufgenommen wird:** Das bestehende
  Unmount-Aufräumen greift, beide Timer werden gelöscht.
- **Haptik nicht verfügbar:** Wird verschluckt, wie beim bestehenden `leichtesFeedback()`.
  Ein fehlendes Signal darf die Aufnahme nie stören.

## 10. Tests

`Ausloeser.test.tsx` wird erweitert, im bestehenden Muster mit Fake Timers:

- Ein Wisch über die Schwelle mit anschliessendem Loslassen beendet das Video **nicht**.
- Ein Wisch diesseits der Schwelle mit Loslassen beendet es sehr wohl.
- Ein Wisch über die Schwelle und wieder zurück beendet es ebenfalls.
- Im gesperrten Zustand beendet ein Tipp die Aufnahme.
- Die Höchstdauer beendet auch die gesperrte Aufnahme.
- Der Vorlese-Name wechselt im gesperrten Zustand.

`kamera.test.tsx` bekommt: Während einer laufenden Aufnahme sind Reise-Pille, «Kamera
wechseln» und «Blitz» nicht sichtbar, danach wieder.
