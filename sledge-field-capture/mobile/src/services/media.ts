import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { NewAttachment } from '@/domain/types';

const MAX_PHOTO_EDGE = 1600;
const PHOTO_QUALITY = 0.72;

/**
 * Captured media lives in the document directory: the OS may purge the cache
 * directory (where the camera and recorder write) at any time, which would
 * silently lose unsynced evidence.
 */
function attachmentsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Downscales and recompresses a camera photo, then moves it into permanent storage. */
export async function persistPhoto(sourceUri: string, width: number, height: number): Promise<NewAttachment> {
  const context = ImageManipulator.manipulate(sourceUri);
  if (Math.max(width, height) > MAX_PHOTO_EDGE) {
    context.resize(width >= height ? { width: MAX_PHOTO_EDGE, height: null } : { width: null, height: MAX_PHOTO_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });

  const id = randomUUID();
  const file = new File(saved.uri);
  // Only the re-encoded copy is moved. The picker's source is left alone: it may be
  // the user's original gallery photo, and camera output in the cache is purged by the OS.
  await file.move(new File(attachmentsDirectory(), `${id}.jpg`));

  return {
    id,
    kind: 'photo',
    localUri: file.uri,
    mimeType: 'image/jpeg',
    sizeBytes: file.size ?? 0,
    width: saved.width,
    height: saved.height,
    durationMs: null,
  };
}

export async function persistVoiceNote(sourceUri: string, durationMs: number): Promise<NewAttachment> {
  const id = randomUUID();
  const file = new File(sourceUri);
  await file.move(new File(attachmentsDirectory(), `${id}.m4a`));
  return {
    id,
    kind: 'audio',
    localUri: file.uri,
    mimeType: 'audio/mp4',
    sizeBytes: file.size ?? 0,
    width: null,
    height: null,
    durationMs,
  };
}

export function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort: a leftover file is harmless and swept by cleanupOrphans.
  }
}

/** Removes files no report or draft references (e.g. from a discarded form). */
export function cleanupOrphans(referenced: Set<string>): number {
  let removed = 0;
  for (const entry of attachmentsDirectory().list()) {
    if (entry instanceof File && !referenced.has(entry.uri)) {
      deleteQuietly(entry.uri);
      removed++;
    }
  }
  return removed;
}

export function storageUsage(): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of attachmentsDirectory().list()) {
    if (entry instanceof File) {
      files++;
      bytes += entry.size ?? 0;
    }
  }
  return { files, bytes };
}
