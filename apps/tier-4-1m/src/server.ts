/**
 * ─────────────────────────────────────────────────────────
 *  TIER 4 — 1,000,000 requests/second
 *  Stack: Microservices + Redis Cluster + Message Queue
 *         + Horizontal Auto-scaling + Partitioned DB
 *  Target: Large-scale production (think Stripe, Shopify scale)
 *  Hardware: 10-50 app servers, managed cloud infra
 * ─────────────────────────────────────────────────────────
 *
 *  NEW vs TIER 3:
 *  ✅ Write-behind caching (async DB writes via message queue)
 *  ✅ Redis Cluster (sharded across multiple Redis nodes)
 *  ✅ Database sharding / partitioning strategy
 *  ✅ Async job processing with Bull queue
 *  ✅ Circuit breaker pattern (fail fast, don't cascade)
 *  ✅ Health checks with graceful degradation
 *  ✅ Metrics endpoint (Prometheus-compatible)
 */

import express from "express"; 
import helmet from "helmet";
import compression from "compression";
import { metrics } from "./helper";
import { router } from "./routes";

const app = express();
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "100kb" }));

// Metrics middleware
app.use((_req, _res, next) => {
  metrics.requests++;
  next();
});

app.use(router);

app.get("/metrics", (_req, res) => {
  // Prometheus text format (real prom-client does this properly)
  const out = [
    `# HELP http_requests_total Total HTTP requests`,
    `http_requests_total ${metrics.requests}`,
    `cache_hits_total ${metrics.cacheHits}`,
    `cache_misses_total ${metrics.cacheMisses}`,
    `db_queries_total ${metrics.dbQueries}`,
    `errors_total ${metrics.errors}`,
  ].join("\n");

  res.set("Content-Type", "text/plain").send(out);
});
 