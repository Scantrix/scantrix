describe("Settings", () => {
  it("should open settings", () => {
    cy.visit("http://localhost:3000/settings");
    cy.get(".settings-panel").should("be.visible");
    cy.wait(1000);
  });

  it("should update profile", () => {
    cy.visit("http://localhost:3000/settings/profile");
    cy.get("#name-input").type("New Name");
    cy.get(".save-btn").click();
    cy.wait(2000);
  });

  it("should change password", () => {
    cy.visit("http://localhost:3000/settings/security");
    cy.get("#old-password").type("old");
    cy.get("#new-password").type("new");
    cy.get(".update-btn").click();
    cy.wait(3000);
  });
});
