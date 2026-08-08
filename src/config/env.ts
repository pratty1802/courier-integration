import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BULK_MODE: z.enum(['poll', 'worker']).default('worker'),
  BULK_CONCURRENCY: z.coerce.number().int().positive().default(10),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  API_KEYS: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_BULK_MAX: z.coerce.number().int().positive().default(10),
  URBANEBOLT_BASE_URL: z.string().url().default('https://uat.urbanebolt.in'),
  URBANEBOLT_USERNAME: z.string().default(''),
  URBANEBOLT_PASSWORD: z.string().default(''),
  URBANEBOLT_CUSTOMER_CODE: z.string().default(''),
  URBANEBOLT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  URBANEBOLT_RETRY_COUNT: z.coerce.number().int().nonnegative().default(3),
  URBANEBOLT_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_OPEN_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
  }

  const env = parsed.data;
  if (env.BULK_MODE === 'worker' && !env.REDIS_URL) {
    throw new Error('REDIS_URL is required when BULK_MODE=worker');
  }

  return env;
}

export const env = loadEnv();

export const apiKeys = env.API_KEYS.split(',')
  .map((k) => k.trim())
  .filter(Boolean);

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
