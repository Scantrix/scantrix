describe("Checkout Flow", () => {
  beforeEach(() => {
    cy.visit("/checkout");
  });

  it("should complete checkout with user details", () => {
    const firstName = 'Jane';
    const lastName = 'Smith';
    const streetAddress = '456 Oak Avenue';
    const zipCode = '10001';
    const birthDate = '1985-03-22';
    const cardNumber = '4222222222222222';

    cy.get("#first-name").type(firstName);
    cy.get("#last-name").type(lastName);
    cy.get("#address").type(streetAddress);
    cy.get("#zip").type(zipCode);
    cy.get("#dob").type(birthDate);
    cy.get("#card").type(cardNumber);
    cy.get(".submit-btn").click();
    cy.url().should("include", "/confirmation");
  });

  it("should show price breakdown", () => {
    const username = 'shopper99';
    const price = '$49.99';
    const amount = 49.99;

    cy.get("#username").type(username);
    cy.get(".total-price").should("contain", price);
  });
});
