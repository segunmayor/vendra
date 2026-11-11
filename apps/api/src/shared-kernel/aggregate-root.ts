export interface DomainEvent {
  readonly type: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export abstract class AggregateRoot {
  private pending: DomainEvent[] = [];

  protected raise(event: DomainEvent): void {
    this.pending.push(event);
  }

  /** Returns and clears events. Repositories commit them with the aggregate's state. */
  pullEvents(): DomainEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
}
