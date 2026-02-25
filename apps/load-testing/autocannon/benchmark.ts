/**
 * autocannon/benchmark.ts
 * ─────────────────────────────────────────────────────────
 * AUTOCANNON — Quick terminal benchmarks
 *
 * Autocannon is a Node.js-native tool — no extra install beyond npm.
 * Perfect for:
 *   - Quick "before vs after" comparison when you make a change
 *   - Testing a specific endpoint in isolation
 *   - Getting a rough req/s number fast
 *
 * Install:
 *   npm install autocannon
 *   npm install -D @types/autocannon
 *
 * Run:
 *   npx ts-node autocannon/benchmark.ts
 *   npx ts-node autocannon/benchmark.ts --endpoint users --connections 100
 */

import autocannon from "autocannon";

// ─── Config ───────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL    || "http://localhost:3000";
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "50"); // concurrent connections
const DURATION    = parseInt(process.env.DURATION    || "30"); // seconds
const ENDPOINT    = process.env.ENDPOINT              || "all";

// ─── Sample POST body ─────────────────────────────────────
function makeUserBody() {
  const rand = Math.random().toString(36).slice(2, 10);
  return JSON.stringify({
    name:  `Bench User ${rand}`,
    email: `bench.${rand}@autocannon.com`,
  });
}

// ─── Run a single benchmark ───────────────────────────────
function runBenchmark(config: autocannon.Options): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(config, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });

    // Print progress to console in real-time
    autocannon.track(instance, { renderProgressBar: true });
  });
}

