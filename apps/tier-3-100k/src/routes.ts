import { Router } from "express";

import {
  cacheDel,
  cacheGet,
  cacheSet,
  redis,
  userKey,
  userListKey,
} from "./redis";
import { primaryPool, replicaPool } from "./db";
import { User } from "@scaled-be/types";

export const router = Router();

// routes
router.get("/health", async (_req, res) => {
  const [pgPrimary, pgReplica, redisOk] = await Promise.allSettled([
    primaryPool.query("SELECT 1"),
    replicaPool.query("SELECT 1"),
    redis.ping(),
  ]);

  res.json({
    ok: true,
    services: {
      db_primary: pgPrimary.status === "fulfilled" ? "ok" : "down",
      db_replica: pgReplica.status === "fulfilled" ? "ok" : "down",
      redis: redisOk.status === "fulfilled" ? "ok" : "down",
    },
  });
});

// ─── LIST — cursor pagination (replaces slow OFFSET) ──────
// OFFSET scans N rows every time. At page 10000, that's 200k rows scanned.
// Cursor pagination always scans from the last seen ID — O(1) regardless of depth.
router.get("/api/users", async (req, res, next) => {
  try {
    const cursor = Number(req.query.cursor) || 0; // last seen ID
    const limit = Math.min(100, Number(req.query.limit) || 20);

    // Check Redis first
    const cacheKey = userListKey(cursor, limit);
    const cached = await cacheGet<User[]>(cacheKey);

    if (cached) {
      res.setHeader("x-cache", "HIT");
      return res.json({
        data: cached,
        next_cursor: cached[cached.length - 1]?.id ?? null,
      });
    }

    // Miss → query REPLICA (not primary — reads don't need the freshest data)
    const { rows } = await replicaPool.query<User>(
      `SELECT id, name, email, created_at
       FROM users
       WHERE id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [cursor, limit],
    );

    await cacheSet(cacheKey, rows, 30); // short TTL for list — changes frequently

    res.setHeader("x-cache", "MISS");
    res.json({
      data: rows,
      next_cursor: rows[rows.length - 1]?.id ?? null, // client passes this as ?cursor= next time
    });
  } catch (err) {
    next(err);
  }
});


router.get("/api/users/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Check cache
    const cached = await cacheGet<User>(userKey(id));
    if (cached) {
      res.setHeader("x-cache", "HIT");
      return res.json({ data: cached });
    }

    // 2. Read from replica
    const { rows } = await replicaPool.query<User>(
      "SELECT id, name, email, created_at FROM users WHERE id=$1",
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // 3. Populate cache for next time
    await cacheSet(userKey(id), rows[0]);

    res.setHeader("x-cache", "MISS");
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});


router.post("/api/users", async (req, res, next) => {
  try {
    const { name, email } = req.body as { name: string; email: string };

    const { rows } = await primaryPool.query<User>(
      `INSERT INTO users (name, email)
       VALUES ($1, $2)
       RETURNING id, name, email, created_at`,
      [name, email],
    );

    // Invalidate list caches — they're now stale
    // (We use a pattern delete; in production use Redis SCAN or a cache tag system)
    await cacheDel(`users:list:0:20`); // invalidate most common first page
    res.status(201).json({ data: rows[0] });
  } catch (err: any) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email taken" });
    next(err);
  }
});


router.put("/api/users/:id", async (req, res, next) => {
  try {
    const { name, email } = req.body as { name: string; email: string };
    const { id } = req.params;

    const { rows } = await primaryPool.query<User>(
      `UPDATE users SET name=$1, email=$2, updated_at=NOW()
       WHERE id=$3 RETURNING id, name, email, created_at`,
      [name, email, id],
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // Invalidate this user's cache entry
    await cacheDel(userKey(id));

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});


router.delete("/api/users/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rowCount } = await primaryPool.query(
      "DELETE FROM users WHERE id=$1",
      [id],
    );
    if (!rowCount) return res.status(404).json({ error: "Not found" });

    await cacheDel(userKey(id));

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}); 
