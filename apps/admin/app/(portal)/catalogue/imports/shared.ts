import type { components } from '@vendra/api-client';
import type { Tone } from '@vendra/ui';

export type ImportJob = components['schemas']['ImportJobResponse'];
export type ImportItem = components['schemas']['ImportItemResponse'];
export type Issue = components['schemas']['IssueResponse'];

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  validated: { label: 'Checked, not started', tone: 'neutral' },
  queued: { label: 'Waiting to start', tone: 'warning' },
  running: { label: 'Importing', tone: 'warning' },
  completed: { label: 'Finished', tone: 'success' },
  cancelled: { label: 'Stopped', tone: 'danger' },
};

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  invalid: { label: 'Has problems', tone: 'danger' },
  ready: { label: 'Ready', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  imported: { label: 'Imported', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const MODE_LABEL: Record<string, string> = {
  create_and_update: 'Add new products and update existing ones',
  create_only: 'Add new products only',
};

export const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export const isActive = (status: string) => status === 'queued' || status === 'running';
