import Redis from 'ioredis';
import { config } from '../config';

// Redis is optional — GitHub caching and token blacklisting degrade gracefully without it
const createRedis = (): Redis | null => {
  if (!config.REDIS_URL) return null;
  const client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
  client.on('error', (err) => console.error('Redis error:', err.message));
  return client;
};

export const redis = createRedis();

// No-op helpers used when Redis is unavailable
export async function redisGet(key: string): Promise<string | null> {
  return redis ? redis.get(key) : null;
}

export async function redisSetex(key: string, ttl: number, value: string): Promise<void> {
  if (redis) await redis.setex(key, ttl, value);
}

export async function redisExists(key: string): Promise<boolean> {
  return redis ? (await redis.exists(key)) === 1 : false;
}
