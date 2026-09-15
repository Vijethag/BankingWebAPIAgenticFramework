import { RegistrationData } from '../pages/RegisterPage';

/**
 * Generates syntactically-valid, unique registration form data for tests.
 * The username is guaranteed unique per call (timestamp + random suffix),
 * which is what let us rule out "accidental username collision" as an
 * explanation for the registration bug documented in
 * specs/transfer-funds.md and exercised by tests/ui/registration.spec.ts.
 */
export const UserFactory = {
  create(overrides: Partial<RegistrationData> = {}): RegistrationData {
    const unique = `user_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    return {
      firstName: 'Test',
      lastName: 'User',
      street: '1 Main St',
      city: 'Anytown',
      state: 'CA',
      zipCode: '90210',
      phoneNumber: '555-555-5555',
      ssn: '123-45-6789',
      username: unique,
      password: 'Passw0rd1',
      ...overrides,
    };
  },
};
