# Tier-by-Tier Load Testing Guide
# Run these IN ORDER. Each tier builds on the last.
# ─────────────────────────────────────────────────────────────

# ══════════════════════════════════════════════════════════════
# BEFORE ANYTHING: Seed your database
# ══════════════════════════════════════════════════════════════
npx ts-node scripts/seed.ts
# Expected output:
#   ✅ Inserted 10,000 users in 4.2s
#   ⚡ Insert rate: 2380 rows/sec



# ══════════════════════════════════════════════════════════════
# TIER 1 — 1,000 req/s
# Single process, no cluster, pg.Pool(10)
# ══════════════════════════════════════════════════════════════

# Start your Tier 1 server first:
#   npx ts-node tier-1-1k/server.ts

# Step 1: Smoke test — does it work at all?
k6 run \
  --vus 3 \
  --duration 30s \
  k6/smoke-test.js

# Expected: p99 < 100ms, 0 errors, ~30-50 req/s

# ─────────────────────────────────────────────────────────────

# Step 2: Find your actual throughput
npx autocannon \
  --connections 10 \
  --duration 30 \
  http://localhost:3000/api/users

# Expected for Tier 1:
#   Req/sec: 800 - 1,500
#   Latency p99: < 50ms
#   Errors: 0

# ─────────────────────────────────────────────────────────────

# Step 3: Load test at target (1k req/s ≈ 20 VUs with minimal think time)
k6 run \
  --vus 20 \
  --duration 2m \
  --env BASE_URL=http://localhost:3000 \
  k6/load-test.js

# Expected:
#   req/s: ~1,000      ✅  
#   p99:   < 100ms     ✅
#   errors: 0%         ✅

# ─────────────────────────────────────────────────────────────

# Step 4: Push until it breaks (find the ceiling)
k6 run \
  --env BASE_URL=http://localhost:3000 \
  k6/stress-test.js

# What to watch for on Tier 1:
#   Around 30-60 VUs, you'll see p99 start climbing
#   This is because 1 process = 1 CPU core = bottleneck
#   Error: "ECONNRESET" or pool timeout = you hit the wall
#
# WRITE DOWN: "Tier 1 broke at _____ VUs = _____ req/s"
# This is your baseline to compare against Tier 2.



# ══════════════════════════════════════════════════════════════
# TIER 2 — 10,000 req/s
# Cluster (8 workers), bigger pool, compression
# ══════════════════════════════════════════════════════════════

# Stop Tier 1. Start Tier 2 server:
#   npx ts-node tier-2-10k/server.ts

# Step 1: Quick benchmark — compare directly to Tier 1 result
npx autocannon \
  --connections 50 \
  --duration 30 \
  http://localhost:3000/api/users

# Expected for Tier 2 (vs Tier 1):
#   Req/sec: 5,000 - 12,000  (vs 800-1500 on Tier 1)
#   Latency p99: < 30ms
#   Errors: 0

# ─────────────────────────────────────────────────────────────

# Step 2: Load test at target (10k req/s ≈ 100 VUs)
k6 run \
  --vus 100 \
  --duration 3m \
  --env BASE_URL=http://localhost:3000 \
  k6/load-test.js

# Expected:
#   req/s: ~8,000-12,000   ✅
#   p99:   < 50ms          ✅
#   errors: 0%             ✅

# ─────────────────────────────────────────────────────────────

# Step 3: Stress test — push Tier 2 until IT breaks
# Edit stress-test.js stages to go higher: up to 800-1000 VUs
k6 run \
  --env BASE_URL=http://localhost:3000 \
  k6/stress-test.js

# Expected break point for Tier 2:
#   Around 200-500 VUs, DB connections saturate
#   Error: "timeout acquiring client from pool"
#   Fix that requires Tier 3: Redis cache + read replica

# ─────────────────────────────────────────────────────────────

# Step 4: Spike test — can it handle sudden bursts?
k6 run \
  --env BASE_URL=http://localhost:3000 \
  k6/spike-test.js

# Expected on Tier 2:
#   Spike survives (cluster queues connections)
#   p99 spikes to ~300ms during burst, returns to normal ✅

# ─────────────────────────────────────────────────────────────

# Step 5: Compare compression gain (Tier 2 specific)
# Without Accept-Encoding (no compression):
npx autocannon \
  --connections 50 \
  --duration 15 \
  --headers "Accept-Encoding=identity" \
  http://localhost:3000/api/users

# With compression (default browser behaviour):
npx autocannon \
  --connections 50 \
  --duration 15 \
  --headers "Accept-Encoding=gzip" \
  http://localhost:3000/api/users

# You'll see data_received drop by ~70% with gzip.
# req/s stays the same but bandwidth usage drops massively.



# ══════════════════════════════════════════════════════════════
# TIER 3 — 100,000 req/s
# Redis cache + Read replica + PgBouncer + Cursor pagination
# Requires: Redis running locally or Docker
# ══════════════════════════════════════════════════════════════

# Start Redis (if not running):
#   docker run -d -p 6379:6379 redis:alpine

# Start Tier 3 server:
#   npx ts-node tier-3-100k/server.ts

# Step 1: Verify cache is working
curl -v http://localhost:3000/api/users/1
# First call → x-cache: MISS  (went to DB)
curl -v http://localhost:3000/api/users/1
# Second call → x-cache: HIT  (came from Redis ✅)

