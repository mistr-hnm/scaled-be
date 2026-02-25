/**
 * ─────────────────────────────────────────────────────────
 * LOAD TEST — "Does it work at normal expected traffic?"
 *
 * Simulates realistic production traffic:
 *  - 80% reads (GET)
 *  - 15% creates (POST)
 *  - 5%  updates/deletes (PUT/DELETE)
 *
 * Ramps up gradually, holds steady, then ramps down.
 * This mimics how real traffic actually behaves.
 *
 * Run:
 *   k6 run k6/load-test.js
 *   k6 run --env TARGET_VUS=200 k6/load-test.js   ← increase load
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Rate, Trend, Gauge } from "k6/metrics";
import { SharedArray } from "k6/data";

// ─── Pre-loaded Test Data ─────────────────────────────────
// SharedArray is loaded ONCE and shared across all VUs (memory efficient).
// In a real test, you'd load this from a CSV file.
// Here we generate it inline.
const existingUserIds = new SharedArray("user_ids", function () {
  // IDs 1-10000 — assumes you ran the seed script first
  return Array.from({ length: 10_000 }, (_, i) => i + 1);
});

// ─── Test Config ─────────────────────────────────────────
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || "300");

export const options = {
  // Stages define HOW the load changes over time
  stages: [
    { duration: "30s", target: TARGET_VUS },      // Ramp UP: 0 → 50 VUs over 30s
    { duration: "3m",  target: TARGET_VUS },      // HOLD: stay at 50 VUs for 3 minutes
    { duration: "30s", target: 0 },               // Ramp DOWN: 50 → 0 VUs
  ],
  // Total: ~4 minutes

  thresholds: {
    http_req_failed:   ["rate<0.01"],    // < 1% error rate
    http_req_duration: ["p(95)<300"],    // 95th percentile under 300ms
    http_req_duration: ["p(99)<1000"],   // 99th percentile under 1s
    "group_duration{group:::GET requests}":  ["p(95)<200"],
    "group_duration{group:::POST requests}": ["p(95)<500"],
  },
};

// ─── Custom Metrics ───────────────────────────────────────
const errorRate     = new Rate("errors");
const cacheHitRate  = new Rate("cache_hits");     // tracks x-cache: HIT header
const getTime       = new Trend("get_duration");
const postTime      = new Trend("post_duration");
const activeUsers   = new Gauge("active_users");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// ─── Helper: pick a random existing user ID ───────────────
function randomUserId() {
  return existingUserIds[Math.floor(Math.random() * existingUserIds.length)];
}

// ─── Helper: generate a unique new user ───────────────────
function newUserPayload() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return JSON.stringify({
    name:  `Test User ${rand}`,
    email: `test.${rand}.${ts}@loadtest.com`,
  });
}

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

// ─── Main Test Function ───────────────────────────────────
export default function () {
  activeUsers.add(1);

  // Distribute traffic like real production:
  // 80% reads, 15% creates, 5% updates
  const roll = Math.random();

  if (roll < 0.80) {
    // ── READ scenario (80% of traffic) ─────────────────
    group("GET requests", () => {
      const innerRoll = Math.random();

      if (innerRoll < 0.6) {
        // 60% → GET list (most common: users browsing a list)
        const page  = Math.ceil(Math.random() * 10);
        const limit = 20;
        const res = http.get(`${BASE_URL}/api/users?page=${page}&limit=${limit}`);

        const ok = check(res, {
          "list → 200":        (r) => r.status === 200,
          "list → has data":   (r) => !!JSON.parse(r.body).data,
          "list → not empty":  (r) => JSON.parse(r.body).data?.length > 0,
        });

        // Track if response came from cache (Tier 3+)
        if (res.headers["X-Cache"] === "HIT") {
          cacheHitRate.add(1);
        } else {
          cacheHitRate.add(0);
        }

        getTime.add(res.timings.duration);
        errorRate.add(!ok);

      } else {
        // 40% → GET single user (users viewing a profile)
        const userId = randomUserId();
        const res = http.get(`${BASE_URL}/api/users/${userId}`);

        const ok = check(res, {
          "get one → 200 or 404": (r) => r.status === 200 || r.status === 404,
          "get one → has body":   (r) => r.body.length > 0,
        });

        if (res.headers["X-Cache"] === "HIT") {
          cacheHitRate.add(1);
        } else {
          cacheHitRate.add(0);
        }

        getTime.add(res.timings.duration);
        errorRate.add(!ok);
      }
    });

  } else if (roll < 0.95) {
    // ── CREATE scenario (15% of traffic) ───────────────
    group("POST requests", () => {
      const res = http.post(`${BASE_URL}/api/users`, newUserPayload(), JSON_HEADERS);

      const ok = check(res, {
        "create → 201":      (r) => r.status === 201,
        "create → has id":   (r) => !!JSON.parse(r.body).data?.id,
        "create → has email":(r) => !!JSON.parse(r.body).data?.email,
      });

      postTime.add(res.timings.duration);
      errorRate.add(!ok);
    });

  } else {
    // ── UPDATE scenario (5% of traffic) ────────────────
    group("PUT requests", () => {
      const userId = randomUserId();
      const rand   = Math.random().toString(36).slice(2, 6);
      const res = http.put(
        `${BASE_URL}/api/users/${userId}`,
        JSON.stringify({ name: `Updated User ${rand}`, email: `updated.${rand}@test.com` }),
        JSON_HEADERS
      );
      
      const checkRes = check(res, {
        "update → 200 or 404": (r) => r.status === 200 || r.status === 404,
      });

      if (!checkRes) {
        console.log(`Update failed with status: ${res.status}`);
      }
    });
  }

  // Think time: simulate user pausing between actions
  // randomSleep(0.1, 0.5) = pause between 100ms and 500ms
  sleep(0.1 + Math.random() * 0.4);
}

/*
 * ─── HOW TO READ THE OUTPUT ──────────────────────────────
 *
 * k6 prints this at the end:
 *
 *   ✓ checks.........................: 99.85% ✓ 14977 ✗ 23
 *   data_received..................: 4.2 MB 17 kB/s
 *   data_sent......................: 890 kB 3.6 kB/s
 *
 *   ✓ errors........................: 0.15%  (below 1% threshold ✅)
 *   ✓ cache_hits....................: 68.00% (68% served from Redis)
 *
 *   get_duration...................:
 *     avg=12ms  min=2ms  med=9ms  max=280ms  p(90)=28ms  p(95)=45ms  ← p95 < 300ms ✅
 *
 *   post_duration..................:
 *     avg=22ms  min=8ms  med=19ms max=340ms  p(90)=45ms  p(95)=68ms  ← p95 < 500ms ✅
 *
 *   http_req_duration (all)........:
 *     avg=14ms  min=2ms  med=10ms max=340ms  p(90)=30ms  p(95)=52ms
 *
 *   http_reqs......................: 15000   62/s   ← 62 requests/second with 50 VUs
 *   vus............................: 50      min=0  max=50
 *   vus_max........................: 50
 *
 * ✓ all thresholds passed
 *
 *
 * ─── WHAT TO LOOK FOR ────────────────────────────────────
 *
 *  http_reqs/s  → your throughput. Higher = better.
 *  p(95)        → latency most users experience. Target < 300ms for web APIs.
 *  p(99)        → worst-case latency. Should stay below 1s.
 *  errors       → should be 0% or very close.
 *  cache_hits   → higher % means Redis is doing its job.
 *
 *  WARNING SIGNS:
 *  - p(95) climbing over time → memory leak or connection pool saturation
 *  - error rate above 0.1%   → something is failing under load
 *  - req/s dropping suddenly  → server is falling over (look at server logs)
 */