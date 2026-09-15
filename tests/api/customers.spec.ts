import { test, expect, SEEDED_CUSTOMER_ID } from '../../src/fixtures/base';

test.describe('API - GET /customers/{customerId}', () => {
  test('valid id returns the customer', async ({ accountClient }) => {
    const customer = await accountClient.getCustomer(SEEDED_CUSTOMER_ID);
    expect(customer).toMatchObject({
      id: SEEDED_CUSTOMER_ID,
      firstName: 'John',
      lastName: 'Smith',
      address: { street: '1431 Main St', city: 'Beverly Hills', state: 'CA', zipCode: '90210' },
    });
  });

  test('unknown id returns HTTP 400 with a plain-text error', async ({ accountClient }) => {
    const { status, body } = await accountClient.getCustomerRaw(999_999);
    expect(status).toBe(400);
    expect(body).toBe('Could not find customer #999999');
  });
});
