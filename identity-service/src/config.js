import "dotenv/config";

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const jwtSecret = String(env.JWT_SECRET || "development-only-secret-change-me");
  if (isProduction && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters in production");
  }

  const allowedOrigins = parseOrigins(env.CORS_ORIGIN);
  if (isProduction && allowedOrigins.length === 0) {
    throw new Error("CORS_ORIGIN must list the approved websites in production");
  }

  return {
    nodeEnv: env.NODE_ENV || "development",
    port: Number(env.PORT || 4200),
    databaseUrl: env.DATABASE_URL || "",
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || "8h",
    allowedOrigins,
  };
}
