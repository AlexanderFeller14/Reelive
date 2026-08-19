import { placeholderCover } from '../placeholderCover';

// The property the choice actually depends on: position, not the trip id,
// two cards next to each other never carry the same image.
test('consecutive positions carry different covers', () => {
  expect(placeholderCover(0)).not.toBe(placeholderCover(1));
});

// And the row then starts over from the front instead of reaching into
// nothing.
test('the row starts over after the last image', () => {
  expect(placeholderCover(2)).toBe(placeholderCover(0));
  expect(placeholderCover(3)).toBe(placeholderCover(1));
});

test('every position yields an image', () => {
  for (let i = 0; i < 8; i += 1) expect(placeholderCover(i)).toBeTruthy();
});
