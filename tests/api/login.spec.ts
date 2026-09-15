import { test, expect, SEEDED_USER, SEEDED_CUSTOMER_ID } from '../../src/fixtures/base';

test.describe('API - GET /login/{username}/{password}', () => {
  test('valid credentials return the customer', async ({ accountClient }) => {
    const customer = await accountClient.login(SEEDED_USER.username, SEEDED_USER.password);
    expect(customer).toMatchObject({ id: SEEDED_CUSTOMER_ID, firstName: 'John', lastName: 'Smith' });
  });

  test('wrong password returns HTTP 400 with a plain-text error, not the customer', async ({ accountClient }) => {
    const { status, body } = await accountClient.loginRaw(SEEDED_USER.username, 'wrong-password');
    expect(status).toBe(400);
    expect(body).toBe('Invalid username and/or password');
  });

  test('unknown username returns HTTP 400 with the same plain-text error', async ({ accountClient }) => {
    const { status, body } = await accountClient.loginRaw('no-such-user', 'whatever');
    expect(status).toBe(400);
    expect(body).toBe('Invalid username and/or password');
  });
});
