import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger } from "./logger";
import { pool } from "./db";
import { router } from "./routes";

const app = express();

app.use(helmet()); // secure HTTP headers, near-zero overhead
app.use(compression()); // GZIP: 70-80% bandwidth reduction on JSON
app.use(express.json({ limit: "100kb" }));

// Rate limit per IP — 5000 req/min is generous but prevents abuse
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 5_000,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Request logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
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

app.use(router);

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
process.on("SIGINT", () => shutdown("SIGINT"));
