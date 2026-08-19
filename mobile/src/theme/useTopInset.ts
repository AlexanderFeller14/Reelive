import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from './tokens';

// The top spacing of a screen, read from top to bottom.
//
// The app shows no navigation header anywhere (`headerShown: false` in all
// three layouts), so every screen starts at y = 0, meaning behind the
// status bar and the Dynamic Island. The fixed spacing from the Design
// Language (48 or 32) wasn't enough on an iPhone 17 Pro: there the device
// takes up 59 points at the top, "Schritt 1 von 2" stuck to the clock and
// the H1 ran into the island. Seen on the simulator, not derived.
//
// `Math.max` instead of an addition: the designed spacing stays the
// designed spacing as long as it's enough anyway (devices without an
// island, web). Only where the device takes up more does the content give
// way, and then by exactly one grid step below the system area, not by 48
// further points. The 4-point grid from §3 applies to designed spacing;
// what the device occupies is not a design decision.
export function useTopInset(basis: number): number {
  const { top } = useSafeAreaInsets();
  return Math.max(basis, top + spacing.base);
}

// The counterpart for anything that sticks to the bottom edge. Same
// reasoning, different edge: the home indicator takes up around 34 points
// on edge-to-edge devices, and the player's reaction row sat with its
// designed 32 directly on top of it. Seen on the device, not derived.
//
// `Math.max` again instead of addition, so devices with a home button and
// the web keep their designed spacing (there `bottom` is simply 0).
export function useBottomInset(basis: number): number {
  const { bottom } = useSafeAreaInsets();
  return Math.max(basis, bottom + spacing.base);
}
