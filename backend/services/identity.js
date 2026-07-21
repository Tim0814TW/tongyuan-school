class IdentityServiceError extends Error {
  constructor(message, { status = 502, unavailable = false } = {}) {
    super(message);
    this.name = 'IdentityServiceError';
    this.status = status;
    this.unavailable = unavailable;
  }
}

function createIdentityClient({ env = process.env, fetchImpl = global.fetch } = {}) {
  const mode = String(env.IDENTITY_AUTH_MODE || 'off').toLowerCase();
  const baseUrl = String(env.IDENTITY_SERVICE_URL || '').replace(/\/$/, '');
  const enabled = ['prefer', 'required'].includes(mode);

  async function authenticate({ identifier, password }) {
    if (!enabled) return null;
    if (!baseUrl) {
      throw new IdentityServiceError('identity_service_url_required', { unavailable: true });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env.IDENTITY_TIMEOUT_MS || 5000));
    try {
      const response = await fetchImpl(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ identifier, password, targetSystem: 'school' }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new IdentityServiceError(body.error || 'identity_login_failed', { status: response.status });
      }
      return body;
    } catch (error) {
      if (error instanceof IdentityServiceError) throw error;
      throw new IdentityServiceError('identity_service_unavailable', { unavailable: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { authenticate, enabled, mode };
}

module.exports = { createIdentityClient, IdentityServiceError };
