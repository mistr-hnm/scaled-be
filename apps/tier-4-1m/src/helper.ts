import { redisCircuit } from "./cb";
import { redisCluster } from "./db";

// ─── Cache Helpers ────────────────────────────────────────
const CACHE_TTL = 120;
export const userKey = (id: number | string) => `u:${id}`; // short key = less memory

export const cacheGetWithCircuit = async <T>(key: string): Promise<T | null> => {
  return redisCircuit.execute(
    async () => {
      const val = await redisCluster.get(key);
      return val ? (JSON.parse(val) as T) : null;
    },
    () => null // fallback: cache miss (go to DB)
  );
};

export const cacheSetWithCircuit = async (key: string, value: unknown, ttl = CACHE_TTL) => {
  return redisCircuit.execute(
    async () => redisCluster.setEx(key, ttl, JSON.stringify(value)),
    () => undefined // fallback: skip caching (not fatal)
  );
};


// ─── Metrics ──────────────────────────────────────────────
// Simple Prometheus-compatible counters. In production use prom-client.
export const metrics = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  dbQueries: 0,
  errors: 0,
};