// The cinema ticket asset's geometry (assets/images/reelive-kino-ticket.png,
// cropped to its own bounding box), measured from the PNG. Everything a
// layout needs to know about the picture lives here as fractions of its
// size, so a re-export of the asset only has to update these numbers. Shared
// by the recap letter (SealedLetter.tsx) and the closing interstitial
// (TripClosedAnimation.tsx) that turns a trip into that letter: the wax has
// to land exactly where the letter later carries it.
export const TICKET_ASPECT = 758 / 1098;
// Centre of the dotted tear line between ticket and stub: the wax sits ON
// it, sealing the tear. Peeling the wax off is tearing the ticket.
export const TICKET_PERFORATION_Y = 852 / 1098;
// Where the main compartment's lower keyline runs: the lines stay above it,
// the stub below keeps the asset's punched holes and camera emboss.
export const TICKET_MAIN_END = 820 / 1098;
// Share of the ticket's width the wax takes up.
export const TICKET_WAX_SHARE = 0.42;
