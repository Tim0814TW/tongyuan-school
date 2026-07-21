import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl, config.nodeEnv);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const schema = await fs.readFile(path.join(root, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Identity schema migration completed");
} finally {
  await pool.end();
}
