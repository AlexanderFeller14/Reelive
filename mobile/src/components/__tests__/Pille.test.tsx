import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Pille } from '../Pille';
import { cinema } from '@/theme/tokens';

// Sucht im gerenderten Baum (screen.toJSON()) nach einem Knoten des
// angegebenen Typs — dieselbe Baum-Lauf-Technik wie
// detail.test.tsx:zaehleAccentFlaechen, weil diese RNTL-Version kein
// UNSAFE_getByType mehr exponiert (siehe Sheet.test.tsx-Kommentar), sich
// aber auf ECHTES natives Rendering verlassen lässt: expo-blur rendert
// unter Jest tatsächlich seinen "ViewManagerAdapter_ExpoBlur"-Host-Knoten
// (keine eigene Mock-Attrappe nötig — mit BlurView.web.tsx verhielte sich
// das anders, siehe token.test.tsx für den Web-Fall).
type Knoten = { type: string; props: Record<string, unknown>; children: (Knoten | string)[] | null };

function findeAlle(baum: Knoten | string | null, typ: string): Knoten[] {
  if (!baum || typeof baum === 'string') return [];
  const treffer = baum.type === typ ? [baum] : [];
  const kinder = baum.children ?? [];
  return kinder.reduce<Knoten[]>((acc, k) => [...acc, ...findeAlle(k, typ)], treffer);
}

test('rendert einen echten Blur-Knoten (intensity 50 == "Blur 10" auf Web, siehe Pille.tsx) statt einer blossen Farbfläche', async () => {
  await render(
    <Pille testID="p" style={{ borderRadius: 999 }}>
      <Text>Inhalt</Text>
    </Pille>
  );
  const blurKnoten = findeAlle(screen.toJSON() as Knoten, 'ViewManagerAdapter_ExpoBlur');
  expect(blurKnoten).toHaveLength(1);
  expect(blurKnoten[0].props).toMatchObject({ intensity: 50, tint: 'dark' });
});

test('die Tönungsebene trägt exakt rgba(19,17,16,0.55) (DESIGN-LANGUAGE §1)', async () => {
  await render(
    <Pille testID="p" style={{ borderRadius: 999 }}>
      <Text>Inhalt</Text>
    </Pille>
  );
  const alleViews = findeAlle(screen.toJSON() as Knoten, 'View');
  const toenung = alleViews.find(
    (v) => (v.props.style as { backgroundColor?: string } | undefined)?.backgroundColor === cinema['overlay-pill']
  );
  expect(toenung).toBeTruthy();
});

test('rendert die Kinder', async () => {
  await render(
    <Pille testID="p">
      <Text>Sichtbarer Inhalt</Text>
    </Pille>
  );
  expect(screen.getByText('Sichtbarer Inhalt')).toBeTruthy();
});

test('gibt testID an den äusseren Knoten weiter', async () => {
  await render(
    <Pille testID="meine-pille">
      <Text>x</Text>
    </Pille>
  );
  expect(screen.getByTestId('meine-pille')).toBeTruthy();
});

test('reicht pointerEvents weiter (z.B. für eine rein informative Pille über den Tipp-Zonen)', async () => {
  await render(
    <Pille testID="meine-pille" pointerEvents="none">
      <Text>x</Text>
    </Pille>
  );
  expect(screen.getByTestId('meine-pille').props.pointerEvents).toBe('none');
});
