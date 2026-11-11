import 'server-only';
import type { ActionResult } from '@vendra/portal-session/server';
import type { FormState } from '@vendra/ui';

export function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalText(data: FormData, key: string): string | undefined {
  return text(data, key) || undefined;
}

export function toFormState(result: ActionResult<unknown>, success: string): FormState {
  return result.ok ? { status: 'success', message: success } : { status: 'error', message: result.message };
}

export const invalid = (message: string): FormState => ({ status: 'error', message });
