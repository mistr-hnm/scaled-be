

// ─── Redis Cache ──────────────────────────────────────────
// Redis serves cached responses in ~0.1ms vs ~5ms DB query.
// At 100k req/s, even 50% cache hit rate halves your DB load.
import { createClient, RedisClientType } from "redis";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });


export const redis: RedisClientType = createClient({
  url: process.env.REDIS_URL || "redis://redis:6379",
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
  },
});
redis.connect().catch((err) => logger.error({ err }, "Redis connect failed"));
redis.on("error", (err) => logger.error({ err }, "Redis error"));

// ─── Cache Helpers ────────────────────────────────────────
const CACHE_TTL = 60; // seconds — tune based on how fresh data needs to be

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  try {
    const val = await redis.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null; // cache miss on error — degrade gracefully, never crash
  }
};

export const cacheSet = async (key: string, value: unknown, ttl = CACHE_TTL): Promise<void> => {
  try {
    await redis.setEx(key, ttl, JSON.stringify(value));
  } catch (err) {
    logger.warn({ err }, "Cache set failed"); // non-fatal
  }
};

export const cacheDel = async (...keys: string[]): Promise<void> => {
  try {
    await redis.del(keys);
  } catch (err) {
    logger.warn({ err }, "Cache delete failed");
  }
};

// Cache key helpers — namespaced to avoid collisions
export const userKey      = (id: number | string) => `user:${id}`;
export const userListKey  = (cursor: number, limit: number) => `users:list:${cursor}:${limit}`;
