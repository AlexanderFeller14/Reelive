// Word-for-word identical to the private copies in `recap/[id]/player.tsx`
// and `teilen/[token].tsx`. This file is where they're meant to converge;
// switching the two screens over to it is mechanical follow-up work and
// doesn't belong in a fix round for the map (both files sit under other
// open tasks).
export function timeInZone(capturedAt: string, capturedTz: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: capturedTz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(capturedAt));
  } catch {
    const d = new Date(capturedAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
