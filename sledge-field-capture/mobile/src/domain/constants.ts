import type { Category, Severity, SyncStatus } from './types';

export const CATEGORIES: { value: Category; label: string; icon: string }[] = [
  { value: 'safety', label: 'Safety', icon: 'hard-hat' },
  { value: 'defect', label: 'Defect', icon: 'alert-decagram-outline' },
  { value: 'progress', label: 'Progress', icon: 'progress-check' },
  { value: 'inspection', label: 'Inspection', icon: 'clipboard-check-outline' },
];

export const SEVERITIES: { value: Severity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const STATUS_LABELS: Record<SyncStatus, string> = {
  pending: 'Pending',
  syncing: 'Syncing',
  synced: 'Synced',
  error: 'Error',
};

export const categoryMeta = (value: Category) => CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[0]!;

export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_PHOTOS = 6;
export const MAX_VOICE_NOTE_MS = 2 * 60 * 1000;
