import {
  createUnifiedTheme,
  palettes,
  genPageTheme,
  shapes,
} from '@backstage/theme';

const commonOverrides = {
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 14,
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        '&:hover': {
          boxShadow: '0 4px 12px 0 rgba(0,0,0,0.12), 0 2px 6px -2px rgba(0,0,0,0.08)',
          transform: 'translateY(-1px)',
        },
      },
    },
  },
  MuiCardHeader: {
    styleOverrides: {
      root: {
        paddingBottom: 4,
      },
      title: {
        fontWeight: 600,
        fontSize: '1.05rem',
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      rounded: {
        borderRadius: 12,
      },
      elevation1: {
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
      },
      elevation2: {
        boxShadow: '0 4px 12px 0 rgba(0,0,0,0.10), 0 2px 6px -2px rgba(0,0,0,0.06)',
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        textTransform: 'none' as const,
        fontWeight: 600,
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
        },
      },
      containedPrimary: {
        boxShadow: '0 1px 3px 0 rgba(59,48,132,0.3)',
        '&:hover': {
          boxShadow: '0 4px 12px 0 rgba(59,48,132,0.35)',
        },
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        fontWeight: 500,
      },
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        transition: 'background-color 0.15s ease',
      },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        textTransform: 'none' as const,
        fontWeight: 600,
        fontSize: '0.9rem',
      },
    },
  },
  MuiAlert: {
    styleOverrides: {
      standardSuccess: {
        backgroundColor: '#f0fdf4',
        color: '#166534',
        '& .MuiAlert-icon': {
          color: '#16a34a',
        },
      },
      standardError: {
        backgroundColor: '#fef2f2',
        color: '#991b1b',
        '& .MuiAlert-icon': {
          color: '#dc2626',
        },
      },
      standardWarning: {
        backgroundColor: '#fffbeb',
        color: '#92400e',
        '& .MuiAlert-icon': {
          color: '#d97706',
        },
      },
      standardInfo: {
        backgroundColor: '#eff6ff',
        color: '#1e40af',
        '& .MuiAlert-icon': {
          color: '#2563eb',
        },
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        borderRadius: 4,
        height: 6,
      },
    },
  },
  BackstageHeader: {
    styleOverrides: {
      header: {
        backgroundImage: 'none',
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.08)',
      },
    },
  },
};

export const sthingsLightTheme = createUnifiedTheme({
  palette: {
    ...palettes.light,
    primary: {
      main: '#3B3084',
    },
    secondary: {
      main: '#0D9488',
    },
    status: {
      ok: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      running: '#2563eb',
      pending: '#7c3aed',
      aborted: '#6b7280',
    },
    background: {
      default: '#edeef2',
      paper: '#f5f5f8',
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
      colors: ['#3B3084', '#0D9488'],
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
  components: commonOverrides,
});

export const sthingsDarkTheme = createUnifiedTheme({
  palette: {
    ...palettes.dark,
    primary: {
      main: '#9D8FE8',
    },
    secondary: {
      main: '#2DD4BF',
    },
    status: {
      ok: '#4ade80',
      warning: '#fbbf24',
      error: '#f87171',
      running: '#60a5fa',
      pending: '#a78bfa',
      aborted: '#9ca3af',
    },
    background: {
      default: '#0f1117',
      paper: '#1a1d2e',
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
      colors: ['#1A1547', '#134e4a'],
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
  components: {
    ...commonOverrides,
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.2), 0 1px 2px -1px rgba(0,0,0,0.15)',
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 16px 0 rgba(0,0,0,0.3), 0 2px 8px -2px rgba(0,0,0,0.2)',
            transform: 'translateY(-1px)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 12,
        },
        elevation1: {
          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.2), 0 1px 2px -1px rgba(0,0,0,0.15)',
        },
        elevation2: {
          boxShadow: '0 4px 12px 0 rgba(0,0,0,0.25), 0 2px 6px -2px rgba(0,0,0,0.15)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardSuccess: {
          backgroundColor: 'rgba(74,222,128,0.1)',
          color: '#4ade80',
        },
        standardError: {
          backgroundColor: 'rgba(248,113,113,0.1)',
          color: '#f87171',
        },
        standardWarning: {
          backgroundColor: 'rgba(251,191,36,0.1)',
          color: '#fbbf24',
        },
        standardInfo: {
          backgroundColor: 'rgba(96,165,250,0.1)',
          color: '#60a5fa',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        ...commonOverrides.MuiButton.styleOverrides,
        containedPrimary: {
          boxShadow: '0 1px 3px 0 rgba(157,143,232,0.3)',
          '&:hover': {
            boxShadow: '0 4px 12px 0 rgba(157,143,232,0.35)',
          },
        },
      },
    },
  },
});
