import { Queue } from 'bullmq';
import { bullConnection, usingMemoryRedis } from '../config/redis.js';

/**
 * Central registry of BullMQ queues. Producers add jobs here; the worker
 * process (src/worker.js) consumes them. Keeping queue names in one place
 * avoids typos between producer and consumer.
 */
export const QUEUE_NAMES = {
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  AUDIT: 'audit',
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

// Queues require a real broker; skip instantiation in memory-redis mode.
export const emailQueue = usingMemoryRedis
  ? null
  : new Queue(QUEUE_NAMES.EMAIL, { connection: bullConnection, defaultJobOptions });

export const notificationQueue = usingMemoryRedis
  ? null
  : new Queue(QUEUE_NAMES.NOTIFICATION, { connection: bullConnection, defaultJobOptions });

/** Enqueue a templated email. Falls back to a direct send if the queue is down. */
export async function enqueueEmail(payload) {
  try {
    if (!emailQueue) throw new Error('queue disabled');
    await emailQueue.add('send', payload);
  } catch {
    const { sendMail } = await import('../notifications/mail.service.js');
    await sendMail(payload).catch(() => {});
  }
}

export async function closeQueues() {
  await Promise.allSettled([emailQueue?.close(), notificationQueue?.close()].filter(Boolean));
}

export default { emailQueue, notificationQueue, enqueueEmail, QUEUE_NAMES };
