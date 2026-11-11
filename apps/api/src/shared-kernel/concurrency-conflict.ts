/** Another writer changed this aggregate first. The caller should reload and retry. */
export class ConcurrencyConflict extends Error {
  constructor(aggregate: string, id: string) {
    super(`${aggregate} ${id} was modified concurrently`);
    this.name = 'ConcurrencyConflict';
  }
}
