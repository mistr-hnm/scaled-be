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
import { Pool, PoolClient } from "pg";

// ─── Types ────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  created_at: Date;
}

interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// ─── Database Pool ────────────────────────────────────────
// At 1k req/s, a pool of 10 connections is plenty.
// Each query resolves in ~1-5ms, so connections recycle fast.
const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "postgres",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "postgres",

  max: 10,                    // 10 connections is fine at this tier
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

// ─── App ──────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Attach pool to every request
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).db = pool;
  next();
});

// ─── Routes ───────────────────────────────────────────────

// LIST users — simple paginated query, no caching needed at this scale
app.get("/api/users", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { rows } = await pool.query<User>(
      `SELECT id, name, email, created_at
       FROM users
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ data: rows } satisfies ApiResponse<User[]>);
  } catch (err) {
    next(err);
  }
});

// GET single user
app.get("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query<User>(
      "SELECT id, name, email, created_at FROM users WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// CREATE user
app.post("/api/users", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body as { name: string; email: string };

    const { rows } = await pool.query<User>(
      `INSERT INTO users (name, email)
       VALUES ($1, $2)
       RETURNING id, name, email, created_at`,
      [name, email]
    );

    res.status(201).json({ data: rows[0] });
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "Email taken" });
    next(err);
  }
});

// UPDATE user
app.put("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body as { name: string; email: string };

    const { rows } = await pool.query<User>(
      `UPDATE users SET name=$1, email=$2, updated_at=NOW()
       WHERE id=$3
       RETURNING id, name, email, created_at`,
      [name, email, req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE user
app.delete("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM users WHERE id=$1",
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────
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
