import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

test("settle a dispute and show the referee ruling", async ({ page }) => {
  await startWithCleanLibrary(page);

  await page.locator("#upload-name").fill("E2E Dispute Game");
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);

  await expect(page.getByRole("heading", { name: "E2E Dispute Game" })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "Dispute" }).click();

  await page.locator("#dispute-situation").fill("Can I attack on the first turn?");
  await page.locator("#dispute-player-a").fill("Yes, there is no rule against attacking on turn one.");
  await page.locator("#dispute-player-b").fill("No, you must wait until your second turn to attack.");

  await page.getByRole("button", { name: "Settle dispute" }).click();

  await expect(page.locator(".message-wrap.dispute")).toBeVisible();

  const ruling = page.locator(".message-wrap.referee .ruling").last();
  await expect(ruling).toBeVisible({ timeout: 60_000 });
  await expect(ruling).not.toBeEmpty();
});
