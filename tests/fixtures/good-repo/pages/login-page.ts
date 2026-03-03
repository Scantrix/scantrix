import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly forgotPasswordLink: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;
  readonly loadingSpinner: Locator;

  constructor(private page: Page) {
    this.heading = page.locator('h1');
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign In' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.rememberMeCheckbox = page.getByLabel('Remember me');
    this.forgotPasswordLink = page.getByRole('link', { name: 'Forgot password?' });
    this.errorMessage = page.locator('.error-message');
    this.successMessage = page.locator('.success-message');
    this.loadingSpinner = page.locator('.loading-spinner');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async loginWithRememberMe(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.rememberMeCheckbox.check();
    await this.submitButton.click();
  }

  async resetPassword() {
    await this.forgotPasswordLink.click();
  }

  async cancelLogin() {
    await this.cancelButton.click();
  }

  async waitForError() {
    await this.errorMessage.waitFor({ state: 'visible' });
  }
}
