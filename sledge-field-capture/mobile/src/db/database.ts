import * as SQLite from 'expo-sqlite';

import { migrate } from './migrations';

const DATABASE_NAME = 'field-capture.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Lazily opens the shared connection and runs migrations exactly once. */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      // WAL keeps reads fast while the sync engine writes; foreign keys are per-connection.
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifies subscribers (the UI store) that persisted data changed. */
export function notifyDataChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeToDataChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
