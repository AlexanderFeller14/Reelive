import { createContext, useContext, type ReactNode } from 'react';
import { palette, type ColorTokens } from './tokens';

// Light-only (DESIGN-LANGUAGE v2 §1). `scheme` stays in the API so that
// consumers stay stable, it is always 'light'. Media screens import `cinema`
// directly from the tokens.
type Theme = { colors: ColorTokens; scheme: 'light' };
const theme: Theme = { colors: palette, scheme: 'light' };
const ThemeContext = createContext<Theme>(theme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
