import { EventEmitter } from "events";
import { logger } from "./logger";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

// ─── Circuit Breaker ──────────────────────────────────────
// Prevents cascade failures: if DB/Redis is down, fail fast
// instead of queuing up thousands of requests that will all timeout.
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly threshold = 5,        // failures before OPEN (5 row failure)
    private readonly timeout = 30_000,     // ms before trying HALF_OPEN (30s time takes to retry)
    private readonly successThreshold = 3  // successes in HALF_OPEN to CLOSE (3 request will try after 30s)
  ) {
    super();
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = "HALF_OPEN";
        logger.info(`Circuit ${this.name}: HALF_OPEN — testing`);
      } else {
        if (fallback) return fallback();
        throw new Error(`Circuit ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      if (fallback) return fallback();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = "CLOSED";
        this.successCount = 0;
        logger.info(`Circuit ${this.name}: CLOSED — recovered`);
      }
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.successCount = 0;
      logger.error(`Circuit ${this.name}: OPEN — failing fast`);
      this.emit("open");
    }
  }

  getState() { return this.state; }
}



export const dbCircuit = new CircuitBreaker("postgres", 3, 20_000, 2);
export const redisCircuit = new CircuitBreaker("redis", 5, 30_000, 3);
