import { Paths } from 'expo-file-system';

// The documents folder carries the container UUID of the installation in its
// path, and every app rebuild hands out a new one: a path stored absolutely
// points nowhere after the next update, even though iOS carried the files
// themselves over into the new container. Four pending moments were lost
// exactly this way on 2026-08-17: the worker couldn't find the files and
// discarded the jobs as permanently failed. The queue therefore stores only
// the part BELOW Documents; it is resolved on read against whatever the
// current location is. queueDb is the only translation point, see toRow/toJob
// there.
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
