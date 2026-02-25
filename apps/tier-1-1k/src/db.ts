
import { Pool } from "pg";

// ─── Database Pool ────────────────────────────────────────
// At 1k req/s, a pool of 10 connections is plenty.
// Each query resolves in ~1-5ms, so connections recycle fast.
export const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "postgres",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "postgres",

  max: 10,                    // 10 connections is fine at this tier
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});
