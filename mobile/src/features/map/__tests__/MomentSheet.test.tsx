import { readFileSync } from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { RecapMoment } from '@/features/recap/types';
import type { MapPoint } from '@/features/map/types';
import {
  usableUrl,
  ClusterSheetContent,
  MomentSheetContent,
  pinImageUrl,
  sheetImageUrl,
  type ImageSource,
  type SheetForm,
} from '../MomentSheet';

// expo-image is a native view, in the test a placeholder that passes
// through all props is enough (same pattern as in recap/__tests__/map.test.tsx).
jest.mock('expo-image', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return { Image: (props: object) => ReactActual.createElement(View, props) };
});

const FORM: SheetForm = { buttonLabel: 'Im Recap ansehen', prefix: '' };
const SHARED_FORM: SheetForm = { buttonLabel: 'Ab hier ansehen', prefix: 'share-' };

function moment(overrides: Partial<RecapMoment> = {}): RecapMoment {
  return {
    id: 'm1',
    trip_id: 't1',
    author_id: 'a1',
    type: 'photo',
    duration_s: null,
    caption: null,
    captured_at: '2026-05-08T12:32:00+00:00',
    captured_tz: 'Europe/Lisbon',
    place_name: null,
    lat: 38.7,
    lng: -9.1,
    upload_status: 'uploaded',
    authorName: 'Mira',
    authorAvatarKey: null,
    ...overrides,
  };
}

function point(overrides: Partial<RecapMoment> = {}, index = 0): MapPoint {
  const m = moment(overrides);
  return { moment: m, lat: m.lat as number, lng: m.lng as number, index };
}

function withUrls(entries: Record<string, ImageSource>): ReadonlyMap<string, ImageSource> {
  return new Map(Object.entries(entries));
}

describe('which image a pin gets and which a sheet', () => {
  // The two functions look confusingly similar and differ in exactly one
  // thing: the order. That's why the tests check exclusively cases where
  // the order actually matters, i.e. ones with BOTH URLs. A case with only
  // one URL would be the same for both and would let a swapped order
  // through.
  const both = withUrls({ m1: { medium_url: 'gross.jpg', thumb_url: 'klein.jpg' } });

  test('the pin takes the small image, the sheet the large one', async () => {
    expect(pinImageUrl(both, 'm1')).toBe('klein.jpg');
    expect(sheetImageUrl(both, 'm1')).toBe('gross.jpg');
  });

  test('without a thumbnail, the medium image also carries the pin', async () => {
    const mediumOnly = withUrls({ m1: { medium_url: 'gross.jpg', thumb_url: null } });
    expect(pinImageUrl(mediumOnly, 'm1')).toBe('gross.jpg');
  });

  test('without a medium image, the thumbnail also carries the sheet', async () => {
    const thumbOnly = withUrls({ m1: { medium_url: '', thumb_url: 'klein.jpg' } });
    expect(sheetImageUrl(thumbOnly, 'm1')).toBe('klein.jpg');
  });

  test('a moment without an entry in the pool has no image', async () => {
    expect(pinImageUrl(both, 'unbekannt')).toBeNull();
    expect(sheetImageUrl(both, 'unbekannt')).toBeNull();
  });

  // Why `usableUrl` exists at all: the type says `string`, but the
  // function can still deliver nothing. An empty string is worthless as
  // an image source and would pass as "there's something".
  test('an empty string does not count as an image, and both paths fall back from it', async () => {
    expect(usableUrl('')).toBeNull();
    expect(usableUrl(undefined)).toBeNull();
    expect(usableUrl('x')).toBe('x');
    const emptyThumb = withUrls({ m1: { medium_url: 'gross.jpg', thumb_url: '' } });
    expect(pinImageUrl(emptyThumb, 'm1')).toBe('gross.jpg');
  });
});

