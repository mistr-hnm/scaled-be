/**
 * ─────────────────────────────────────────────────────────
 *  TIER 1 — 1,000 requests/second
 *  Stack: Node.js + TypeScript + Express + PostgreSQL (pg)
 *  Target: Small apps, MVPs, internal tools
 *  Hardware: 1 server, 2 CPU cores, 2GB RAM
 * ─────────────────────────────────────────────────────────
 *
 *  WHY THIS IS ENOUGH AT 1K:
 *  - Single process handles ~1k req/s easily on modern hardware
 *  - pg.Pool manages DB connections efficiently
 *  - No caching needed — DB can keep up
 *  - Simple, easy to debug and maintain
 */

import express from "express"; 
import helmet from "helmet";
import compression from "compression";
import { dbCircuit, redisCircuit } from "./cb";
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

// ─── Health + Metrics endpoints ───────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    circuits: {
      redis: redisCircuit.getState(),
      db:    dbCircuit.getState(),
    },
  });
});

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
 