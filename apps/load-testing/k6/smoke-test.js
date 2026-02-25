/**
 * ─────────────────────────────────────────────────────────
 * SMOKE TEST — "Does it even work?"
 *
 * Run this first, before any serious load testing.
 * Low load: 3 virtual users for 30 seconds.
 * If this fails, something is fundamentally broken.
 *
 * Install k6:  https://k6.io/docs/getting-started/installation/
 *   macOS:   brew install k6
 *   Linux:   sudo apt install k6
 *   Docker:  docker run -i grafana/k6 run - <smoke-test.js
 *
 * Run:
 *   k6 run k6/smoke-test.js
 *   k6 run --env BASE_URL=http://myserver.com k6/smoke-test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Custom Metrics ───────────────────────────────────────
// k6 tracks these separately so you can see them in the summary
const errorRate    = new Rate("error_rate");     // % of failed requests
const getLatency   = new Trend("get_latency");   // latency just for GETs
const postLatency  = new Trend("post_latency");  // latency just for POSTs

// ─── Test Config ─────────────────────────────────────────
export const options = {
  // Virtual Users (VUs) = concurrent users hammering your API
  vus: 3,          // 3 users at once — very light
  duration: "30s", // run for 30 seconds

  // Thresholds = PASS/FAIL criteria
  // If any threshold fails, k6 exits with code 1 (useful in CI/CD)
  thresholds: {
    http_req_failed:   ["rate<0.01"],   // less than 1% errors
    http_req_duration: ["p(95)<500"],   // 95% of requests under 500ms
    error_rate:        ["rate<0.01"],
  },
};

// ─── Base URL ─────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// ─── Sample POST payloads ─────────────────────────────────
// Realistic user data — using __VU (virtual user ID) and
// __ITER (iteration number) to make each email unique
function makeUser() {
  const firstNames = ["Alice", "Bob", "Carol", "David", "Eve", "Frank"];
  const lastNames  = ["Smith", "Jones", "Brown", "Davis", "Wilson"];
  const domains    = ["gmail.com", "yahoo.com", "outlook.com"];

  const first  = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last   = lastNames[Math.floor(Math.random() * lastNames.length)];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    name:  `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}.${unique}@${domain}`,
  };
}

// ─── Main Test Function ───────────────────────────────────
// k6 calls this function once per VU per iteration.
// With 3 VUs, it runs 3 copies of this function concurrently.
export default function () {

  // ── 1. GET list of users ──────────────────────────────
  const listRes = http.get(`${BASE_URL}/api/users?limit=10`);

  // check() returns true/false and records the result
  const listOk = check(listRes, {
    "GET /users → 200":          (res) => res.status === 200,
    "GET /users → has data key": (res) => JSON.parse(res.body).data !== undefined,
    "GET /users → fast (<200ms)":(res) => res.timings.duration < 200,
  });


  getLatency.add(listRes.timings.duration);
  errorRate.add(!listOk);

  sleep(0.5); // wait 500ms between requests — simulates a real user, not a hammering robot

  // ── 2. GET single user (ID 1 — must exist after seeding) ─
  const getRes = http.get(`${BASE_URL}/api/users/100`); 
  

  check(getRes, {
    "GET /users/100 → 200":          (res) => res.status === 200,
    "GET /users/100 → has id field": (res) => JSON.parse(res.body).data?.id === 100,
  });

  getLatency.add(getRes.timings.duration);

  sleep(0.5);

  // ── 3. POST create a new user ─────────────────────────
  const newUser = makeUser();
  const postRes = http.post(
    `${BASE_URL}/api/users`,
    JSON.stringify(newUser),
    { headers: { "Content-Type": "application/json" } }
  );

  const postOk = check(postRes, {
    "POST /users → 201":           (r) => r.status === 201,
    "POST /users → returns id":    (r) => JSON.parse(r.body).data?.id !== undefined,
    "POST /users → correct email": (r) => JSON.parse(r.body).data?.email === newUser.email,
  });

  postLatency.add(postRes.timings.duration);
  errorRate.add(!postOk);

  sleep(1); // 1 second pause after creating — realistic pacing
}

/*
 * ─── EXPECTED OUTPUT ─────────────────────────────────────
  █ THRESHOLDS

    error_rate
    ✓ 'rate<0.01' rate=0.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=10.17ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%
  █ TOTAL RESULTS
    checks_total.......: 360     11.875821/s
    checks_succeeded...: 100.00% 360 out of 360
    checks_failed......: 0.00%   0 out of 360
    ✓ GET /users → 200
    ✓ GET /users → has data key
    ✓ GET /users → fast (<200ms)
    ✓ GET /users/100 → 200
    ✓ GET /users/100 → has id field
    ✓ POST /users → 201
    ✓ POST /users → returns id
    ✓ POST /users → correct email

    CUSTOM
    error_rate.....................: 0.00% 0 out of 90
    get_latency....................: avg=4.399099 min=0.739836 med=4.478027 max=7.246798  p(90)=5.932056  p(95)=6.434824
    post_latency...................: avg=8.551937 min=2.818564 med=9.064436 max=12.063456 p(90)=10.452742 p(95)=11.018904
    HTTP
    http_req_duration..............: avg=5.78ms   min=739.83µs med=5.27ms   max=12.06ms   p(90)=9.81ms    p(95)=10.17ms
      { expected_response:true }...: avg=5.78ms   min=739.83µs med=5.27ms   max=12.06ms   p(90)=9.81ms    p(95)=10.17ms
    http_req_failed................: 0.00% 0 out of 135
    http_reqs......................: 135   4.453433/s
    EXECUTION
    iteration_duration.............: avg=2.02s    min=2.01s    med=2.02s    max=2.02s     p(90)=2.02s     p(95)=2.02s
    iterations.....................: 45    1.484478/s
    vus............................: 3     min=3        max=3
    vus_max........................: 3     min=3        max=3

    NETWORK
    data_received..................: 91 kB 3.0 kB/s
    data_sent......................: 17 kB 559 B/s
running (0m30.3s), 0/3 VUs, 45 complete and 0 interrupted iterations
default ✓ [======================================] 3 VUs  30s

*/