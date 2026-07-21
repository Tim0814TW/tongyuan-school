BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  director_name TEXT NOT NULL DEFAULT '',
  director_phone TEXT NOT NULL DEFAULT '',
  director_email TEXT,
  authorization_year TEXT NOT NULL DEFAULT '',
  authorization_period TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_code_lower
  ON organizations (LOWER(code));

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'school', 'teacher', 'student')),
  subject TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((role = 'admin' AND organization_id IS NULL) OR (role != 'admin' AND organization_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_users_organization_role ON users (organization_id, role);

CREATE TABLE IF NOT EXISTS legacy_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_system TEXT NOT NULL CHECK (source_system IN ('school', 'stock')),
  legacy_user_id TEXT NOT NULL,
  legacy_organization_id TEXT,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, legacy_user_id),
  UNIQUE (user_id, source_system)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

COMMIT;
