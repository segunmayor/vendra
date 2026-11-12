import { ApplicationError } from '../../shared-kernel';
import { SecretBox } from './secret-box';

export interface Sealer {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

/**
 * Encryption for secrets stored in the database. Without SETTINGS_ENCRYPTION_KEY the API
 * still starts, and only the features that need it explain what is missing.
 */
export function createSealer(key: string | undefined, purpose: string): Sealer {
  if (key) return new SecretBox(key);
  const missing = () => {
    throw new ApplicationError(
      'unavailable',
      'settings.no_encryption_key',
      `The server has no SETTINGS_ENCRYPTION_KEY, so ${purpose} cannot be saved or used. Ask whoever runs the server to set it.`,
    );
  };
  return { seal: missing, open: missing };
}
