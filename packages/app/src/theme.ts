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
        transition: 'all 0.15s ease',
        '&:hover': {
          filter: 'brightness(1.1)',
          transform: 'scale(1.03)',
        },
      },
    },
  },
  MuiTableContainer: {
    styleOverrides: {
      root: {
        borderRadius: 12,
        overflow: 'hidden',
      },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: {
        padding: '14px 16px',
        fontSize: '0.875rem',
      },
      head: {
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        fontSize: '0.75rem',
        letterSpacing: '0.05em',
      },
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        transition: 'background-color 0.15s ease',
        '&:hover': {
          backgroundColor: 'rgba(59,48,132,0.04)',
        },
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
  MuiDrawer: {
    styleOverrides: {
      paper: {
        borderRight: 'none',
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
  MuiIconButton: {
    styleOverrides: {
      root: {
        transition: 'all 0.15s ease',
        '&:hover': {
          transform: 'scale(1.1)',
        },
      },
    },
  },
  MuiLink: {
    styleOverrides: {
      root: {
        transition: 'color 0.15s ease',
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
      default: '#f5f0eb',
      paper: '#fffcf8',
    },
    navigation: {
      background: '#1A1547',
      indicator: '#E8A317',
      color: '#d4d0f0',
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
      default: '#0c0e16',
      paper: '#161929',
    },
    navigation: {
      background: '#08061e',
      indicator: '#E8A317',
      color: '#a09cc0',
      selectedColor: '#E8A317',
      navItem: {
        hoverBackground: '#141130',
      },
    },
  },
  defaultPageTheme: 'home',
  pageTheme: {
    home: genPageTheme({ colors: ['#1A1547', '#0c0e16'], shape: shapes.wave }),
    documentation: genPageTheme({
      colors: ['#1A1547', '#134e4a'],
      shape: shapes.wave2,
    }),
    tool: genPageTheme({
      colors: ['#0c0e16', '#1A1547'],
      shape: shapes.round,
    }),
    other: genPageTheme({
      colors: ['#1A1547', '#0c0e16'],
      shape: shapes.wave,
    }),
  },
  components: {
    ...commonOverrides,
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: '1px solid rgba(157,143,232,0.08)',
          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.25), 0 1px 2px -1px rgba(0,0,0,0.2)',
          transition: 'box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease',
          '&:hover': {
            borderColor: 'rgba(157,143,232,0.15)',
            boxShadow: '0 4px 16px 0 rgba(0,0,0,0.35), 0 2px 8px -2px rgba(0,0,0,0.25)',
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
          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.25), 0 1px 2px -1px rgba(0,0,0,0.2)',
        },
        elevation2: {
          boxShadow: '0 4px 12px 0 rgba(0,0,0,0.3), 0 2px 6px -2px rgba(0,0,0,0.2)',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s ease',
          '&:hover': {
            backgroundColor: 'rgba(157,143,232,0.06)',
          },
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
