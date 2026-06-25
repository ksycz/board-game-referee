import { expect, type Page } from "@playwright/test";

export async function startWithCleanLibrary(page: Page) {
  const listResponse = await page.request.get("/api/rulebooks");
  expect(listResponse.ok()).toBeTruthy();
  const books: { id: string }[] = await listResponse.json();
  for (const book of books) {
    const deleteResponse = await page.request.delete(`/api/rulebooks/${book.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
  }

  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await expect(page.getByText("No rulebooks yet — add one to start.")).toBeVisible();
}
