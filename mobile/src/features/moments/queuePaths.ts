import { Paths } from 'expo-file-system';

// === Queue paths: relative instead of absolute (fix 2026-08-18) ===
//
// The documents folder carries the installation's container UUID in its
// path, and every app rebuild assigns a new one: an absolutely stored path
// points into nothing after the next update, even though iOS carried the
// files themselves into the new container. That's exactly how four pending
// moments were lost on 2026-08-17 — the worker couldn't find the files and
// discarded the jobs as permanently failed. The queue therefore only stores
// the part BELOW Documents; it's resolved on read against the current
// location (queueDb is the only translation point, see toRow/toJob there).
const MARKER = '/Documents/';

// For storage: 'file:///…/Documents/momente/p1/medium.mov' →
// 'momente/p1/medium.mov'. Whatever isn't under Documents stays as it
// is — and then ages with the container as before.
export function forStorage(uri: string): string {
  const i = uri.indexOf(MARKER);
  return i >= 0 ? uri.slice(i + MARKER.length) : uri;
}

// For reading: attach the relative new form to the CURRENT Documents
// location. Absolute legacy rows (from before this fix) get re-anchored in
// the process; only what never lived under Documents stays unchanged and
// runs into the regular missing-file handling in the worker.
export function forReading(stored: string): string {
  if (stored.startsWith('file://')) {
    const relative = forStorage(stored);
    return relative === stored ? stored : forReading(relative);
  }
  const base = Paths.document.uri;
  return base.endsWith('/') ? base + stored : `${base}/${stored}`;
}
