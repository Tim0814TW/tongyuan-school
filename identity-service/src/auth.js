import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export function publicUser(user) {
  return {
    id: String(user.id),
    organizationId: user.organization_id == null ? null : String(user.organization_id),
    organizationName: user.organization_name || null,
    organizationCode: user.organization_code || null,
    name: user.name,
    username: user.username,
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    subject: user.subject || "",
    grade: user.grade || "",
    className: user.class_name || "",
    guardianName: user.guardian_name || "",
    guardianPhone: user.guardian_phone || "",
    status: user.status,
  };
}

function durationToMilliseconds(value) {
  const match = String(value).trim().match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error("JWT_EXPIRES_IN must use formats such as 30m, 8h, or 7d");
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * units[match[2]];
}

export function createAuthService({ repository, jwtSecret, jwtExpiresIn = "8h", now = () => new Date() }) {
  return {
    publicUser,

    async login({ identifier, password, organizationCode = "", targetSystem = "" }) {
      const user = await repository.findUserForLogin(identifier, organizationCode);
      const valid = user && user.status === "active" &&
        (user.role === "admin" || user.organization_status === "active") &&
        await bcrypt.compare(password, user.password_hash);
      if (!valid) return null;

      const sessionId = crypto.randomUUID();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + durationToMilliseconds(jwtExpiresIn));
      await repository.createSession({
        id: sessionId,
        userId: user.id,
        tokenVersion: user.token_version,
        expiresAt,
      });
      const token = jwt.sign(
        {
          sub: String(user.id),
          role: user.role,
          organizationId: user.organization_id == null ? null : String(user.organization_id),
          sid: sessionId,
          ver: user.token_version,
        },
        jwtSecret,
        { expiresIn: jwtExpiresIn, issuer: "tongyuan-identity", audience: ["tongyuan-school", "tongyuan-stock"] },
      );
      const legacy = targetSystem
        ? await repository.findLegacyIdentity(user.id, targetSystem)
        : null;
      return {
        token,
        user: publicUser(user),
        legacy: legacy ? {
          sourceSystem: legacy.source_system,
          userId: legacy.legacy_user_id,
          organizationId: legacy.legacy_organization_id,
        } : null,
      };
    },

    verifyToken(token) {
      return jwt.verify(token, jwtSecret, {
        issuer: "tongyuan-identity",
        audience: ["tongyuan-school", "tongyuan-stock"],
      });
    },
  };
}
