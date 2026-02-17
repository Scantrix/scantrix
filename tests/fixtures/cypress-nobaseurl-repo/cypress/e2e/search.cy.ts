describe("Search", () => {
  it("should search", () => {
    cy.visit("http://localhost:3000/search");
    cy.get("#search-input").type("test");
    cy.wait(2000);
  });
});
