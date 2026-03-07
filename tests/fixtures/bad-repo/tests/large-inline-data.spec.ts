import { test, expect } from '@playwright/test';

// This file has a large inline object literal that should trigger ARCH-008

const hugePayload = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  address: {
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    country: 'US',
  },
  phone: '555-0100',
  company: 'Acme Corp',
  department: 'Engineering',
  role: 'QA Engineer',
  permissions: ['read', 'write', 'admin'],
  preferences: {
    theme: 'dark',
    language: 'en',
    timezone: 'America/Chicago',
    notifications: true,
    emailDigest: 'weekly',
  },
  metadata: {
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-15T12:00:00Z',
    lastLogin: '2024-06-15T12:00:00Z',
    loginCount: 42,
    isActive: true,
    isVerified: true,
  },
  billing: {
    plan: 'enterprise',
    seats: 50,
    monthlyRate: 499.99,
    currency: 'USD',
    billingAddress: {
      street: '456 Corporate Blvd',
      city: 'Springfield',
      state: 'IL',
      zip: '62702',
    },
    paymentMethod: 'credit_card',
    cardLast4: '4242',
  },
  features: {
    sso: true,
    auditLog: true,
    customBranding: true,
    apiAccess: true,
    prioritySupport: true,
    dataExport: true,
    advancedAnalytics: true,
  },
  tags: ['enterprise', 'premium', 'verified', 'active'],
};

test('uses large inline payload', async ({ page }) => {
  await page.goto('/api/users');
  await expect(page.locator('h1')).toHaveText('Users');
});
