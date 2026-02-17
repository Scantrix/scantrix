describe("Reports", () => {
  it("should load reports", () => {
    cy.visit("http://localhost:3000/reports");
    cy.wait(3000);
    cy.get(".reports-table").should("be.visible");
  });
});
