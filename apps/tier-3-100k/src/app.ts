/**
 * ─────────────────────────────────────────────────────────
 *  TIER 3 — 100,000 requests/second
 *  Stack: Cluster + Redis Cache + Read Replicas + PgBouncer
 *  Target: High-traffic production apps
 *  Hardware: 3+ app servers behind a load balancer
 * ─────────────────────────────────────────────────────────
 *
 *  NEW vs TIER 2:
 *  ✅ Redis caching — serve GET requests without hitting DB
 *  ✅ Read replica pool — writes go to primary, reads to replica
 *  ✅ PgBouncer — proxy that limits real DB connections (see config below)
 *  ✅ Cache-aside pattern — check Redis first, fallback to DB
 *  ✅ Cache invalidation on write — keep data consistent
 *  ✅ Cursor-based pagination — replaces slow OFFSET
 *  ✅ Request ID tracking — trace requests across services
 */

import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { randomUUID } from "crypto";
import pino from "pino";
import { router } from "./routes";
import { primaryPool, replicaPool } from "./db";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "100kb" }));

// Attach request ID for distributed tracing
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  const start = process.hrtime.bigint();
  res.setHeader("x-request-id", requestId);
  (req as any).requestId = requestId;
  res.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - start) / 1_000_000;

    logger.info({
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
});

app.use(router);

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => logger.info(`Worker ${process.pid} on :${PORT}`));

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  server.close(async () => {
    await primaryPool.end();
    await replicaPool.end();
    process.exit(0);
  });
});

/**
 * ─── TIER 3 SUMMARY ──────────────────────────────────────
 *
 *  ✅ What's new:
 *     - Redis cache: ~0.1ms reads vs ~5ms DB queries
 *     - Primary/Replica split: writes & reads are independent
 *     - PgBouncer: caps real DB connections at 100 (see pgbouncer.ini below)
 *     - Cursor pagination: O(1) regardless of depth
 *     - Cache invalidation on every write
 *
 *  📊 Benchmark targets:
 *     - Latency p99 (cache hit):  < 5ms
 *     - Latency p99 (cache miss): < 30ms
 *     - Throughput: 100,000 req/s (across 3+ servers)
 *     - DB connections: ~100 real connections via PgBouncer
 *     - Servers: 3 app servers + load balancer + Redis + Postgres primary + replica
 *
 *  🔧 PgBouncer config (pgbouncer.ini):
 *
 *     [databases]
 *     postgres = host=postgres-primary port=5432 dbname=postgres
 *
 *     [pgbouncer]
 *     pool_mode = transaction        ← transaction-level pooling (most efficient)
 *     max_client_conn = 1000         ← accept up to 1000 client connections
 *     default_pool_size = 100        ← but only open 100 real Postgres connections
 *     reserve_pool_size = 10
 *
 *  🏗️  Infrastructure:
 *     nginx (load balancer)
 *       ├── App Server 1 (8 workers)
 *       ├── App Server 2 (8 workers)
 *       └── App Server 3 (8 workers)
 *             │
 *          PgBouncer
 *             ├── Postgres Primary  (writes)
 *             └── Postgres Replica  (reads)
 *             Redis Cluster
 */
