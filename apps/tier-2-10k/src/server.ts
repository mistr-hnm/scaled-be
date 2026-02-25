/**
 * ─────────────────────────────────────────────────────────
 *  TIER 2 — 10,000 requests/second
 *  Stack: Cluster + TypeScript + Express + pg + compression
 *  Target: Growing apps, moderate traffic
 *  Hardware: 1 server, 8 CPU cores, 8GB RAM
 * ─────────────────────────────────────────────────────────
 *
 *  NEW vs TIER 1:
 *  ✅ Node.js Cluster — use ALL CPU cores (8x throughput)
 *  ✅ Compression — GZIP responses (70-80% less bandwidth)
 *  ✅ Helmet — security headers
 *  ✅ Rate limiting — protect from abuse
 *  ✅ Structured logging with Pino (async, non-blocking)
 *  ✅ Bigger connection pool (20 per worker)
 *  ✅ Graceful shutdown
 */

import cluster from "cluster";
import os from "os";

const NUM_CPUS = os.cpus().length; // 8 on a typical 8-core server

if (cluster.isPrimary) {
  console.log(`[Primary] PID ${process.pid} — forking ${NUM_CPUS} workers`);

  for (let i = 0; i < NUM_CPUS; i++) {
    cluster.fork();
  }

  // Auto-restart dead workers — zero downtime on crashes
  cluster.on("exit", (worker, code, signal) => {
    console.warn(`[Primary] Worker ${worker.process.pid} died (${signal || code}) — restarting`);
    cluster.fork();
  });

} else {
  // Each worker independently imports and runs the Express app
  console.log(`[Worker] PID ${process.pid} booting`);
  require("./app");
}


/**
 * ─── TIER 2 SUMMARY ──────────────────────────────────────
 *
 *  ✅ What's new:
 *     - Cluster: 8 workers × ~1.5k req/s = ~10k req/s total
 *     - Parallel DB queries with Promise.all
 *     - Pino structured logging (async, 5x faster than console)
 *     - Compression, Helmet, Rate limiting
 *     - Graceful shutdown
 *
 *  ❌ Still missing (not needed yet):
 *     - Redis caching
 *     - Load balancer (still one server)
 *     - Read replicas
 *
 *  📊 Benchmark targets:
 *     - Latency p99: < 30ms
 *     - Throughput:  10,000 req/s
 *     - DB connections: 160 (20 × 8 workers)
 *     - Servers needed: 1 (8-core)
 *
 *  🔧 postgresql.conf changes needed:
 *     max_connections = 200
 *     shared_buffers = 2GB
 */
