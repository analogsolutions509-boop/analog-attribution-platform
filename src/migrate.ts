import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const dir = path.resolve(process.cwd(), "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);

for (const filename of files) {
  const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [filename]);
  if (exists.rowCount) continue;
  const sql = await readFile(path.join(dir, filename), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
    await client.query("COMMIT");
    console.log(`applied ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
await pool.end();
console.log("migrations complete");
