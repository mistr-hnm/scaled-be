import { Router ,Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { ApiResponse, User } from "@scaled-be/types";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, pid: process.pid, ts: Date.now() });
});


// LIST users — simple paginated query, no caching needed at this scale
router.get("/api/users", async (req: Request, res: Response, next: NextFunction) => {
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
router.get("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
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
router.post("/api/users", async (req: Request, res: Response, next: NextFunction) => {
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
router.put("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
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
router.delete("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
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