import type { Severity, SyncStatus } from '@/domain/types';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  online: string;
  offline: string;
  status: Record<SyncStatus, string>;
  severity: Record<Severity, string>;
  danger: string;
  overlay: string;
}

export const lightTheme: Theme = {
  dark: false,
  bg: '#F3F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEFF3',
  border: '#DFE5EB',
  text: '#0E1621',
  textMuted: '#536170',
  textFaint: '#8A96A3',
  accent: '#F26B1D',
  accentPressed: '#D85A10',
  onAccent: '#FFFFFF',
  online: '#16A35A',
  offline: '#536170',
  status: { pending: '#C98A00', syncing: '#2F6FEB', synced: '#16A35A', error: '#DC3B40' },
  severity: { low: '#2F6FEB', medium: '#C98A00', high: '#E5682A', critical: '#DC3B40' },
  danger: '#DC3B40',
  overlay: 'rgba(14, 22, 33, 0.55)',
};

export const darkTheme: Theme = {
  dark: true,
  bg: '#0A0E13',
  surface: '#131A22',
  surfaceAlt: '#1B242E',
  border: '#25303C',
  text: '#E8EEF4',
  textMuted: '#97A4B1',
  textFaint: '#66727F',
  accent: '#FF7A2E',
  accentPressed: '#E8661C',
  onAccent: '#FFFFFF',
  online: '#34C77B',
  offline: '#97A4B1',
  status: { pending: '#F2B53A', syncing: '#5C8FF2', synced: '#34C77B', error: '#F2555A' },
  severity: { low: '#5C8FF2', medium: '#F2B53A', high: '#FF8A4C', critical: '#F2555A' },
  danger: '#F2555A',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** Appends an alpha channel to a #RRGGBB colour. */
export function alpha(hex: string, opacity: number): string {
  const a = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
