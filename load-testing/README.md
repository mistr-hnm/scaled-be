# Load Testing Guide
## How to test your Node.js API from 1k → 1M req/s

---

## What is Load Testing?

Load testing means sending a large number of HTTP requests to your API
**on purpose** to see how it behaves under pressure. You're trying to answer:

```
1. Throughput    → How many requests/second can it handle?
2. Latency       → How long does each request take? (p50, p95, p99)
3. Error rate    → At what point do requests start failing?
4. Breaking point → What load causes it to fall over completely?
```

---

## The Three Numbers That Matter

### p50 / p95 / p99 (Percentiles)

These are more useful than "average" latency.

```
Imagine 100 requests, sorted by how long they took:

10ms 10ms 11ms 12ms 12ms ... 15ms 15ms ... 80ms 200ms

p50 = 15ms  → 50% of requests finished in 15ms or less  (the "typical" user)
p95 = 50ms  → 95% finished in 50ms or less              (the "slow" user)
p99 = 200ms → 99% finished in 200ms or less             (the "very unlucky" user)
```

**Why not just use average?**
If 99 requests take 10ms and 1 request takes 10,000ms,
the average is 109ms — which misleads you. p99 = 10,000ms tells the truth.

### Throughput (req/s)
How many requests your server completed per second. Higher = better.

### Error Rate
What % of requests returned a 5xx error or timed out. Target: 0%.

---

## Three Tools We Use

| Tool | Best for | Language |
|---|---|---|
| **k6** | Realistic scenarios, thresholds, CI/CD | JavaScript |
| **autocannon** | Quick terminal benchmarks | Node.js CLI |
| **Artillery** | Long soak tests, YAML config | YAML/JS |

---

## Test Types (Run Them in This Order)

```
1. Smoke Test      → 1-5 users, 30s    — does it work at all?
2. Load Test       → Target users, 5m  — does it work at normal load?
3. Stress Test     → 2x-5x users, 10m  — where does it start breaking?
4. Spike Test      → 0 → 10x → 0, 2m  — can it handle sudden traffic?
5. Soak Test       → Normal load, 24h  — does it leak memory over time?
```

---

## Reading Your Results

```
✅ Good server:                    ❌ Struggling server:
─────────────────────────          ──────────────────────────────
p50:  5ms                          p50:  200ms
p95:  20ms                         p95:  2,000ms   ← 100x worse!
p99:  50ms                         p99:  10,000ms  ← timeouts
errors: 0%                         errors: 15%
req/s: 8,000                       req/s: 500      ← fell over
```

---

## Files in This Guide

```
load-testing/
├── README.md                     ← You are here
│
├── scripts/
│   └── seed.ts                   ← Seeds 10,000 users into your DB for testing
│
├── k6/
│   ├── smoke-test.js             ← Quick sanity check (5 users)
│   ├── load-test.js              ← Normal load simulation
│   ├── stress-test.js            ← Ramp up until it breaks
│   └── spike-test.js             ← Sudden traffic surge
│
├── autocannon/
│   └── benchmark.ts              ← Quick terminal benchmark
│
├── artillery/
│   ├── load-test.yml             ← Long soak test config
│   └── payload.json              ← Sample user data for POST requests
│
└── results/
    └── how-to-read-results.md    ← What the numbers mean
```