describe("Profile", () => {
  it("should display profile", () => {
    cy.visit("http://localhost:3000/profile");
    cy.wait(2000);
    cy.get(".profile-card").should("be.visible");
  });

  it("should edit profile", () => {
    cy.visit("http://localhost:3000/profile/edit");
    cy.get("#bio").type("Hello world");
    cy.get(".save-btn").click();
    cy.wait(1000);
  });
});
