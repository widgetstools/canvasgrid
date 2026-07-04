import { themeQuartz } from 'ag-grid-community';

// Dark theme — reuses the proven quartzDark params from apps/showcase.
export const darkTheme = themeQuartz.withParams(
  {
    accentColor: '#2dd4bf',
    backgroundColor: '#1a1f2e',
    foregroundColor: '#e2e8f0',
    browserColorScheme: 'dark',
    columnBorder: true,
    fontFamily: { googleFont: 'Inter' },
    fontSize: 13,
    headerBackgroundColor: '#0f1320',
    headerFontFamily: { googleFont: 'Inter' },
    headerFontSize: 13,
    headerFontWeight: 600,
    oddRowBackgroundColor: '#1e2436',
    spacing: 6,
    wrapperBorderRadius: 6,
  },
  'dark',
);
