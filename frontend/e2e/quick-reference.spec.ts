import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

test("shows the auto-generated quick reference tab", async ({ page }) => {
  await startWithCleanLibrary(page);

  await page.locator("#upload-name").fill("E2E Reference Game");
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);

  await expect(page.getByRole("heading", { name: "E2E Reference Game" })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "Reference" }).click();

  const reference = page.locator(".quick-reference");
  await expect(reference).toBeVisible({ timeout: 15_000 });
  await expect(reference).toContainText("Setup");
  await expect(reference).toContainText("Turn order");
  await expect(reference).toContainText("Win condition");
});