# ─────────────────────────────────────────────────────────────

# Step 2: Benchmark GET with cache warmed up
# Run once to warm the cache, then benchmark
curl http://localhost:3000/api/users/1 > /dev/null  # warm up

npx autocannon \
  --connections 200 \
  --duration 30 \
  http://localhost:3000/api/users/1   # same ID = always cache HIT

# Expected with Redis cache:
#   Req/sec: 20,000 - 50,000  ← cache serves these, DB not involved
#   Latency p99: < 5ms        ← Redis is FAST
#   Errors: 0

# ─────────────────────────────────────────────────────────────

# Step 3: Load test with realistic mixed traffic
k6 run \
  --vus 300 \
  --duration 3m \
  --env BASE_URL=http://localhost:3000 \
  k6/load-test.js

# Watch the x-cache headers in k6 output:
# cache_hits rate → should be 60-80% after warmup
# This means 60-80% of requests never touch your DB!

# ─────────────────────────────────────────────────────────────

# Step 4: Prove cache reduces DB load
# In another terminal, watch DB connections WHILE test runs:
watch -n 1 'psql -U postgres -c \
  "SELECT count(*) as active_connections \
   FROM pg_stat_activity WHERE state='"'"'active'"'"'"'

# Without cache (Tier 2): connections stay near pool max
# With cache (Tier 3):    connections stay LOW (most served from Redis)

# ─────────────────────────────────────────────────────────────

# Step 5: Cursor vs OFFSET pagination speed comparison
# OFFSET (slow on large tables):
npx autocannon \
  --connections 50 --duration 15 \
  "http://localhost:3000/api/users?page=500&limit=20"
# Gets slower as page number increases

# Cursor (always fast):
npx autocannon \
  --connections 50 --duration 15 \
  "http://localhost:3000/api/users?cursor=9980&limit=20"
# Same speed regardless of depth ✅



# ══════════════════════════════════════════════════════════════
# TIER 4 — 1,000,000 req/s
# Redis Cluster + DB Sharding + Circuit Breaker + Write Queue
#
# NOTE: You cannot hit 1M req/s on a single laptop.
# This tier needs multiple machines. We test what we CAN test:
# - Circuit breaker behaviour
# - Write batching efficiency
# - Sharding routing logic
# ══════════════════════════════════════════════════════════════

# For local testing of Tier 4, use Docker Compose to simulate
# the infrastructure (see docker-compose.yml below)

# Step 1: Test circuit breaker — kill Redis, see fast failure
# Start server, run normal load:
k6 run --vus 50 --duration 30s k6/load-test.js
# p99 = ~10ms (normal)

# Now kill Redis mid-test:
docker stop redis

# Observe in k6:
# p99 should stay LOW (5-20ms) even though Redis is down
# This is the circuit breaker failing fast instead of waiting 30s
# Requests fall through to DB — slower but NOT broken

# Restart Redis:
docker start redis
# After ~30s, circuit closes, Redis serves again automatically ✅

# ─────────────────────────────────────────────────────────────

# Step 2: Test write batching throughput vs Tier 1
# Single writes (Tier 1 style — one INSERT per request):
npx autocannon \
  --connections 100 \
  --duration 30 \
  --method POST \
  --header "content-type: application/json" \
  --body '{"name":"Test User","email":"test@batch.com"}' \
  http://localhost:3000/api/users
# Tier 1 write: ~500-1000 writes/sec

# Batched writes (Tier 4 — 100 rows per INSERT every 50ms):
# Tier 4 write: ~5,000-10,000 writes/sec (same endpoint, batched internally)

# ─────────────────────────────────────────────────────────────

# Step 3: Check metrics endpoint (Tier 4 adds Prometheus metrics)
curl http://localhost:3000/metrics
# Expected output:
#   http_requests_total 15420
#   cache_hits_total 11234
#   cache_misses_total 4186
#   db_queries_total 4186
#   errors_total 0

# Cache hit rate = 11234 / 15420 = 72.8% ← target > 80%

# ─────────────────────────────────────────────────────────────

# Step 4: Simulate at scale with multiple processes
# Since one laptop ≠ 50 servers, use Node cluster + high VUs
k6 run \
  --vus 500 \
  --duration 5m \
  --env BASE_URL=http://localhost:3000 \
  k6/load-test.js

# Your laptop won't hit 1M req/s but you CAN validate:
# ✅ Circuit breakers work
# ✅ Cache hit rate is high
# ✅ Error rate stays 0%
# ✅ Write batching is faster than Tier 3



# ══════════════════════════════════════════════════════════════
# RESULTS TRACKING TABLE
# Fill this in as you test each tier
# ══════════════════════════════════════════════════════════════

# | Tier | VUs tested | req/s  | p99    | Errors | Break point |
# |------|-----------|--------|--------|--------|-------------|
# | 1    | 20        | _____  | _____  | _____% | _____ VUs   |
# | 2    | 100       | _____  | _____  | _____% | _____ VUs   |
# | 3    | 300       | _____  | _____  | _____% | _____ VUs   |
# | 4    | 500       | _____  | _____  | _____% | _____ VUs   |
#
# Each tier should show clearly better numbers than the one before.
# If Tier 2 isn't significantly better than Tier 1 → your bottleneck
# is NOT the CPU (cluster didn't help) → it's something else (DB, network).