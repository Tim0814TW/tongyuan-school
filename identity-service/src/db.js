import pg from "pg";

const { Pool } = pg;

export function createPool(databaseUrl, nodeEnv = "development") {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return new Pool({
    connectionString: databaseUrl,
    ssl: nodeEnv === "production" ? { rejectUnauthorized: false } : false,
  });
}
