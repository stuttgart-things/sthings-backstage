import {
  createUnifiedTheme,
  palettes,
  genPageTheme,
  shapes,
} from '@backstage/theme';

export const sthingsLightTheme = createUnifiedTheme({
  palette: {
    ...palettes.light,
    primary: {
      main: '#3B3084',
    },
    secondary: {
      main: '#E8A317',
    },
    navigation: {
      background: '#1A1547',
      indicator: '#E8A317',
      color: '#FFFFFF',
      selectedColor: '#E8A317',
      navItem: {
        hoverBackground: '#2A2367',
      },
    },
  },
  defaultPageTheme: 'home',
  pageTheme: {
    home: genPageTheme({ colors: ['#3B3084', '#1A1547'], shape: shapes.wave }),
    documentation: genPageTheme({
      colors: ['#3B3084', '#E8A317'],
      shape: shapes.wave2,
    }),
    tool: genPageTheme({
      colors: ['#1A1547', '#3B3084'],
      shape: shapes.round,
    }),
    other: genPageTheme({
      colors: ['#3B3084', '#1A1547'],
      shape: shapes.wave,
    }),
  },
});

export const sthingsDarkTheme = createUnifiedTheme({
  palette: {
    ...palettes.dark,
    primary: {
      main: '#9D8FE8',
    },
    secondary: {
      main: '#E8A317',
    },
    navigation: {
      background: '#0F0C2E',
      indicator: '#E8A317',
      color: '#FFFFFF',
      selectedColor: '#E8A317',
      navItem: {
        hoverBackground: '#1A1547',
      },
    },
  },
  defaultPageTheme: 'home',
  pageTheme: {
    home: genPageTheme({ colors: ['#1A1547', '#0F0C2E'], shape: shapes.wave }),
    documentation: genPageTheme({
      colors: ['#1A1547', '#E8A317'],
      shape: shapes.wave2,
    }),
    tool: genPageTheme({
      colors: ['#0F0C2E', '#1A1547'],
      shape: shapes.round,
    }),
    other: genPageTheme({
      colors: ['#1A1547', '#0F0C2E'],
      shape: shapes.wave,
    }),
  },
});
