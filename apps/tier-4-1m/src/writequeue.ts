// ─── Simple In-Memory Queue (use Bull + Redis in production) ──
// At this tier, writes go into a queue. A background worker drains
// the queue and writes to DB in batches — much more efficient than

import { User } from "@scaled-be/types";
import { DB_SHARDS } from "./db";

// one-write-per-request at extreme volume.
interface WriteJob {
  type: "create" | "update" | "delete";
  payload: Partial<User>;
  timestamp: number;
  resolve: (val: User) => void;
  reject: (err: Error) => void;
}

export class WriteQueue {
  private queue: WriteJob[] = [];
  private flushing = false;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 50; // flush every 50ms

  constructor() {
    setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  enqueue(job: Omit<WriteJob, "resolve" | "reject">): Promise<User> {
    return new Promise<User>((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
    });
  }

  private async flush() {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    const batch = this.queue.splice(0, this.BATCH_SIZE);

    try {
      // Batch insert is dramatically faster than individual inserts
      const creates = batch.filter((j) => j.type === "create");

      if (creates.length > 0) {
        // Build multi-row INSERT
        const values: unknown[] = [];
        const placeholders = creates.map((job, i) => {
          const base = i * 2;
          values.push(job.payload.name, job.payload.email);
          return `($${base + 1}, $${base + 2})`;
        });

        // Use the appropriate shard (simplified — real sharding needs smarter routing)
        const { rows } = await DB_SHARDS[0].query<User>(
          `INSERT INTO users (name, email) VALUES ${placeholders.join(",")}
           RETURNING id, name, email, created_at`,
          values
        );

        creates.forEach((job, i) => job.resolve(rows[i]));
      }
    } catch (err) {
      batch.forEach((job) => job.reject(err as Error));
    } finally {
      this.flushing = false;
    }
  }
}

