import { Pool } from "pg";

// ─── Database Pools ───────────────────────────────────────
// At 100k req/s, a single Postgres server becomes the bottleneck.
// Solution: route WRITES to primary, READS to replica(s).
// PgBouncer sits in front of each and limits real connections to ~100.

// PRIMARY — writes only (INSERT, UPDATE, DELETE)
export const primaryPool = new Pool({
  host:     process.env.DB_PRIMARY_HOST || "pgbouncer",
  port:     Number(process.env.DB_PORT) || 6432,
  database: process.env.DB_NAME        || "myapp_primary",
  user:     process.env.DB_USER        || "postgres",
  password: process.env.DB_PASSWORD    || "postgres",
  max: 10, // PgBouncer handles the heavy pooling — keep this low
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// REPLICA — reads only (SELECT). You can add more replicas and round-robin.
export const replicaPool = new Pool({
  host:     process.env.DB_REPLICA_HOST || "pgbouncer",
  port:     Number(process.env.DB_PORT) || 6432,
  database: process.env.DB_NAME        || "myapp_replica",
  user:     process.env.DB_USER        || "postgres",
  password: process.env.DB_PASSWORD    || "postgres",
  max: 20, // replicas can handle more reads
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
