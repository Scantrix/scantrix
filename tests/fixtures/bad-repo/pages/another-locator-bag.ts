import { type Page, type Locator } from '@playwright/test';

export class AnotherLocatorBag {
  readonly title: Locator;
  readonly description: Locator;
  readonly price: Locator;
  readonly quantity: Locator;
  readonly addToCartBtn: Locator;
  readonly removeBtn: Locator;
  readonly imageGallery: Locator;

  constructor(private page: Page) {
    this.title = page.locator('.product-title');
    this.description = page.locator('.product-description');
    this.price = page.locator('.price');
    this.quantity = page.getByLabel('Quantity');
    this.addToCartBtn = page.getByRole('button', { name: 'Add to Cart' });
    this.removeBtn = page.getByRole('button', { name: 'Remove' });
    this.imageGallery = page.locator('.image-gallery');
  }
}
