
// ─── DB Sharding Strategy ─────────────────────────────────
// At 1M req/s, even read replicas hit limits. We shard the DB:
// user IDs 1-50M → shard 0, 50M-100M → shard 1, etc.
// Each shard is an independent Postgres cluster with its own replicas.

import { Pool } from "pg";
import { createCluster } from "redis"; // R
import { logger } from "./logger";

export const DB_SHARDS = [
  new Pool({ host: "pg-shard-0", database: "postgres", user: "postgres", password: "postgres", max: 20 }),
  new Pool({ host: "pg-shard-1", database: "postgres", user: "postgres", password: "postgres", max: 20 }),
];
export const DB_REPLICA_SHARDS = [
  new Pool({ host: "pg-shard-0-replica", database: "postgres", user: "postgres", password: "postgres", max: 30 }),
  new Pool({ host: "pg-shard-1-replica", database: "postgres", user: "postgres", password: "postgres", max: 30 }),
];

// ─── Redis Cluster ────────────────────────────────────────
// Redis Cluster shards keys across multiple nodes (3 primary + 3 replica by default).
// Gives you ~3x the throughput and memory of a single Redis instance.
export const redisCluster = createCluster({
  rootNodes: [
    { url: "redis://redis-node-1:6379" },
    { url: "redis://redis-node-2:6379" },
    { url: "redis://redis-node-3:6379" },
  ],
  defaults: { socket: { reconnectStrategy: (r: any) => Math.min(r * 50, 2000) } },
});
redisCluster.connect().catch((err: any) => logger.error({ err }, "Redis Cluster connect failed"));

// Shard routing: modulo by number of shards
export const getWriteShard  = (userId: number): Pool => DB_SHARDS[userId % DB_SHARDS.length];
export const getReadShard   = (userId: number): Pool => DB_REPLICA_SHARDS[userId % DB_REPLICA_SHARDS.length];
