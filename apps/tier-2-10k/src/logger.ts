import pino from "pino";

// ─── Logger ───────────────────────────────────────────────
// Pino is ~5x faster than console.log — async, JSON structured
export const logger = pino({
  level     : process.env.LOG_LEVEL || "info",
  transport : process.env.NODE_ENV !== "production"
                ? { target: require.resolve("pino-pretty") }  // dev: human readable
                : undefined,                  // prod: raw JSON for log aggregators
});

