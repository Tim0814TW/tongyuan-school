const assert = require('node:assert/strict');
const test = require('node:test');
const { createIdentityClient, IdentityServiceError } = require('../services/identity');

test('identity client is disabled unless explicitly enabled', async () => {
  const client = createIdentityClient({ env: {}, fetchImpl: async () => { throw new Error('should not run'); } });
  assert.equal(client.enabled, false);
  assert.equal(await client.authenticate({ identifier: 'a', password: 'b' }), null);
});

test('identity client sends school target and returns linked session', async () => {
  let requestBody;
  const client = createIdentityClient({
    env: { IDENTITY_AUTH_MODE: 'required', IDENTITY_SERVICE_URL: 'https://identity.test/' },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ token: 'shared', user: { id: '1' }, legacy: { userId: '9' } }) };
    },
  });
  const result = await client.authenticate({ identifier: 'teacher', password: 'secret', organizationCode: 'A1' });
  assert.equal(requestBody.targetSystem, 'school');
  assert.equal(result.legacy.userId, '9');
});

test('identity network failures are marked unavailable for prefer-mode fallback', async () => {
  const client = createIdentityClient({
    env: { IDENTITY_AUTH_MODE: 'prefer', IDENTITY_SERVICE_URL: 'https://identity.test' },
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(
    client.authenticate({ identifier: 'teacher', password: 'secret' }),
    (error) => error instanceof IdentityServiceError && error.unavailable,
  );
});
