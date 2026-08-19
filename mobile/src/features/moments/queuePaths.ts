import { Paths } from 'expo-file-system';

// Four pending moments were lost this way on 2026-08-17: the worker
// couldn't find the files and discarded the jobs as permanently failed.
// queueDb is the only translation point, see toRow/toJob there.
const MARKER = '/Documents/';

export function forStorage(uri: string): string {
  const i = uri.indexOf(MARKER);
  return i >= 0 ? uri.slice(i + MARKER.length) : uri;
}

export function forReading(stored: string): string {
  if (stored.startsWith('file://')) {
    const relative = forStorage(stored);
    return relative === stored ? stored : forReading(relative);
  }
  const base = Paths.document.uri;
  return base.endsWith('/') ? base + stored : `${base}/${stored}`;
}
