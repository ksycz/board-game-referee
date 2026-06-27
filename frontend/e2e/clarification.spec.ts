import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";
import { startWithCleanLibrary } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const samplePdf = path.join(repoRoot, "backend/tests/fixtures/sample-rulebook.pdf");

test("asks for clarification, accepts a reply, and hides the prompt on Search tab", async ({ page }) => {
  await startWithCleanLibrary(page);

  await page.locator("#upload-name").fill("E2E Clarify Game");
  await page.locator('label.upload-btn input[type="file"]').setInputFiles(samplePdf);
  await expect(page.getByRole("heading", { name: "E2E Clarify Game" })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByPlaceholder("Ask a rules question…").fill("clarify: can I attack on turn one?");
  await page.getByRole("button", { name: "Ask" }).click();

  const prompt = page.getByText("Referee needs one detail");
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".clarification-prompt-question")).toHaveText(
    "How many players are at the table?",
  );
  await expect(page.getByPlaceholder("Your answer…")).toBeVisible();

  await page.getByRole("tab", { name: "Search" }).click();
  await expect(prompt).not.toBeVisible();

  await page.getByRole("tab", { name: "Ask" }).click();
  await expect(prompt).toBeVisible();

  await page.getByPlaceholder("Your answer…").fill("Four players");
  await page.getByRole("button", { name: "Send detail" }).click();

  await expect(prompt).not.toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".message-wrap.referee .ruling").last()).toContainText("first turn");
});
