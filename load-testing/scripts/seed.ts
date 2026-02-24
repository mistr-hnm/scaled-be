/**
 * ─────────────────────────────────────────────────────────
 * Seeds your PostgreSQL database with realistic test data.
 * Run this BEFORE load testing so your GET endpoints have
 * real data to return.
 *
 * Usage:
 *   npx ts-node scripts/seed.ts
 *   npx ts-node scripts/seed.ts --count 100000
 *
 * What it creates:
 *   - 10,000 users by default (realistic names + emails)
 *   - Inserted in batches of 500 (fast, doesn't overwhelm DB)
 *   - Shows progress as it goes
 */

import { Pool } from "pg";

// ─── Config ───────────────────────────────────────────────
const TOTAL_USERS = parseInt(process.argv[3] || "10000");
const BATCH_SIZE  = 500; // insert 500 rows at a time

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "postgres",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max: 5,
});

// ─── Realistic Sample Data ────────────────────────────────
// Real first/last names make the test data look credible
// and exercise ILIKE search queries more realistically.
const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael",
  "Linda", "William", "Barbara", "David", "Elizabeth", "Richard", "Susan",
  "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Priya",
  "Ravi", "Amit", "Sonia", "Chen", "Wei", "Yuki", "Hana", "Carlos",
  "Sofia", "Miguel", "Isabella", "Ahmed", "Fatima", "Ali", "Zara",
  "Liam", "Emma", "Noah", "Olivia", "Ethan", "Ava", "Lucas", "Mia",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
  "Patel", "Kumar", "Singh", "Shah", "Sharma", "Gupta", "Chen", "Wang",
  "Kim", "Park", "Tanaka", "Suzuki", "Müller", "Schmidt", "Silva",
];

const DOMAINS = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "company.com", "corp.io", "tech.dev", "startup.co",
  "example.com", "test.org",
];

// ─── Data Generator ───────────────────────────────────────
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateUser(index: number): { name: string; email: string } {
  const firstName = randomItem(FIRST_NAMES);
  const lastName  = randomItem(LAST_NAMES);
  const domain    = randomItem(DOMAINS);

  const name  = `${firstName} ${lastName}`;
  // Add index to guarantee unique emails
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}`;

  return { name, email };
}

// ─── Batch Insert ─────────────────────────────────────────
async function insertBatch(
  users: Array<{ name: string; email: string }>,
  batchNum: number,
  totalBatches: number
): Promise<number> {
  // Build a single multi-row INSERT — much faster than individual inserts
  // VALUES ($1, $2), ($3, $4), ($5, $6), ...
  const placeholders: string[] = [];
  const values: string[] = [];

  users.forEach((user, i) => {
    const base = i * 2;
    placeholders.push(`($${base + 1}, $${base + 2})`);
    values.push(user.name, user.email);
  });

  const { rowCount } = await pool.query(
    `INSERT INTO users (name, email)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (email) DO NOTHING`,
    values
  );

  const pct = Math.round((batchNum / totalBatches) * 100);
  process.stdout.write(
    `\r  Seeding: [${"█".repeat(Math.floor(pct / 2))}${" ".repeat(50 - Math.floor(pct / 2))}] ${pct}% (batch ${batchNum}/${totalBatches})`
  );

  return rowCount ?? 0;
}

// ─── Main ─────────────────────────────────────────────────
async function seed() {
  console.log(`\n🌱 Seeding ${TOTAL_USERS.toLocaleString()} users into the database...\n`);
  const startTime = Date.now();

  // Check DB connection
  try {
    await pool.query("SELECT 1");
    console.log("  ✅ Database connected\n");
  } catch (err) {
    console.error("  ❌ Cannot connect to database:", err);
    process.exit(1);
  }

  // Check table exists
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'users'
    ) as exists
  `);
  if (!rows[0].exists) {
    console.error("  ❌ 'users' table not found. Run db/schema.sql first.");
    process.exit(1);
  }

  // Count existing rows
  const { rows: countRows } = await pool.query("SELECT COUNT(*) as count FROM users");
  const existing = Number(countRows[0].count);
  if (existing > 0) {
    console.log(`  ℹ️  Table already has ${existing.toLocaleString()} rows. Adding more...\n`);
  }

  // Generate and insert in batches
  const totalBatches = Math.ceil(TOTAL_USERS / BATCH_SIZE);
  console.log("totalBatches",totalBatches);
  let totalInserted = 0;

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd   = Math.min(batchStart + BATCH_SIZE, TOTAL_USERS);
    const batchSize  = batchEnd - batchStart;

    const users = Array.from({ length: batchSize }, (_, i) =>
      generateUser(batchStart + i + existing) // offset by existing count for unique emails
    );

    const inserted = await insertBatch(users, batch + 1, totalBatches);
    totalInserted += inserted;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n\n  ✅ Done! Inserted ${totalInserted.toLocaleString()} users in ${elapsed}s`);
  console.log(`  📊 Total rows in table: ${(existing + totalInserted).toLocaleString()}`);
  console.log(`  ⚡ Insert rate: ${Math.round(totalInserted / Number(elapsed))} rows/sec\n`);

  // Show sample of what was created
  const { rows: sample } = await pool.query(
    "SELECT id, name, email, created_at FROM users ORDER BY id DESC LIMIT 5"
  );
  console.log("  Sample rows created:");
  console.table(sample);

  await pool.end();
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err);
  pool.end();
  process.exit(1);
});