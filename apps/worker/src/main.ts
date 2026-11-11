import { Worker } from 'bullmq';

/**
 * Process shell only. Job handlers (outbox relay, reconciliation, reservation
 * expiry) arrive with the persistence step and will call backend application contracts.
 */
function main(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('Invalid environment configuration: REDIS_URL');
  const { hostname, port, password } = new URL(redisUrl);

  const worker = new Worker(
    'system',
    async (job) => {
      throw new Error(`No handler registered for job: ${job.name}`);
    },
    { connection: { host: hostname, port: Number(port || 6379), password: password || undefined } },
  );

  const shutdown = (): void => void worker.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
