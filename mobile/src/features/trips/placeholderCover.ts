import type { ImageSourcePropType } from 'react-native';

// Placeholder cover, for as long as trips carry no image of their own. The
// path must be static right in the `require` call, Metro cannot resolve a
// path assembled at runtime (assets/images/README.md), hence a fixed list
// instead of a name table.
const COVER: ImageSourcePropType[] = [
  require('@/assets/images/camper-thumbnail-16-9.png'),
  require('@/assets/images/ferienhaus-thumbnail-16-9.png'),
];

// Which image a card gets depends on its position in the list: the first
// card carries the first image, the second the second, then the row starts
// over. That way two identical covers never sit next to each other, as long
// as the list holds at least two images.
//
// The alternative would have been to derive the image from the trip id.
// That would have tied it to the trip instead of its place, but with only
// two images any such derivation is a coin flip per trip, and two trips then
// show the same cover half the time. That is exactly what happened.
//
// The price of this choice: the image belongs to the place, not the trip. A
// newly created trip pushes in front of the others and shifts their covers
// along. And the trip detail is not a list, it gets the place of the tapped
// card handed along as the route's `cover` parameter, so the same image
// shows there; anyone who lands there without that parameter (deep link,
// freshly created trip) sees the first one. Both are the reason this stays a
// placeholder: as soon as `trips` has a cover column, the image belongs to
// the trip again, and this file goes away.
export function placeholderCover(position: number): ImageSourcePropType {
  return COVER[position % COVER.length];
}
