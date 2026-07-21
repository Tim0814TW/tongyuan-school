import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { loadConfig } from "../src/config.js";
import { createAuthService, publicUser } from "../src/auth.js";
import { normalizeRole, roleForSystem } from "../src/roles.js";

test("legacy roles map to one canonical role model", () => {
  assert.equal(normalizeRole("school", "super"), "admin");
  assert.equal(normalizeRole("school", "institution"), "school");
  assert.equal(normalizeRole("stock", "school"), "school");
  assert.equal(roleForSystem("school", "admin"), "super");
  assert.equal(roleForSystem("stock", "school"), "school");
});

test("production rejects weak secrets and missing CORS origins", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "short", CORS_ORIGIN: "https://a.test" }));
  assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(32), CORS_ORIGIN: "" }));
});

test("login issues a shared token and creates a revocable session", async () => {
  const passwordHash = await bcrypt.hash("SafePassword123!", 10);
  const sessions = [];
  const user = {
    id: 42, organization_id: 7, organization_name: "測試園所", organization_code: "TEST2026",
    organization_status: "active", name: "王老師", username: "teacher-wang", email: "teacher@example.com",
    phone: "0912-345-678", password_hash: passwordHash, role: "teacher", subject: "數學",
    grade: "", class_name: "七年一班", guardian_name: "", guardian_phone: "",
    status: "active", token_version: 1,
  };
  const repository = {
    async findUserForLogin(identifier, organizationCode) {
      assert.equal(identifier, "teacher-wang");
      assert.equal(organizationCode, "TEST2026");
      return user;
    },
    async createSession(session) { sessions.push(session); },
  };
  const service = createAuthService({ repository, jwtSecret: "test-secret-that-is-long-enough-123", jwtExpiresIn: "1h" });
  const result = await service.login({ identifier: "teacher-wang", password: "SafePassword123!", organizationCode: "TEST2026" });
  assert.equal(result.user.role, "teacher");
  assert.equal(result.user.organizationId, "7");
  assert.equal(sessions.length, 1);
  const payload = service.verifyToken(result.token);
  assert.equal(payload.sub, "42");
  assert.equal(payload.organizationId, "7");
  assert.equal(payload.sid, sessions[0].id);
});

test("public user never exposes password hashes", () => {
  const output = publicUser({ id: 1, name: "系統管理員", username: "admin", password_hash: "secret", role: "admin", status: "active" });
  assert.equal(output.password_hash, undefined);
  assert.equal(output.role, "admin");
});
