import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

test("searches indexed passages without calling the referee", async ({ page }) => {
  await startWithCleanLibrary(page);

  await page.locator("#upload-name").fill("E2E Search Game");
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);
  await expect(page.getByRole("heading", { name: "E2E Search Game" })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByPlaceholder("e.g. setup, first turn, tie breaker").fill("first turn");
  await page.getByRole("button", { name: "Search" }).click();

  const hit = page.locator(".quick-search-hit").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await expect(hit).toContainText("Page");
  await expect(page.locator(".message-wrap.referee")).toHaveCount(0);
});
