/** 
 * ─────────────────────────────────────────────────────────
 * SPIKE TEST — "Can it handle sudden traffic bursts?"
 *
 * Real-world scenario: your app gets featured on HackerNews,
 * or a sale starts at midnight, or a celebrity tweets your link.
 * Traffic goes from 10 → 1000 users in SECONDS, not minutes.
 *
 * This test checks two things:
 *   1. Does the server survive the spike?
 *   2. Does it recover when the spike ends?
 *
 * Run:
 *   k6 run k6/spike-test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const latency   = new Trend("latency");

// ─── Spike Test Stages ────────────────────────────────────
//
//  VUs
//  500 |          ████
//  400 |          █  █
//  300 |          █  █
//  200 |          █  █
//  100 |          █  █
//   10 |██████████    ███████████    ██████████
//    0 └─────────────────────────────────────── time
//        0  1m   2m   3m   4m   5m   6m   7m   8m
//           ^    ^         ^    ^
//           │    spike     │    spike
//           normal         recover
//
export const options = {
  stages: [
    { duration: "1m",  target: 10  },  // Normal baseline: 10 users
    { duration: "10s", target: 500 },  // SPIKE: 10 → 500 in 10 seconds ← very fast!
    { duration: "1m",  target: 500 },  // Hold spike for 1 minute
    { duration: "10s", target: 10  },  // Drop back to 10
    { duration: "1m",  target: 10  },  // Recovery check: do metrics return to normal?
    { duration: "10s", target: 500 },  // Second spike — can it handle a repeat?
    { duration: "1m",  target: 500 },  // Hold again
    { duration: "10s", target: 0   },  // Done
  ],

  thresholds: {
    errors:            ["rate<0.05"],  // allow up to 5% errors during spike (being lenient)
    http_req_duration: ["p(95)<2000"], // 95% under 2s during spike
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const roll = Math.random();

  if (roll < 0.75) {
    const res = http.get(`${BASE_URL}/api/users?limit=10`);
    const ok = check(res, {
      "list ok": (r) => r.status === 200,
    });
    latency.add(res.timings.duration);
    errorRate.add(!ok);

  } else if (roll < 0.9) {
    const id  = Math.ceil(Math.random() * 10000);
    const res = http.get(`${BASE_URL}/api/users/${id}`);
    check(res, { "get ok": (r) => r.status === 200 || r.status === 404 });
    latency.add(res.timings.duration);

  } else {
    const rand = Math.random().toString(36).slice(2, 10);
    const res  = http.post(
      `${BASE_URL}/api/users`,
      JSON.stringify({ name: `Spike ${rand}`, email: `spike.${rand}@test.com` }),
      { headers: { "Content-Type": "application/json" } }
    );
    check(res, { "create ok": (r) => r.status === 201 });
    latency.add(res.timings.duration);
  }

  sleep(0.1 + Math.random() * 0.2);
}

/*
 * ─── WHAT TO LOOK FOR IN SPIKE RESULTS ───────────────────
 *
 * Good result (server handled the spike):
 * ─────────────────────────────────────
 *   Normal (10 VUs):  p99=15ms,  errors=0%
 *   Spike  (500 VUs): p99=350ms, errors=1%   ← latency went up but survived
 *   Recovery (10 VUs):p99=18ms,  errors=0%   ← ✅ returned to normal
 *
 * Bad result (server couldn't handle it):
 * ───────────────────────────────────────
 *   Normal (10 VUs):  p99=15ms,  errors=0%
 *   Spike  (500 VUs): p99=30s,   errors=40%  ← ❌ server overwhelmed
 *   Recovery (10 VUs):p99=2s,    errors=5%   ← ❌ didn't fully recover!
 *
 * If recovery is slow or incomplete, check:
 *   - Are DB connections stuck? (pg pool might not release them fast enough)
 *   - Is memory not being freed? (GC pressure from the spike)
 *   - Are there any stuck async operations?
 */