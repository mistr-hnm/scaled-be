
import { Pool } from "pg";
import { logger } from "./logger";


// ─── DB Pool ──────────────────────────────────────────────
// 20 connections per worker × 8 workers = 160 total DB connections
// Make sure postgres max_connections >= 200 in postgresql.conf
export const pool = new Pool({
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