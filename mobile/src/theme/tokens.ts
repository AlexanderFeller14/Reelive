export const colors = {
  dark: {
    'bg-0': '#131110', 'bg-1': '#1C1917', 'bg-2': '#26221F', line: '#2E2A26',
    'text-1': '#F2EEE8', 'text-2': '#A79F96', 'text-3': '#6E675F',
    accent: '#ED5B3D', 'accent-text': '#ED5B3D', glow: '#E0913F',
    danger: '#E5484D', 'on-accent': '#FFF6F2',
  },
  light: {
    'bg-0': '#F6F3EE', 'bg-1': '#FCFAF6', 'bg-2': '#EFEAE2', line: '#E4DED4',
    'text-1': '#26221E', 'text-2': '#6E675F', 'text-3': '#A79F96',
    accent: '#ED5B3D', 'accent-text': '#C9432A', glow: '#B8752F',
    danger: '#D93A3F', 'on-accent': '#FFF6F2',
  },
} as const;

export type ColorTokens = typeof colors[keyof typeof colors];

export const radius = { control: 12, card: 24, pill: 999 } as const;

export const spacing = { xs: 4, s: 8, m: 12, base: 16, screen: 20, l: 24, xl: 32, xxl: 48 } as const;

export const type = {
  display: { fontFamily: 'Manrope_200ExtraLight', fontSize: 88, fontVariant: ['tabular-nums'] },
  h1: { fontFamily: 'Manrope_600SemiBold', fontSize: 28 },
  h2: { fontFamily: 'Manrope_600SemiBold', fontSize: 22 },
  body: { fontFamily: 'Manrope_400Regular', fontSize: 16, lineHeight: 23 },
  secondary: { fontFamily: 'Manrope_400Regular', fontSize: 14 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 12, letterSpacing: 0.24 },
  tab: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
} as const;
