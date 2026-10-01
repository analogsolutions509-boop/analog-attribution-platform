import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export async function closeDb(): Promise<void> {
  await db.end();
}
