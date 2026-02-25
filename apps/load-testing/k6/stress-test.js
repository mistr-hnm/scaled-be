/** 
 * ─────────────────────────────────────────────────────────
 * STRESS TEST — "Where does it break?"
 *
 * Keeps ramping up load until the server starts failing.
 * This tells you your server's MAXIMUM capacity and
 * what breaks first when it does.
 *
 * ⚠️  This WILL make your server struggle. Don't run against production.
 *
 * Run:
 *   k6 run k6/stress-test.js
 *
 * Watch in another terminal:
 *   watch -n 1 'ps aux | grep node'        ← CPU usage
 *   watch -n 1 'free -h'                   ← Memory
 *   watch -n 1 'ss -s'                     ← Network connections
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const latency   = new Trend("latency");

// ─── Stress Test Stages ───────────────────────────────────
//
// Visual representation:
//
//  VUs
//  500 |                         ████
//  400 |                    █████    █
//  300 |               █████              (server likely struggling here)
//  200 |          █████
//  100 |     █████
//   50 |█████
//    0 └──────────────────────────────── time
//        0   2m  4m  6m  8m  10m 12m 14m
//
export const options = {
  stages: [
    { duration: "2m", target: 50  },  // Normal load — baseline
    { duration: "2m", target: 100 },  // Double — starting to push
    { duration: "2m", target: 200 },  // Heavy — watch for latency increase
    { duration: "2m", target: 300 },  // Very heavy — errors may appear
    { duration: "2m", target: 400 },  // Extreme — likely struggling
    { duration: "2m", target: 500 },  // Maximum attempt
    { duration: "2m", target: 0   },  // Ramp down — does it recover?
  ],

  // No hard thresholds here — we WANT to find where it fails.
  // We observe, not enforce.
  thresholds: {
    // Just record — don't fail the test run
    http_req_duration: ["p(99)<0"],  // always "fails" — just collects data
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

function randomId(max = 10000) {
  return Math.ceil(Math.random() * max);
}

export default function () {
  // Mix of reads and writes
  const roll = Math.random();

  if (roll < 0.7) {
    // 70% GET single user
    const res = http.get(`${BASE_URL}/api/users/${randomId()}`);
    const ok = check(res, {
      "status 200 or 404": (r) => r.status === 200 || r.status === 404,
    });
    latency.add(res.timings.duration);
    errorRate.add(!ok);

  } else if (roll < 0.9) {
    // 20% GET list
    const res = http.get(`${BASE_URL}/api/users?limit=20&page=${Math.ceil(Math.random() * 50)}`);
    check(res, { "list 200": (r) => r.status === 200 });
    latency.add(res.timings.duration);

  } else {
    // 10% POST
    const rand = Math.random().toString(36).slice(2, 10);
    const res = http.post(
      `${BASE_URL}/api/users`,
      JSON.stringify({ name: `Stress ${rand}`, email: `stress.${rand}@test.com` }),
      { headers: { "Content-Type": "application/json" } }
    );
    check(res, { "create 201": (r) => r.status === 201 });
    latency.add(res.timings.duration);
  }

  sleep(0.05); // minimal think time — aggressive load
}

/*
 * ─── HOW TO INTERPRET STRESS TEST RESULTS ────────────────
 *
 * Look for the INFLECTION POINT — the VU count where things change:
 *
 *  Stage 1 (50 VUs):   p99=20ms,  errors=0%     ← comfortable
 *  Stage 2 (100 VUs):  p99=35ms,  errors=0%     ← still fine
 *  Stage 3 (200 VUs):  p99=120ms, errors=0%     ← getting warm
 *  Stage 4 (300 VUs):  p99=800ms, errors=2%  ← ⚠️ BREAKING POINT
 *  Stage 5 (400 VUs):  p99=4s,    errors=18%    ← falling over
 *  Stage 6 (500 VUs):  p99=30s,   errors=45%    ← down
 *  Recovery (0 VUs):   p99=15ms,  errors=0%  ← ✅ recovered cleanly
 *
 * In this example, the server handles up to 200 VUs well.
 * At 300 VUs, latency spikes and errors appear.
 * Your capacity is somewhere around 200-300 VUs.
 *
 * What breaks at the inflection point?
 * Check your server logs. Common causes:
 *
 *   "too many connections"     → pg.Pool max is too low, or Postgres hit max_connections
 *   "timeout acquiring client" → pool.connectionTimeoutMillis too short
 *   "ECONNRESET"               → server ran out of file descriptors (ulimit -n)
 *   CPU at 100%                → need more workers / more servers
 *   Memory climbing            → memory leak (use --inspect + clinic.js to diagnose)
 *
 * ─── After finding the break point ───────────────────────
 *
 * Now you know your limit. Go back to your architecture:
 * - If limit is ~200 VUs on Tier 1 → add clustering (Tier 2)
 * - If limit is ~500 VUs on Tier 2 → add Redis cache (Tier 3)
 * - etc.
 *
 * Re-run this test after each improvement to verify it actually helped.
 */