# Bilder

Hier liegen alle Bild-Assets der App: eigene Illustrationen, Platzhalter, Hintergründe,
Leerzustände — und die Expo-System-Assets.

## Nicht anfassen

Diese Dateien sind aus `app.json` referenziert, Umbenennen oder Löschen bricht den Build:

- `reelive-app-icon-white.png` — App-Icon (iOS und Android, weisses R auf `#131110`).
  Quadratisch und **ohne Alpha-Kanal**, sonst weist der App Store das iOS-Icon zurück.
- `android-icon-foreground.png`, `android-icon-monochrome.png` — die beiden Ebenen des
  Android Adaptive Icon: weisses R auf transparent, aus dem App-Icon abgeleitet und so
  skaliert, dass es in der Safe Zone bleibt (kein Punkt weiter als 33 % der Kantenlänge
  vom Mittelpunkt — sonst schneidet die Kreismaske die Beinspitze ab). Den Grund liefert
  `adaptiveIcon.backgroundColor`, es braucht kein `backgroundImage`.
- `reelive-splash-wortmarke.png` — Splash Screen: die Wortmarke freigestellt, Tinte
  `#222222` (`text-1`) auf transparent. Aus `reelive-wordmark-02.png` abgeleitet, das
  einen cremefarbenen Grund hat und auf dem weissen Splash sonst als Kasten stünde.
- `favicon.png` — Web

Ungenutzt, aber noch im Repo: `icon.png`, `splash-icon.png`,
`android-icon-background.png` und `../expo.icon` sind die Expo-Vorlagen (blaues «A»)
von vor dem eigenen Icon.

## Eigene Bilder ablegen

- Format: `.png` (mit Transparenz) oder `.jpg` (Fotos). Vektoren als `.svg` nur, wenn
  `react-native-svg` sie rendert — als Bild-Asset kann Metro sie nicht laden.
- Auflösungen: Basisdatei plus `@2x` und `@3x` daneben legen, Metro wählt automatisch
  nach Pixeldichte:
  ```
  leerer-recap.png
  leerer-recap@2x.png
  leerer-recap@3x.png
  ```
- Dateinamen klein, mit Bindestrich, deutsch — wie die Routen: `leerer-recap.png`,
  `reise-platzhalter.jpg`.

## Verwenden

```tsx
import { Image } from 'expo-image'

<Image source={require('@/assets/images/leerer-recap.png')} style={{ width: 120, height: 120 }} />
```

Der Alias `@/assets/*` ist in `tsconfig.json` gesetzt und wird von Metro aufgelöst.
Der Pfad muss statisch im `require` stehen — zusammengebaute Pfade
(`require('@/assets/images/' + name)`) findet der Bundler nicht.

**Jest kennt diesen Alias nicht von allein.** `jest-expo` übernimmt aus der tsconfig nur
`@/*` → `src/*`, ein Asset-Import lief damit ins Leere («Could not locate module»).
Deshalb steht in `package.json` unter `jest.moduleNameMapper` zusätzlich
`"^@/assets/(.*)$": "<rootDir>/assets/$1"`. Wer die Jest-Konfiguration aufräumt, darf
diese Zeile nicht als Dublette zum tsconfig-Alias verwerfen.

Tests, die eine Komponente mit `expo-image` rendern, mocken das Modul (Muster in
`src/app/(tabs)/recap/__tests__/liste.test.tsx`) — sonst scheitert schon der Import,
weil `expo-image/src/observe.ts` eine native Umgebung erwartet.

Für Bilder aus dem Netz (Momente aus R2) gilt das nicht — die kommen als URI, nicht
als Asset.
