// Ob der Aufnehmen-Tab gerade den SUCHER zeigt. Daran hängt die Gestalt der
// Tab-Bar (app/(tabs)/_layout.tsx): über dem Kamerabild liegt sie als
// durchscheinende Kino-Leiste AUF dem Bild (DESIGN-LANGUAGE §1: UI auf Fotos
// nur translucent), damit der Sucher dieselbe volle Fläche zeigt wie die
// Vorschau danach — vorher zeigte die Vorschau ~10 % weniger Bildbreite als
// der Sucher, weil beide mit `cover` in verschieden hohe Flächen zeichneten
// (Gerätefund 2026-08-18, «mehr gecropt als bevor ich auslöse»). Die hellen
// Zustände desselben Tabs (fehlende Berechtigung, keine Reise) behalten die
// normale helle Leiste.
//
// Der Kamera-Screen setzt das Zeichen (dieselbe Bedingung wie seine
// StatusBar-Umschaltung), der Tab-Navigator liest es. Anders als bei
// aufnahmeSperre reicht ein Holder allein nicht: die Leiste muss auf den
// Wechsel neu RENDERN, deshalb gibt es hier ein Abo für
// useSyncExternalStore.
import { spacing } from '@/theme/tokens';

let sichtbar = false;
const hoerer = new Set<() => void>();

// Die UIKit-Standardhöhe des Tab-Bar-Inhalts (49 Punkte; expo-routers
// Renderer-Konstante TABBAR_HEIGHT_UIKIT, nicht exportiert, darum hier
// nachgezogen; nur portrait relevant, die App ist laut app.json darauf
// festgelegt) plus ein Rasterschritt Luft über den Icons (§3). Die Formel
// wohnt HIER, weil beide Seiten sie brauchen: _layout.tsx macht die Leiste
// genau so hoch, und der Kamera-Screen hebt seine unteren Bedienelemente um
// denselben Betrag, sobald die Leiste als Overlay über dem Bild liegt —
// expo-router exportiert seinen Höhen-Kontext (useBottomTabBarHeight) nicht
// öffentlich, ein Deep-Import in build/ wäre die fragilere Abhängigkeit.
export const LEISTE_INHALT = 49;
export const LEISTE_LUFT_OBEN = spacing.s;

export function leisteHoehe(bottomInset: number): number {
  return LEISTE_INHALT + LEISTE_LUFT_OBEN + bottomInset;
}

export function setzen(an: boolean): void {
  if (sichtbar === an) return;
  sichtbar = an;
  hoerer.forEach((melden) => melden());
}

export function lesen(): boolean {
  return sichtbar;
}

export function abonnieren(melden: () => void): () => void {
  hoerer.add(melden);
  return () => {
    hoerer.delete(melden);
  };
}