// ─── Print results in a readable table ───────────────────
function printResults(label: string, result: autocannon.Result) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  📊 ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  Connections:    ${result.connections}`);
  console.log(`  Duration:       ${result.duration}s`);
  console.log(`  Total requests: ${result.requests.total.toLocaleString()}`);
  console.log(`  Req/sec:        ${result.requests.mean.toFixed(0)} avg`);
  console.log(`                  ${result.requests.max.toFixed(0)} max`);
  console.log(`\n  Latency:`);
  console.log(`    p50  = ${result.latency.p50}ms`);
  console.log(`    p75  = ${result.latency.p75}ms`);
  console.log(`    p90  = ${result.latency.p90}ms`);
  console.log(`    p99  = ${result.latency.p99}ms`);
  console.log(`    max  = ${result.latency.max}ms`);
  console.log(`\n  Errors: ${result.errors} (${((result.errors / result.requests.total) * 100).toFixed(2)}%)`);
  console.log(`  Timeouts: ${result.timeouts}`);
  console.log(`  Throughput: ${(result.throughput.mean / 1024).toFixed(1)} KB/s avg`);
  console.log(`${"─".repeat(60)}`);

  // Simple pass/fail
  const p99ok   = result.latency.p99 < 500;
  const errorsOk = result.errors === 0;
  const rpsOk   = result.requests.mean > 100;

  console.log(`\n  ${p99ok    ? "✅" : "❌"} p99 < 500ms   (actual: ${result.latency.p99}ms)`);
  console.log(`  ${errorsOk  ? "✅" : "❌"} Zero errors    (actual: ${result.errors})`);
  console.log(`  ${rpsOk     ? "✅" : "❌"} > 100 req/s    (actual: ${result.requests.mean.toFixed(0)})`);
}

// ─── Benchmarks ───────────────────────────────────────────
async function main() {
  console.log(`\n🔥 Autocannon Benchmark`);
  console.log(`   Target:      ${BASE_URL}`);
  console.log(`   Connections: ${CONNECTIONS} concurrent`);
  console.log(`   Duration:    ${DURATION}s per test\n`);

  const common = {
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    pipelining: 1,       // HTTP pipelining — 1 = normal, >1 = aggressive
    timeout: 10,         // request timeout in seconds
  };

  // ── 1. GET /api/users (list) ───────────────────────────
  if (ENDPOINT === "all" || ENDPOINT === "list") {
    console.log("\n🧪 Test 1: GET /api/users (list endpoint)");
    const listResult = await runBenchmark({
      ...common,
      url: `${BASE_URL}/api/users?limit=20`,
    });
    printResults("GET /api/users?limit=20", listResult);
  }

  // ── 2. GET /api/users/:id (single) ────────────────────
  if (ENDPOINT === "all" || ENDPOINT === "users") {
    console.log("\n🧪 Test 2: GET /api/users/1 (single user)");
    const singleResult = await runBenchmark({
      ...common,
      url: `${BASE_URL}/api/users/1`,
    });
    printResults("GET /api/users/1", singleResult);
  }

  // ── 3. POST /api/users (create) ───────────────────────
  // For POST, we need to vary the body to avoid duplicate email errors.
  // autocannon supports a "requests" array that cycles through bodies.
  if (ENDPOINT === "all" || ENDPOINT === "post") {
    console.log("\n🧪 Test 3: POST /api/users (create user)");

    // Pre-generate 1000 unique bodies to cycle through
    const bodies = Array.from({ length: 1000 }, () => makeUserBody());
    let bodyIndex = 0;

    const postResult = await runBenchmark({
      ...common,
      method: "POST",
      // autocannon "requests" lets you cycle through different request configs
      requests: bodies.map((body) => ({
        method: "POST" as const,
        path: "/api/users",
        headers: { "content-type": "application/json" },
        body,
      })),
    });
    printResults("POST /api/users", postResult);
  }

  // ── 4. Mixed workload ──────────────────────────────────
  if (ENDPOINT === "all" || ENDPOINT === "mixed") {
    console.log("\n🧪 Test 4: Mixed workload (80% GET, 20% POST)");

    // Build 1000 requests: 800 GETs + 200 POSTs, shuffled
    const requests: autocannon.Request[] = [];

    for (let i = 0; i < 800; i++) {
      const id = Math.ceil(Math.random() * 10000);
      requests.push({ method: "GET", path: `/api/users/${id}` });
    }
    for (let i = 0; i < 200; i++) {
      requests.push({
        method: "POST",
        path: "/api/users",
        headers: { "content-type": "application/json" },
        body: makeUserBody(),
      });
    }

    // Shuffle the array
    for (let i = requests.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [requests[i], requests[j]] = [requests[j], requests[i]];
    }

    const mixedResult = await runBenchmark({
      ...common,
      url: BASE_URL,
      requests,
    });
    printResults("Mixed workload (80/20 GET/POST)", mixedResult);
  }

  console.log("\n✅ Benchmarks complete!\n");
}

main().catch(console.error);

/*
 * ─── EXAMPLE OUTPUT ──────────────────────────────────────
 *
 * Running 30s test @ http://localhost:3000/api/users?limit=20
 * 50 connections
 *
 * ┌─────────────┬──────┬──────┬───────┬───────┬──────────┬─────────┬───────┐
 * │ Stat        │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg      │ Stdev   │ Max   │
 * ├─────────────┼──────┼──────┼───────┼───────┼──────────┼─────────┼───────┤
 * │ Latency     │ 3ms  │ 5ms  │ 12ms  │ 18ms  │ 5.8ms    │ 2.9ms   │ 120ms │
 * └─────────────┴──────┴──────┴───────┴───────┴──────────┴─────────┴───────┘
 *
 * ┌────────────┬─────────┬─────────┬─────────┐
 * │ Stat       │  1%     │ 2.5%    │ 50%     │ 97.5%
 * ├────────────┼─────────┼─────────┼─────────┤
 * │ Req/Sec    │ 6820    │ 7100    │ 8200    │ 8500
 * │ Bytes/Sec  │ 2.1 MB  │ 2.2 MB  │ 2.5 MB  │ 2.6 MB
 * └────────────┴─────────┴─────────┴─────────┘
 *
 * Req/Bytes counts sampled once per second.
 * 246k requests in 30.1s, 74.9 MB read
 *
 * ─────────────────────────────────────────────
 *  📊 GET /api/users?limit=20
 * ─────────────────────────────────────────────
 *  Req/sec:       8200 avg
 *  Latency p50:   5ms
 *  Latency p99:   18ms
 *  Errors:        0 (0.00%)
 *
 *  ✅ p99 < 500ms   (actual: 18ms)
 *  ✅ Zero errors   (actual: 0)
 *  ✅ > 100 req/s   (actual: 8200)
 */