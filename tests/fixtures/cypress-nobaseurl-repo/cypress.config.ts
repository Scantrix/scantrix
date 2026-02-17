import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    defaultCommandTimeout: 45000,
    viewportWidth: 1920,
    viewportHeight: 1080,
    video: true,
  },
});
