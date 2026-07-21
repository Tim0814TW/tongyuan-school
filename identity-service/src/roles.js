export const ROLES = Object.freeze(["admin", "school", "teacher", "student"]);

const LEGACY_ROLE_MAP = Object.freeze({
  school: Object.freeze({ super: "admin", institution: "school", teacher: "teacher", student: "student" }),
  stock: Object.freeze({ admin: "admin", school: "school", teacher: "teacher", student: "student" }),
});

export function normalizeRole(sourceSystem, legacyRole) {
  const role = LEGACY_ROLE_MAP[sourceSystem]?.[legacyRole];
  if (!role) throw new Error(`unsupported_role:${sourceSystem}:${legacyRole}`);
  return role;
}

export function roleForSystem(targetSystem, canonicalRole) {
  if (!ROLES.includes(canonicalRole)) throw new Error(`unsupported_canonical_role:${canonicalRole}`);
  if (targetSystem === "school") {
    return canonicalRole === "admin" ? "super" : canonicalRole === "school" ? "institution" : canonicalRole;
  }
  if (targetSystem === "stock") return canonicalRole;
  throw new Error(`unsupported_target_system:${targetSystem}`);
}
