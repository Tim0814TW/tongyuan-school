import express from "express";
import cors from "cors";
import helmet from "helmet";

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: "too_many_requests" });
    }
    next();
  };
}

export function createApp({ config, repository, authService }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  const allowedOrigins = new Set(config.allowedOrigins);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || (config.nodeEnv !== "production" && allowedOrigins.size === 0)) {
        return callback(null, true);
      }
      return callback(new Error("cors_origin_not_allowed"));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", async (_req, res) => {
    try {
      await repository.health();
      res.json({ ok: true, service: "tongyuan-identity", database: "connected" });
    } catch {
      res.status(503).json({ ok: false, service: "tongyuan-identity", database: "unavailable" });
    }
  });

  app.post("/api/auth/login", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }), async (req, res) => {
    const identifier = String(req.body?.identifier || "").trim();
    const password = String(req.body?.password || "");
    const organizationCode = String(req.body?.organizationCode || "").trim();
    if (!identifier || !password) return res.status(400).json({ error: "identifier_and_password_required" });
    const result = await authService.login({ identifier, password, organizationCode });
    if (!result) return res.status(401).json({ error: "invalid_credentials" });
    res.json(result);
  });

  async function requireAuth(req, res, next) {
    try {
      const header = req.get("authorization") || "";
      const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
      if (!token) return res.status(401).json({ error: "unauthorized" });
      const payload = authService.verifyToken(token);
      const user = await repository.findActiveSession(payload.sid);
      if (!user || String(user.id) !== String(payload.sub) || user.token_version !== payload.ver ||
          user.session_token_version !== payload.ver) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.identity = { payload, user };
      next();
    } catch {
      res.status(401).json({ error: "unauthorized" });
    }
  }

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: authService.publicUser(req.identity.user) });
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    await repository.revokeSession(req.identity.payload.sid);
    res.status(204).end();
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "internal_error" });
  });
  return app;
}
