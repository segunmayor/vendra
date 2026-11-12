import { OutboxRegistry, OutboxRunner } from './outbox-runner';
import { OutboxRelay } from './outbox-relay';

describe('OutboxRunner.drain', () => {
  it('runs one more pass for a caller arriving while a pass is under way, and no more', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let passes = 0;
    const spy = jest.spyOn(OutboxRelay.prototype, 'runOnce').mockImplementation(async () => {
      passes += 1;
      if (passes === 1) await gate;
      return { published: 0, failed: 0 };
    });
    const runner = new OutboxRunner({} as never, new OutboxRegistry(), { OUTBOX_POLL_MS: 0 } as never);
    const first = runner.drain();
    const second = runner.drain();
    const third = runner.drain();
    expect(passes).toBe(1);
    release();
    await Promise.all([first, second, third]);
    expect(passes).toBe(2);
    spy.mockRestore();
  });
});
