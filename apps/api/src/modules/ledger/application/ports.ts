import { JournalEntry } from '../domain/journal-entry';

export interface JournalRepository {
  /** Returns 'duplicate' when an entry for this source already exists, so reactions can be retried. */
  append(entry: JournalEntry): Promise<'posted' | 'duplicate'>;
}
