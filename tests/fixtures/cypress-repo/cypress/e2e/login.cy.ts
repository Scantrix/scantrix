describe("Login flow", () => {
  beforeEach(() => {
    cy.visit("/login");
  });

  it("should login with valid credentials", () => {
    // CY-FLAKE-002: fragile CSS selectors
    cy.get(".login-form").should("be.visible");
    cy.get("#username").type("admin@example.com");
    cy.get("#password").type("secret123");
    cy.get(".submit-btn").click();

    // CY-FLAKE-001: hard wait
    cy.wait(3000);

    cy.url().should("include", "/dashboard");
  });

  it("should show error for invalid credentials", () => {
    cy.get(".login-form").should("be.visible");
    cy.get("#username").type("bad@example.com");
    cy.get("#password").type("wrong");
    cy.get(".submit-btn").click();

    // CY-FLAKE-001: another hard wait
    cy.wait(2000);

    cy.get(".error-message").should("contain", "Invalid credentials");
  });

  it("should use xpath selectors", () => {
    // CY-LOC-001: xpath in Cypress
    cy.xpath("//div[@class='login-panel']//input[@name='email']").type("test@test.com");
    cy.get('//div[@class="submit-area"]').click();
  });
});
