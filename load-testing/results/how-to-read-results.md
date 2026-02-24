# How to Read Load Test Results
## A Plain-English Guide

---

## The Numbers You Care About

### 1. Throughput (req/s)
```
What it is:  How many requests your server COMPLETED per second.
Target:      As high as possible while other metrics stay healthy.

8,000 req/s  ← excellent for a single server
1,000 req/s  ← decent
100 req/s    ← something is likely wrong
10 req/s     ← definitely broken
```

### 2. Latency Percentiles
```
p50 = 10ms  → Half of all users got a response in 10ms or less
p95 = 45ms  → 95 out of 100 users got a response in 45ms or less
p99 = 200ms → 99 out of 100 users got a response in 200ms or less
max = 800ms → The slowest single request took 800ms

                50%   95%   99%   max
Excellent:     <10ms <50ms <200ms <1s
Good:          <30ms <150ms <500ms <2s
Acceptable:    <100ms <500ms <1s  <5s
Poor:          >200ms >1s   >3s   >10s
```

Why p99 matters more than average:
```
9 requests at 10ms + 1 request at 5000ms
Average = (9×10 + 5000) / 10 = 509ms  ← misleading!
p99 = 5000ms                           ← shows the real problem
```

### 3. Error Rate
```
0%      → Perfect
< 0.1%  → Great
< 1%    → Acceptable for most apps
< 5%    → Borderline — investigate
> 5%    → Something is broken — stop the test
```

---

## Anatomy of a k6 Output

```
✓ checks.........................: 99.85%  ← 99.85% of assertions passed
  data_received..................: 4.2 MB 17 kB/s
  data_sent......................: 890 kB 3.6 kB/s

  ✓ error_rate...................: 0.15%   ← below your 1% threshold ✅

  get_duration...................:
    avg=12ms           ← average (less useful)
    min=2ms            ← fastest request ever
    med=9ms            ← median (same as p50)
    max=280ms          ← slowest request ever
    p(90)=28ms         ← 90% of GETs under 28ms
    p(95)=45ms   ✅    ← 95% of GETs under 45ms (your threshold was 300ms)

  http_req_duration (all requests):
    avg=14ms  min=2ms  med=10ms  max=340ms  p(95)=52ms  p(99)=120ms

  http_req_failed................: 0.00%   ✓ 0 failed ✅
  http_reqs......................: 15,000  62/s        ← 62 requests/second

  vus............................: 50      min=0 max=50
  vus_max........................: 50
  iteration_duration.............: avg=1.4s            ← time per VU loop
```

---

## Spotting Problems in Results

### Problem 1: Latency Cliff
```
Suddenly latency jumps at a certain VU count:

50 VUs  → p99 = 20ms   ✅
100 VUs → p99 = 25ms   ✅
150 VUs → p99 = 30ms   ✅
200 VUs → p99 = 4000ms ❌  ← CLIFF at 200 VUs

Means: Your connection pool is exhausted at 200 VUs.
Fix:   Increase pool max, or add PgBouncer.
```

### Problem 2: Latency Drift (Soak Test)
```
Hour 1  → p99 = 20ms
Hour 4  → p99 = 35ms
Hour 8  → p99 = 80ms   ← slowly climbing
Hour 16 → p99 = 400ms  ← now noticeable
Hour 24 → crash        ← out of memory

Means: Memory leak. Something is accumulating over time.
Fix:   Use --inspect flag + clinic.js to find the leak.
       Common causes: unclosed DB clients, growing arrays,
       event listener accumulation.
```

### Problem 3: High Error Rate Under Spike
```
Normal load: errors = 0%
Spike to 5x: errors = 40%

Means: Server cannot queue requests fast enough.
Fix:   Add a queue (Bull/BullMQ), increase server count,
       or add circuit breaker to fail fast instead of pile up.
```

### Problem 4: Throughput Plateaus
```
100 VUs → 5,000 req/s
200 VUs → 5,100 req/s   ← barely increased
500 VUs → 5,050 req/s   ← adding users does nothing

Means: Server is CPU-bound or I/O-bound — you've hit the limit.
Fix:   Add more server instances (horizontal scaling).
       Use cluster if CPU-bound.
       Use faster DB queries / add cache if I/O-bound.
```

---

## Comparing Before vs After

Always run the same test before AND after making a change to prove it helped.

```
Before adding Redis cache:
  p99 = 180ms
  req/s = 2,400
  DB connections: 95/100 (near limit)

After adding Redis cache:
  p99 = 12ms   ← 15x faster
  req/s = 8,200 ← 3.4x more throughput
  DB connections: 20/100 (mostly serving from cache)

✅ Change proven effective.
```

---

## Quick Command Reference

```bash
# k6 — install
brew install k6                         # macOS
sudo apt install k6                     # Ubuntu

# k6 — run
k6 run smoke-test.js
k6 run --vus 100 --duration 60s load-test.js
k6 run --env BASE_URL=http://prod.example.com load-test.js

# k6 — output to JSON for later analysis
k6 run --out json=results/output.json load-test.js

# Autocannon — quick one-liner benchmarks
npx autocannon -c 50 -d 30 http://localhost:3000/api/users
npx autocannon -c 100 -d 60 -m POST -H "content-type=application/json" \
  -b '{"name":"Test","email":"t@t.com"}' http://localhost:3000/api/users

# Artillery — run test
npx artillery run artillery/load-test.yml
npx artillery run --output results/out.json artillery/load-test.yml
npx artillery report results/out.json       # generates HTML report

# While tests run — watch server health
watch -n 2 'curl -s http://localhost:3000/health'
watch -n 2 'ps aux | grep node | awk "{print \$6/1024 \" MB\"}"'
```

---

## Recommended Test Sequence

```
Step 1: Run seed.ts          → populate 10,000 users
Step 2: Run smoke-test.js    → confirm API works (2 min)
Step 3: Run load-test.js     → confirm normal load is fine (5 min)
Step 4: Run stress-test.js   → find your breaking point (14 min)
Step 5: Note the breaking point, improve your architecture
Step 6: Repeat steps 2-4 to confirm improvement
Step 7: Run spike-test.js    → confirm resilience to bursts
Step 8: Run soak (artillery) → confirm no memory leaks (24h)
```