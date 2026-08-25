// Holds at most ONE preloaded video player for the recap player's next
// story. Creating and loading an AVPlayer on the tap itself is the visible
// stutter when a video comes up (the capture preview measured the same cost
// and answers it the same way, see preview.tsx); this slot lets the player
// screen build the NEXT video's player while the current story still runs,
// and the video moment then adopts it instead of building its own.
//
// A plain module instead of a ref inside the screen on purpose: adoption
// happens while React renders the incoming moment, and a ref mutated during
// render is exactly what the hooks rules forbid. Ownership is strict and
// single: whoever holds the player releases it. Until adoption that is this
// slot, afterwards the adopting moment, which is why `adoptWarmVideo` hands
// the player over exactly once and empties the slot doing so.
import type { VideoPlayer } from 'expo-video';

let slot: { url: string; player: VideoPlayer } | null = null;

export function holdWarmVideo(url: string, player: VideoPlayer): void {
  if (slot?.url === url) {
    // The same url is already warm: the older player has the head start on
    // loading, so the newcomer is the duplicate that goes.
    player.release();
    return;
  }
  slot?.player.release();
  slot = { url, player };
}

export function adoptWarmVideo(url: string): VideoPlayer | null {
  if (slot?.url !== url) return null;
  const { player } = slot;
  slot = null;
  return player;
}

export function releaseWarmVideo(): void {
  slot?.player.release();
  slot = null;
}

// For the warming effect's own bookkeeping: whether the slot already holds
// what it is about to warm, without adopting or disturbing it.
export function warmVideoUrl(): string | null {
  return slot?.url ?? null;
}
