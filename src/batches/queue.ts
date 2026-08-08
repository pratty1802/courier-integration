import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../common/logger';
import { batchService } from './batch.service';

export type BulkJobData = {
  batchId: string;
  batchItemId: string;
};

const QUEUE_NAME = 'bulk-orders';

let queue: Queue<BulkJobData> | null = null;
let worker: Worker<BulkJobData> | null = null;

function redisConnection() {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL required for worker mode');
  }
  return { url: env.REDIS_URL };
}

export function getBulkQueue(): Queue<BulkJobData> {
  if (!queue) {
    queue = new Queue<BulkJobData>(QUEUE_NAME, { connection: redisConnection() });
  }
  return queue;
}

export async function enqueueBulkItems(jobs: BulkJobData[]): Promise<void> {
  const q = getBulkQueue();
  await q.addBulk(
    jobs.map((data) => ({
      name: 'process-item',
      data,
      opts: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
      },
    })),
  );
}

export async function startBulkWorker(): Promise<void> {
  if (env.BULK_MODE !== 'worker') return;
  if (worker) return;

  worker = new Worker<BulkJobData>(
    QUEUE_NAME,
    async (job: Job<BulkJobData>) => {
      await batchService.processItem(job.data.batchItemId, `worker-${job.id ?? 'unknown'}`);
      const remaining = await import('../db/prisma').then(({ prisma }) =>
        prisma.batchItem.count({
          where: {
            batchId: job.data.batchId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
        }),
      );
      if (remaining === 0) {
        const { prisma } = await import('../db/prisma');
        await prisma.batch.update({
          where: { id: job.data.batchId },
          data: { status: 'COMPLETED' },
        });
      }
    },
    {
      connection: redisConnection(),
      concurrency: env.BULK_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ job_id: job?.id, err }, 'Bulk worker job failed');
  });

  logger.info({ concurrency: env.BULK_CONCURRENCY }, 'Bulk worker started');
}

export async function stopBulkWorker(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
