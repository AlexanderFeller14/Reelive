export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'signedIn';

// Pure routing decision, kept separate so it is testable without
// React/Supabase. null = do not redirect yet (splash stands).
export function resolveRoute(status: AuthStatus): '/welcome' | '/profile-setup' | '/aufnehmen' | null {
  switch (status) {
    case 'loading': return null;
    case 'signedOut': return '/welcome';
    case 'needsProfile': return '/profile-setup';
    case 'signedIn': return '/aufnehmen';
  }
}

// The join screen must be allowed to stand even without a session: it shows
// the preview and only sends into login once tapped. Without this
// exception, the guard would immediately redirect a freshly tapped invite
// link away.

// 'teilen' (Phase 6, web player) likewise: a shared recap link shows itself
// via share-link/aufloesen exclusively to outsiders WITHOUT an account (Spec
// promise W5), secureSessionStorage.web.ts never returns a session on this
// platform, otherwise the guard would redirect every call to /welcome
// immediately, before the screen even renders.
export function isPublicArea(area: string | undefined): boolean {
  return area === 'join' || area === 'teilen';
}

// Where a signed-in person is allowed to stand without being sent back to
// /aufnehmen. For a long time that was exactly '(tabs)'; the capture preview
// (app/vorschau.tsx) is the first area next to it.
//
// It deliberately sits OUTSIDE the tab navigator: its scene ends at the top
// edge of the tab bar, so every `bottom` in the screen would measure from
// that edge instead of the screen edge (the input field sat one tab-bar
// height too high), and the bar kept standing for one more blink after
// triggering, because it only re-renders after the route change. As a
// neighbor of the tab navigator, the preview covers it immediately.
//
// The web hard lock stays unaffected by this: isWebLocked() still only lets
// 'teilen' through, so the preview never even gets mounted on web.
export function isAreaForSignedIn(area: string | undefined): boolean {
  return area === '(tabs)' || area === 'vorschau';
}

// Web hard lock (coordinator decision, Task 5, from a finding in Task 4):
// the web export bundles the WHOLE app as an SPA, (auth)/phone, (auth)/otp
// and all (tabs) routes are individually reachable. isPublicArea() above
// only guards the redirect decision in _layout.tsx (which target for which
// AuthStatus), it locks no route. A real phone/OTP login in the browser
// would therefore have been possible, secureSessionStorage.web.ts does
// prevent PERSISTENCE beyond the page visit, but not, in purely technical
// terms, a session WITHIN a tab, as soon as any web screen actually calls
// signInWith(...) (Task-4 report). That breaks promise W5 ("whoever has no
// account gets to nothing else") in spirit.
//
// Deliberately a SECOND, independent function instead of extending or
// replacing isPublicArea(): isPublicArea() answers "may this area stand
// WITHOUT a session" (holds on EVERY platform, including native, 'join'
// stays explicitly REACHABLE on iOS/Android for instance). This function
// here answers a different question: "may this area even be MOUNTED on
// WEB at all", independent of AuthStatus (holds even during 'loading',
// before resolveRoute() even kicks in) and independent of whether the area
// is isPublicArea(): 'join' is public (native behavior stays unchanged),
// but gets the lock on web ANYWAY, because the join screen also branches
// into the login flow without a session (`beitreten()` in join/[code].tsx
// calls `router.replace('/welcome')` when !signedIn), so it would itself be
// an indirect path to the same login path that is unwanted on web.
// `platformOS` as a parameter instead of an import of `react-native`'s
// `Platform` here: stays a pure function testable without the React Native
// runtime (same principle as resolveRoute/isPublicArea), the caller
// (_layout.tsx) already has Platform.OS at hand.
//
// _layout.tsx renders NO <Stack/> AT ALL on `true`, not just a redirect: all
// other route screens therefore never get mounted on web, their effects
// never run (this also closes the silent job loss via enqueueJob() reported
// in Task 4, because vorschau.tsx would have to be mounted for that first).
export function isWebLocked(platformOS: string, area: string | undefined): boolean {
  return platformOS === 'web' && area !== 'teilen';
}