describe('what the two screens make differently at the sheet', () => {
  test('the button carries the label the screen gives it', async () => {
    await render(
      <ThemeProvider>
        <MomentSheetContent point={point()} imageUrl={null} form={FORM} onView={jest.fn()} />
      </ThemeProvider>
    );
    expect(screen.getByText('Im Recap ansehen')).toBeTruthy();

    await screen.rerender(
      <ThemeProvider>
        <MomentSheetContent point={point()} imageUrl={null} form={SHARED_FORM} onView={jest.fn()} />
      </ThemeProvider>
    );
    expect(screen.getByText('Ab hier ansehen')).toBeTruthy();
    expect(screen.queryByText('Im Recap ansehen')).toBeNull();
  });

  // The prefix isn't a cosmetic feature: both screens' tests grab their
  // sheets through it. If it didn't come through, they'd end up checking
  // the same IDs.
  test('the testID prefix stands before every ID of the sheet', async () => {
    await render(
      <ThemeProvider>
        <MomentSheetContent
          point={point()}
          imageUrl="gross.jpg"
          form={SHARED_FORM}
          onView={jest.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId('share-moment-content')).toBeTruthy();
    expect(screen.getByTestId('share-sheet-image')).toBeTruthy();
    expect(screen.queryByTestId('moment-content')).toBeNull();
  });

  test('an empty prefix leaves the IDs unchanged', async () => {
    await render(
      <ThemeProvider>
        <ClusterSheetContent
          points={[point({ id: 'm1' }, 0), point({ id: 'm2' }, 1)]}
          urls={withUrls({})}
          form={FORM}
          onView={jest.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId('group-list')).toBeTruthy();
    expect(screen.getByTestId('group-entry-m1')).toBeTruthy();
    expect(screen.getByTestId('group-entry-m2')).toBeTruthy();
  });
});

describe('what a tap in the sheet returns', () => {
  // The point carries `index`, and that's exactly what later goes as
  // `start` to the player. If the entry returned its position IN THE LIST
  // instead of the point, the jump would land on the wrong moment as soon
  // as a cluster doesn't start at 0.
  test('the entry returns its point including the playlist index, not its position in the list', async () => {
    const viewed = jest.fn();
    const firstPoint = point({ id: 'm1' }, 7);
    const secondPoint = point({ id: 'm2' }, 9);
    await render(
      <ThemeProvider>
        <ClusterSheetContent
          points={[firstPoint, secondPoint]}
          urls={withUrls({})}
          form={FORM}
          onView={viewed}
        />
      </ThemeProvider>
    );
    await fireEvent.press(screen.getByTestId('group-entry-m2'));
    expect(viewed).toHaveBeenCalledWith(secondPoint);
    expect(viewed.mock.calls[0][0].index).toBe(9);
  });

  test('VoiceOver announces at every entry what the tap does', async () => {
    await render(
      <ThemeProvider>
        <ClusterSheetContent
          points={[point({ id: 'm1', authorName: 'Mira' })]}
          urls={withUrls({})}
          form={FORM}
          onView={jest.fn()}
        />
      </ThemeProvider>
    );
    // The same wording as at the pin, it comes from the same function
    // (features/map/pin.ts). The time is the one FROM BACK THEN, ON SITE:
    // 12:32 UTC is 13:32 in Europe/Lisbon.
    expect(screen.getByLabelText('Moment von Mira um 13:32 öffnen')).toBeTruthy();
  });
});

// The test that locks in the merge. Without it, nothing stops a new
// separate version from being added to one of the two screens again, and
// the state this file grew out of quietly returns: two copies slowly
// drifting apart.
describe('the sheet building blocks live in exactly one place', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const SCREENS = [
    path.join(SRC, 'app', '(tabs)', 'recap', '[id]', 'map.tsx'),
    path.join(SRC, 'app', 'share', '[token].tsx'),
  ];
  const BUILDING_BLOCKS = [
    'MomentSheetContent',
    'ClusterSheetContent',
    'ClusterEntry',
    'SheetScroll',
    'FadeIn',
    'pinImageUrl',
    'sheetImageUrl',
    'usableUrl',
    'authorAndTime',
  ];

  // Sanity check first: if the detection finds nothing in the shared
  // file, every assertion below is worthless too.
  test('test setup: the shared file defines all of them', async () => {
    const source = readFileSync(path.join(__dirname, '..', 'MomentSheet.tsx'), 'utf8');
    for (const name of BUILDING_BLOCKS) {
      expect(source).toMatch(new RegExp(`export function ${name}\\b`));
    }
  });

  // Both notations in which a copy could arise: as a function declaration
  // (how they stood before) and as a constant with an arrow function.
  // Checking only the first would allow the comeback exactly where someone
  // writes the file differently.
  function definesItself(source: string, name: string): boolean {
    return (
      new RegExp(`^(export )?function ${name}\\b`, 'm').test(source) ||
      new RegExp(`^(export )?const ${name}\\s*=`, 'm').test(source)
    );
  }

  test('test setup: the detection finds both notations and nothing else', async () => {
    expect(definesItself('function SheetScroll({ testID }) {}', 'SheetScroll')).toBe(true);
    expect(definesItself('const SheetScroll = () => null;', 'SheetScroll')).toBe(true);
    expect(definesItself('import { SheetScroll } from "x";', 'SheetScroll')).toBe(false);
    expect(definesItself('  <SheetScroll testID="a" />', 'SheetScroll')).toBe(false);
  });

  test.each(SCREENS)('%s defines none of them itself', async (screenPath) => {
    const source = readFileSync(screenPath, 'utf8');
    expect(BUILDING_BLOCKS.filter((name) => definesItself(source, name))).toEqual([]);
  });
});
