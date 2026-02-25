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

import express, { Request, Response, NextFunction } from "express";
import { router } from "./routes";

const app = express();
app.use(express.json());
  
app.use(router);

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
 
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Tier 1 server running on :${PORT}`));

/**
 * ─── TIER 1 SUMMARY ──────────────────────────────────────
 *
 *  ✅ What you get:
 *     - Simple single-process Express server
 *     - pg.Pool with 10 connections (recycles fast at this load)
 *     - TypeScript for type safety
 *     - Handles ~1,000 req/s comfortably
 *
 *  ❌ What's missing (not needed yet):
 *     - Clustering (single core is fine)
 *     - Caching (DB handles the load)
 *     - Load balancer (one server is enough)
 *     - Read replicas (one DB is fine)
 *
 *  📊 Benchmark targets:
 *     - Latency p99: < 50ms
 *     - Throughput:  1,000 req/s
 *     - DB connections: 10
 *     - Servers needed: 1
 */
