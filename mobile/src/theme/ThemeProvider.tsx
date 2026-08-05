import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, type ColorTokens } from './tokens';

type Theme = { colors: ColorTokens; scheme: 'dark' | 'light' };
const ThemeContext = createContext<Theme>({ colors: colors.dark, scheme: 'dark' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  return (
    <ThemeContext.Provider value={{ colors: colors[scheme], scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
