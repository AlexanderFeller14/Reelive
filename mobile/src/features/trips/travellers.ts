// How the company on a trip is put into words. Returns null for a lone
// traveller, so callers can simply drop the part instead of stitching it onto
// an empty phrase.
//
// Lives here rather than next to one of its callers because two screens now
// say the same thing about the same trip: the recap overview's hero line and
// the sealed letter in front of the show. Two copies would drift the moment
// anyone touches the wording.
export function fellowTravellersText(memberCount: number): string | null {
  if (memberCount <= 1) return null;
  if (memberCount === 2) return 'zu zweit';
  if (memberCount === 3) return 'zu dritt';
  if (memberCount === 4) return 'zu viert';
  return `mit ${memberCount} Mitreisenden`;
}
