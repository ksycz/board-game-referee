import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

async function uploadSampleRulebook(page: import("@playwright/test").Page, name: string) {
  await page.locator("#upload-name").fill(name);
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 60_000 });
}

test("delete rulebook and clear-all require confirmation", async ({ page }) => {
  await startWithCleanLibrary(page);
  await uploadSampleRulebook(page, "E2E Delete Game");

  await page.getByRole("button", { name: "Delete E2E Delete Game" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "E2E Delete Game" })).toBeVisible();

  await page.getByRole("button", { name: "Delete E2E Delete Game" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No rulebooks yet — add one to start.")).toBeVisible();

  await uploadSampleRulebook(page, "E2E Clear All Game");
  await page.getByRole("button", { name: "Clear all" }).first().click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete all");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "E2E Clear All Game" })).toBeVisible();

  await page.getByRole("button", { name: "Clear all" }).first().click();
  await page.getByRole("button", { name: "Delete all" }).click();
  await expect(page.getByText("No rulebooks yet — add one to start.")).toBeVisible();
});
