import { FileHolder } from './ports';

/**
 * The modules that keep files register here when the application starts, so the storage module
 * can move their files without reading their tables. Order is fixed by registration.
 */
export class FileHolders {
  private readonly holders: FileHolder[] = [];

  register(holder: FileHolder): void {
    if (this.holders.some((existing) => existing.purpose === holder.purpose)) throw new Error(`File holder already registered: ${holder.purpose}`);
    this.holders.push(holder);
  }

  all(): readonly FileHolder[] {
    return this.holders;
  }
}
