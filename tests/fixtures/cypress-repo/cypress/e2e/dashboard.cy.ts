describe("Dashboard", () => {
  beforeEach(() => {
    cy.visit("/dashboard");
  });

  it("should display user profile", () => {
    cy.get(".profile-name").should("be.visible");
    cy.wait(5000);
    cy.get(".profile-name").should("contain", "TestUser");
  });

  it("should navigate to settings", () => {
    cy.get("#settings-link").click();
    cy.url().should("include", "/settings");
  });
});
