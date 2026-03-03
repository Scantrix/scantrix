import { type Page, type Locator } from '@playwright/test';

export class LocatorBagPage {
  readonly heading: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly nameInput: Locator;
  readonly phoneInput: Locator;
  readonly addressInput: Locator;
  readonly zipCodeInput: Locator;

  constructor(private page: Page) {
    this.heading = page.locator('h1');
    this.submitButton = page.getByRole('button', { name: 'Submit' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.nameInput = page.getByLabel('Name');
    this.phoneInput = page.getByLabel('Phone');
    this.addressInput = page.getByLabel('Address');
    this.zipCodeInput = page.getByLabel('Zip Code');
  }
}
