export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'signedIn';

// Reine Routing-Entscheidung, getrennt gehalten, damit sie ohne
// React/Supabase testbar ist. null = noch nicht umleiten (Splash steht).
export function resolveRoute(status: AuthStatus): '/welcome' | '/profile-setup' | '/aufnehmen' | null {
  switch (status) {
    case 'loading': return null;
    case 'signedOut': return '/welcome';
    case 'needsProfile': return '/profile-setup';
    case 'signedIn': return '/aufnehmen';
  }
}

// Der Beitritts-Screen muss auch ohne Session stehenbleiben dürfen: er zeigt die
// Vorschau und schickt erst beim Antippen in den Login. Ohne diese Ausnahme
// würde der Guard einen frisch angetippten Einladungslink sofort wegleiten.
//
// 'teilen' (Phase 6, Web-Player) genauso: ein geteilter Recap-Link zeigt sich
// über share-link/aufloesen ausschliesslich Aussenstehenden OHNE Konto (Spec-
// Versprechen W5), secureSessionStorage.web.ts liefert auf dieser Plattform
// nie eine Sitzung, der Guard würde sonst jeden Aufruf sofort nach /welcome
// umleiten, bevor der Screen überhaupt rendert.
export function isPublicArea(area: string | undefined): boolean {
  return area === 'join' || area === 'teilen';
}

// Wo eine angemeldete Person stehen bleiben darf, ohne nach /aufnehmen
// zurückgeschickt zu werden. Lange war das genau '(tabs)'; die Aufnahme-
// Vorschau (app/vorschau.tsx) ist die erste Fläche daneben.
//
// Sie liegt bewusst NICHT im Tab-Navigator: Dessen Szene endet an der
// Oberkante der Tab-Bar, jedes `bottom` im Screen mass dadurch ab dieser Kante
// statt ab dem Bildschirmrand (das Eingabefeld sass eine Tab-Bar-Höhe zu
// hoch), und die Leiste blieb nach dem Auslösen noch einen Wimpernschlag
// stehen, weil sie erst nach dem Routenwechsel neu gerendert wird. Als
// Nachbarin des Tab-Navigators deckt die Vorschau sie sofort ab.
//
// Die Web-Hartsperre bleibt davon unberührt: istWebGesperrt() lässt weiterhin
// nur 'teilen' durch, die Vorschau wird auf Web also gar nicht erst gemountet.
export function istFlaecheFuerAngemeldete(area: string | undefined): boolean {
  return area === '(tabs)' || area === 'vorschau';
}

// Web-Hartsperre (Koordinator-Entscheid, Task 5, aus einem Fund von Task 4):
// der Web-Export bündelt die GANZE App als SPA, (auth)/phone, (auth)/otp
// und alle (tabs)-Routen sind einzeln abrufbar. isPublicArea() oben schützt
// NUR die Redirect-Entscheidung in _layout.tsx (welches Ziel bei welchem
// AuthStatus), sie sperrt keine Route. Ein echter Phone/OTP-Login im Browser
// wäre damit möglich gewesen, secureSessionStorage.web.ts verhindert zwar
// PERSISTENZ über den Seitenaufruf hinaus, aber nicht rein technisch eine
// Sitzung INNERHALB eines Tabs, sobald irgendein Web-Screen tatsächlich
// signInWith(...) aufruft (Task-4-Bericht). Das bricht Versprechen W5
// («wer kein Konto hat, kommt an nichts anderes») im Geiste.
//
// Bewusst eine ZWEITE, unabhängige Funktion statt isPublicArea() zu erweitern
// oder zu ersetzen: isPublicArea() beantwortet "darf diese Fläche OHNE
// Session stehen bleiben" (gilt auf JEDER Plattform, inkl. nativ, 'join'
// bleibt auf iOS/Android z.B. ausdrücklich ERREICHBAR). Diese Funktion hier
// beantwortet eine andere Frage: "darf diese Fläche auf WEB überhaupt
// GEMOUNTET werden", unabhängig vom AuthStatus (gilt auch während
// 'loading', bevor resolveRoute() überhaupt greift) und unabhängig davon, ob
// die Fläche isPublicArea() ist: 'join' ist zwar public (natives Verhalten
// bleibt unverändert), bekommt auf Web aber TROTZDEM die Sperre, weil auch
// der Beitritts-Screen ohne Session in den Login-Flow verzweigt
// (`beitreten()` in join/[code].tsx ruft bei !signedIn `router.replace(
// '/welcome')`), also selbst ein indirekter Weg zum selben, auf Web
// unerwünschten Login-Pfad wäre. `platformOS` als Parameter statt eines
// Imports von `react-native`.`Platform` hier drin: bleibt reine, ohne
// React-Native-Laufzeit testbare Funktion (gleiches Prinzip wie
// resolveRoute/isPublicArea), der Aufrufer (_layout.tsx) hat Platform.OS
// bereits zur Hand.
//
// _layout.tsx rendert bei `true` GAR KEINEN <Stack/>, nicht nur einen
// Redirect: alle anderen Routen-Screens werden auf Web dadurch nie
// gemountet, ihre Effekte laufen nie an (schliesst auch den in Task 4
// gemeldeten stillen Job-Verlust über jobEinreihen() ein, weil
// vorschau.tsx dafür erst gemountet werden müsste).
export function istWebGesperrt(platformOS: string, area: string | undefined): boolean {
  return platformOS === 'web' && area !== 'teilen';
}
