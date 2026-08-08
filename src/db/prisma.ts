import { PrismaClient } from '../generated/prisma';
import { env } from '../config/env';
import { logger } from '../common/logger';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export async function connectDb(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
