import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import pino from "pino";
import { User } from "./user.interface";

console.log("APP FILE LOADED", process.pid);


// ─── Logger ───────────────────────────────────────────────
// Pino is ~5x faster than console.log — async, JSON structured
const logger = pino({
  level     : process.env.LOG_LEVEL || "info",
  transport : process.env.NODE_ENV !== "production"
                ? { target: require.resolve("pino-pretty") }  // dev: human readable
                : undefined,                  // prod: raw JSON for log aggregators
});

// ─── DB Pool ──────────────────────────────────────────────
// 20 connections per worker × 8 workers = 160 total DB connections
// Make sure postgres max_connections >= 200 in postgresql.conf
const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "postgres",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "postgres",

  max: 20,                    // increased from tier 1
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => logger.error({ err }, "Idle pool client error"));

// ─── Express App ──────────────────────────────────────────
const app = express();

app.use(helmet());           // secure HTTP headers, near-zero overhead
app.use(compression());      // GZIP: 70-80% bandwidth reduction on JSON
app.use(express.json({ limit: "100kb" }));

// Rate limit per IP — 5000 req/min is generous but prevents abuse
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 5_000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Request logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log("finish");
    
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      pid: process.pid,
    });
  });
  next();
});

// Attach pool to requests
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).db = pool;
  next();
});


// ─── Routes ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, pid: process.pid, ts: Date.now() });
});

// LIST — still simple queries; DB handles 10k/s fine
app.get("/api/users", async (req, res, next) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<User>(
        `SELECT id, name, email, created_at FROM users
         ORDER BY id ASC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query<{ total: string }>(
        "SELECT COUNT(*) AS total FROM users"
      ),
    ]);
    // Run both queries in parallel — cuts latency roughly in half

    res.json({
      data: rows,
      meta: {
        total: Number(countRows[0].total),
        page,
        limit,
        pages: Math.ceil(Number(countRows[0].total) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/users/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query<User>(
      "SELECT id, name, email, created_at FROM users WHERE id=$1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

app.post("/api/users", async (req, res, next) => {
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

app.put("/api/users/:id", async (req, res, next) => {
  try {
    const { name, email } = req.body as { name: string; email: string };
    const { rows } = await pool.query<User>(
      `UPDATE users SET name=$1, email=$2, updated_at=NOW()
       WHERE id=$3 RETURNING id, name, email, created_at`,
      [name, email, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/users/:id", async (req, res, next) => {
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
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ─── Graceful Shutdown ────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Worker ${process.pid} listening`);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} — shutting down worker ${process.pid}`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));