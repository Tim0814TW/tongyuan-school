export function createIdentityRepository(pool) {
  return {
    async health() {
      await pool.query("SELECT 1");
      return true;
    },

    async findUserForLogin(identifier, organizationCode = "") {
      const params = [identifier];
      let organizationFilter = "";
      if (organizationCode) {
        params.push(organizationCode);
        organizationFilter = "AND LOWER(organizations.code) = LOWER($2)";
      }
      const { rows } = await pool.query(
        `SELECT users.*, organizations.name AS organization_name,
                organizations.code AS organization_code,
                organizations.status AS organization_status
         FROM users
         LEFT JOIN organizations ON organizations.id = users.organization_id
         WHERE (LOWER(users.username) = LOWER($1) OR LOWER(users.email) = LOWER($1))
           ${organizationFilter}
         LIMIT 1`,
        params,
      );
      return rows[0] || null;
    },

    async createSession({ id, userId, tokenVersion, expiresAt }) {
      await pool.query(
        `INSERT INTO auth_sessions (id, user_id, token_version, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [id, userId, tokenVersion, expiresAt],
      );
    },

    async findLegacyIdentity(userId, sourceSystem) {
      const { rows } = await pool.query(
        `SELECT source_system, legacy_user_id, legacy_organization_id
         FROM legacy_identities
         WHERE user_id = $1 AND source_system = $2`,
        [userId, sourceSystem],
      );
      return rows[0] || null;
    },

    async findActiveSession(sessionId) {
      const { rows } = await pool.query(
        `SELECT sessions.id AS session_id, sessions.token_version AS session_token_version,
                users.*, organizations.name AS organization_name,
                organizations.code AS organization_code,
                organizations.status AS organization_status
         FROM auth_sessions sessions
         JOIN users ON users.id = sessions.user_id
         LEFT JOIN organizations ON organizations.id = users.organization_id
         WHERE sessions.id = $1 AND sessions.revoked_at IS NULL
           AND sessions.expires_at > NOW() AND users.status = 'active'
           AND (users.role = 'admin' OR organizations.status = 'active')`,
        [sessionId],
      );
      return rows[0] || null;
    },

    async revokeSession(sessionId) {
      await pool.query(
        "UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
        [sessionId],
      );
    },
  };
}
