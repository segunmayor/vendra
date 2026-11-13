'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { invalid, optionalText, text, toFormState } from '../../../lib/forms';
import { session } from '../../../lib/session';

const DECISIONS = ['approve', 'reject', 'request_changes'] as const;
const DONE = { approve: 'Approved. The seller can see this now.', reject: 'Rejected. The seller can see your reason.', request_changes: 'Sent back. The seller can see what to change.' };

export async function reviewApplication(id: string, version: number, _state: FormState, data: FormData): Promise<FormState> {
  const decision = text(data, 'decision') as (typeof DECISIONS)[number];
  if (!DECISIONS.includes(decision)) return invalid('Choose a decision');
  const note = optionalText(data, 'note');
  if (decision !== 'approve' && (note?.length ?? 0) < 3) {
    return invalid(decision === 'reject' ? 'Say why you are rejecting it. The applicant will read this.' : 'Say what the applicant needs to change. They will read this.');
  }
  const result = await session.mutate((api) => api.POST('/v1/admin/sellers/{id}/review', { params: { path: { id } }, body: { decision, note, version } }));
  revalidatePath(`/sellers/${id}`);
  revalidatePath('/sellers');
  return toFormState(result, DONE[decision]);
}
