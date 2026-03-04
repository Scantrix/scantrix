import { WaiterHelpers } from '../utils/sleepHelper';

export class PageWithWaits {
  private waiter = new WaiterHelpers();

  constructor(private page: any) {}

  async slowAction() {
    await this.waiter.delay(2000);
    await this.page.locator('.result').click();
  }

  async anotherSlowAction() {
    await this.waiter.delay(1000);
  }
}
