export type PlayerMode = 'show' | 'jump';

export function playerMode(startParam: string | undefined): PlayerMode {
  if (startParam === undefined || startParam === '') return 'show';
  const n = Number(startParam);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'show';
  return 'jump';
}
