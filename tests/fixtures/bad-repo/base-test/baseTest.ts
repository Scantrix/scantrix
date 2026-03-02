import { Page } from '@playwright/test';
import { WaiterHelpers } from '../utils/sleepHelper';

export class BaseTest {
  page: Page;
  waiterHelpers: WaiterHelpers;

  constructor(page: Page) {
    this.page = page;
    this.waiterHelpers = new WaiterHelpers();
  }
}
