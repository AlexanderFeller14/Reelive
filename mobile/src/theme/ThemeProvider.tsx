import { createContext, useContext, type ReactNode } from 'react';
import { palette, type ColorTokens } from './tokens';

// Light-only (DESIGN-LANGUAGE v2 §1). `scheme` bleibt in der API, damit
// Verbraucher stabil bleiben — es ist immer 'light'. Medien-Screens
// importieren `cinema` direkt aus den Tokens.
type Theme = { colors: ColorTokens; scheme: 'light' };
const theme: Theme = { colors: palette, scheme: 'light' };
const ThemeContext = createContext<Theme>(theme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
