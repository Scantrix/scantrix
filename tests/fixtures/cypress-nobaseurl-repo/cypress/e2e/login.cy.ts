describe("Login", () => {
  it("should login", () => {
    cy.visit("http://localhost:3000/login");
    cy.get(".login-form").should("be.visible");
    cy.wait(3000);
    cy.get("#username").type("admin");
    cy.get("#password").type("pass");
    cy.get(".btn-submit").click();
  });

  it("should logout", () => {
    cy.visit("http://localhost:3000/dashboard");
    cy.get(".logout-btn").click();
    cy.wait(2000);
  });
});
