import { createApp } from './app';
import { env } from './config/env';
import { registerCouriers } from './couriers/register';
import { connectDb, disconnectDb } from './db/prisma';
import { startBulkWorker, stopBulkWorker } from './batches/queue';
import { logger } from './common/logger';

async function main(): Promise<void> {
  registerCouriers();
  await connectDb();

  if (env.BULK_MODE === 'worker') {
    await startBulkWorker();
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, bulk_mode: env.BULK_MODE, env: env.NODE_ENV },
      'Courier integration API listening',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await stopBulkWorker();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
