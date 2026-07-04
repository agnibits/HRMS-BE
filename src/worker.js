import { Worker } from 'bullmq';
import { bullConnection, connectRedis } from './config/redis.js';
import { QUEUE_NAMES } from './queues/index.js';
import { sendMail } from './notifications/mail.service.js';
import { logger } from './config/logger.js';

/**
 * Background worker process. Run separately from the API (`npm run worker`) so
 * job processing scales independently and never blocks the request path.
 */
await connectRedis();

const emailWorker = new Worker(
  QUEUE_NAMES.EMAIL,
  async (job) => {
    await sendMail(job.data);
  },
  { connection: bullConnection, concurrency: 10 }
);

emailWorker.on('completed', (job) => logger.debug({ jobId: job.id }, 'email job completed'));
emailWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'email job failed'));

logger.info('✅ Worker started (email)');

async function shutdown() {
  logger.info('Worker shutting down…');
  await emailWorker.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
