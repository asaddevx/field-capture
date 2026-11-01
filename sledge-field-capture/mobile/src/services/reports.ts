import { randomUUID } from 'expo-crypto';

import { reportRepository } from '@/db/reportRepository';
import type { NewReport } from '@/domain/types';
import { syncEngine } from '@/sync';

import { clearDraft } from './draft';
import { deleteQuietly } from './media';

/** Saves locally first (the source of truth), then lets the engine upload when it can. */
export async function createReport(input: NewReport): Promise<string> {
  const id = randomUUID();
  await reportRepository.create(id, input);
  await clearDraft();
  void syncEngine.requestSync('created');
  return id;
}

export async function retryReport(id: string): Promise<void> {
  await reportRepository.requeue(id);
  void syncEngine.requestSync('retry');
}

export async function retryAllFailed(): Promise<number> {
  const n = await reportRepository.requeueAllFailed();
  void syncEngine.requestSync('retry');
  return n;
}

export async function deleteReport(id: string): Promise<void> {
  const attachments = await reportRepository.delete(id);
  for (const a of attachments) deleteQuietly(a.localUri);
}

export const syncNow = () => syncEngine.requestSync('manual');
