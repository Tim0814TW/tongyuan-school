import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/auth.js";

test("health, login, me, and logout form a complete revocable flow", async (context) => {
  const passwordHash = await bcrypt.hash("SafePassword123!", 10);
  const user = {
    id: 42,
    organization_id: 7,
    organization_name: "測試園所",
    organization_code: "TEST2026",
    organization_status: "active",
    name: "王老師",
    username: "teacher-wang",
    email: "teacher@example.com",
    phone: "0912-345-678",
    password_hash: passwordHash,
    role: "teacher",
    subject: "數學",
    grade: "",
    class_name: "七年一班",
    guardian_name: "",
    guardian_phone: "",
    status: "active",
    token_version: 1,
  };
  let session = null;
  const repository = {
    async health() { return true; },
    async findUserForLogin(identifier, organizationCode) {
      return identifier === user.username && organizationCode === user.organization_code ? user : null;
    },
    async createSession(value) { session = value; },
    async findLegacyIdentity() {
      return { source_system: "stock", legacy_user_id: "42", legacy_organization_id: "7" };
    },
    async findActiveSession(sessionId) {
      if (!session || session.id !== sessionId) return null;
      return { ...user, session_token_version: session.tokenVersion };
    },
    async revokeSession(sessionId) {
      if (session?.id === sessionId) session = null;
    },
  };
  const config = { nodeEnv: "test", allowedOrigins: [] };
  const authService = createAuthService({
    repository,
    jwtSecret: "test-secret-that-is-long-enough-123",
    jwtExpiresIn: "1h",
  });
  const server = createApp({ config, repository, authService }).listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    service: "tongyuan-identity",
    database: "connected",
  });

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: "teacher-wang",
      password: "SafePassword123!",
      organizationCode: "TEST2026",
      targetSystem: "stock",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.role, "teacher");
  assert.equal(login.legacy.userId, "42");
  assert.ok(login.token);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json();
  assert.equal(me.user.name, "王老師");
  assert.equal(me.user.password_hash, undefined);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(logoutResponse.status, 204);

  const revokedResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(revokedResponse.status, 401);
});
