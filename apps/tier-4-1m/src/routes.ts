import { Router } from "express";
import { getReadShard, getWriteShard, redisCluster } from "./db";
import { User } from "@scaled-be/types";
import { cacheGetWithCircuit, cacheSetWithCircuit, metrics, userKey } from "./helper";
import { dbCircuit } from "./cb";
import { WriteQueue } from "./writequeue";

export const router = Router();
const writeQueue = new WriteQueue();
 
// ─── GET /api/users/:id ───────────────────────────────────
router.get("/api/users/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // 1. Try cache first
    const cached = await cacheGetWithCircuit<User>(userKey(id));
    if (cached) {
      metrics.cacheHits++;
      res.setHeader("x-cache", "HIT");
      return res.json({ data: cached });
    }

    metrics.cacheMisses++;

    // 2. Route to correct DB shard
    const { rows } = await dbCircuit.execute(() => {
      metrics.dbQueries++;
      return getReadShard(id).query<User>(
        "SELECT id, name, email, created_at FROM users WHERE id=$1",
        [id]
      );
    });

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // 3. Populate cache asynchronously (don't block response)
    cacheSetWithCircuit(userKey(id), rows[0]).catch(() => {});

    res.setHeader("x-cache", "MISS");
    res.json({ data: rows[0] });
  } catch (err) {
    metrics.errors++;
    next(err);
  }
});

// ─── POST /api/users ──────────────────────────────────────
// Write goes into queue → batched into DB every 50ms
router.post("/api/users", async (req, res, next) => {
  try {
    const { name, email } = req.body as { name: string; email: string };

    const user = await writeQueue.enqueue({
      type: "create",
      payload: { name, email },
      timestamp: Date.now(),
    });

    res.status(201).json({ data: user });
  } catch (err: any) {
    metrics.errors++;
    if (err.code === "23505") return res.status(409).json({ error: "Email taken" });
    next(err);
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────
router.put("/api/users/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, email } = req.body as { name: string; email: string };

    const { rows } = await dbCircuit.execute(() => {
      metrics.dbQueries++;
      return getWriteShard(id).query<User>(
        `UPDATE users SET name=$1, email=$2, updated_at=NOW()
         WHERE id=$3 RETURNING id, name, email, created_at`,
        [name, email, id]
      );
    });

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // Invalidate cache on update
    redisCluster.del(userKey(id)).catch(() => {});

    res.json({ data: rows[0] });
  } catch (err) {
    metrics.errors++;
    next(err);
  }
});

// ─── DELETE /api/users/:id ───────────────────────────────
router.delete("/api/users/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rowCount } = await dbCircuit.execute(() =>
      getWriteShard(id).query("DELETE FROM users WHERE id=$1", [id])
    );

    if (!rowCount) return res.status(404).json({ error: "Not found" });

    redisCluster.del(userKey(id)).catch(() => {});
    res.status(204).send();
  } catch (err) {
    metrics.errors++;
    next(err);
  }
});