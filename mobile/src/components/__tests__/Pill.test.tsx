import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Pill } from '../Pill';
import { cinema } from '@/theme/tokens';

// Searches the rendered tree (screen.toJSON()) for a node of the given
// type, the same tree-walk technique as detail.test.tsx:countAccentSurfaces,
// because this RNTL version no longer exposes UNSAFE_getByType (see the
// Sheet.test.tsx comment), but can rely on REAL native rendering: under Jest
// expo-blur actually renders its "ViewManagerAdapter_ExpoBlur" host node
// (no own mock stand-in needed, BlurView.web.tsx would behave differently,
// see token.test.tsx for the web case).
type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

function findAll(tree: Node | string | null, type: string): Node[] {
  if (!tree || typeof tree === 'string') return [];
  const hits = tree.type === type ? [tree] : [];
  const children = tree.children ?? [];
  return children.reduce<Node[]>((acc, c) => [...acc, ...findAll(c, type)], hits);
}

test('renders a real blur node (intensity 50 == "blur 10" on web, see Pill.tsx) instead of a mere color surface', async () => {
  await render(
    <Pill testID="p" style={{ borderRadius: 999 }}>
      <Text>Inhalt</Text>
    </Pill>
  );
  const blurNode = findAll(screen.toJSON() as Node, 'ViewManagerAdapter_ExpoBlur');
  expect(blurNode).toHaveLength(1);
  expect(blurNode[0].props).toMatchObject({ intensity: 50, tint: 'dark' });
});

test('the tint layer carries exactly rgba(19,17,16,0.55) (DESIGN-LANGUAGE §1)', async () => {
  await render(
    <Pill testID="p" style={{ borderRadius: 999 }}>
      <Text>Inhalt</Text>
    </Pill>
  );
  const allViews = findAll(screen.toJSON() as Node, 'View');
  const tint = allViews.find(
    (v) => (v.props.style as { backgroundColor?: string } | undefined)?.backgroundColor === cinema['overlay-pill']
  );
  expect(tint).toBeTruthy();
});

test('renders its children', async () => {
  await render(
    <Pill testID="p">
      <Text>Sichtbarer Inhalt</Text>
    </Pill>
  );
  expect(screen.getByText('Sichtbarer Inhalt')).toBeTruthy();
});

test('passes testID through to the outer node', async () => {
  await render(
    <Pill testID="meine-pille">
      <Text>x</Text>
    </Pill>
  );
  expect(screen.getByTestId('meine-pille')).toBeTruthy();
});

test('passes pointerEvents through (e.g. for a purely informational pill over the tap zones)', async () => {
  await render(
    <Pill testID="meine-pille" pointerEvents="none">
      <Text>x</Text>
    </Pill>
  );
  expect(screen.getByTestId('meine-pille').props.pointerEvents).toBe('none');
});
