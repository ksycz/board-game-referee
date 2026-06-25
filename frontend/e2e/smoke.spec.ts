import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

test("upload sample PDF, ask a question, and show a citation", async ({ page }) => {
  await startWithCleanLibrary(page);

  await page.locator("#upload-name").fill("E2E Test Game");
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);

  await expect(page.getByRole("heading", { name: "E2E Test Game" })).toBeVisible({
    timeout: 60_000,
  });

  await expect(page.getByText("Tableside rules engine")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Rules Referee/i })).toBeVisible();
  await expect(
    page.getByText("Settle arguments with cited rulings — upload a rulebook and roll.")
  ).toBeVisible();

  const question = "Can I attack on the first turn?";
  await page.getByPlaceholder("Ask a rules question…").fill(question);
  await page.getByRole("button", { name: "Ask" }).click();

  const citation = page.locator(".citation-link").first();
  await expect(citation).toBeVisible({ timeout: 60_000 });
  await expect(citation).toContainText("Page");
  await expect(page.locator(".ruling")).toContainText("first turn");
});
