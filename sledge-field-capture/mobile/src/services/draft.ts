import { kvRepository } from '@/db/kvRepository';
import type { Category, NewAttachment, Severity } from '@/domain/types';

const DRAFT_KEY = 'draft:new-report';

/** Unsaved form state, persisted so a crash or app switch mid-capture loses nothing. */
export interface ReportDraft {
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  includeLocation: boolean;
  attachments: NewAttachment[];
}

export const loadDraft = () => kvRepository.get<ReportDraft>(DRAFT_KEY);
export const saveDraft = (draft: ReportDraft) => kvRepository.set(DRAFT_KEY, draft);
export const clearDraft = () => kvRepository.remove(DRAFT_KEY);

export async function draftAttachmentUris(): Promise<string[]> {
  const draft = await loadDraft();
  return draft?.attachments.map((a) => a.localUri) ?? [];
}
