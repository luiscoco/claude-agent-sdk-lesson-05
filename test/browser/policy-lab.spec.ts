import { test, expect } from '@playwright/test';
async function noteScenario(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Request one change/ }).click();
}
test('local read runs real tools and distinguishes handlers from permission callbacks', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#read-count')).toHaveText('2');
  await expect(page.locator('#callback-count')).toHaveText('0');
  await expect(page.locator('#mutation-count')).toHaveText('0');
  await expect(page.locator('#events')).toContainText('Real MCP call result');
});
test('approve once creates one note and renders user content as text', async ({ page }) => {
  await noteScenario(page);
  await page.locator('#note-title').fill('<img src=x onerror=alert(1)>');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Awaiting approval');
  await expect(page.locator('.approval-card')).toContainText('<img');
  expect(await page.locator('.approval-card img').count()).toBe(0);
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#mutation-count')).toHaveText('1');
  await expect(page.locator('#board')).toContainText('<img');
  expect(await page.locator('#board img').count()).toBe(0);
  await expect(page.locator('.approval-card')).toHaveCount(0);
});
test('deny leaves the note board empty and the save handler untouched', async ({ page }) => {
  await noteScenario(page);
  await page.locator('#run').click();
  await page.getByRole('button', { name: 'Deny this note', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#mutation-count')).toHaveText('0');
  await expect(page.locator('#counter-detail')).toContainText('Save handler: 0');
  await expect(page.locator('#board')).toContainText('No note was saved');
});
test('dontAsk denies the note without opening an approval', async ({ page }) => {
  await noteScenario(page);
  await page.locator('#permission-mode').selectOption('dontAsk');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('.approval-card')).toHaveCount(0);
  await expect(page.locator('#events')).toContainText('deny without prompting');
  await expect(page.locator('#mutation-count')).toHaveText('0');
});
test('blocked command is denied before handler dispatch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Observe a blocked tool/ }).click();
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await expect(page.locator('#counter-detail')).toContainText('Command handler: 0');
  await expect(page.locator('#events')).toContainText('blocked before MCP dispatch');
});
test('stopping a pending approval removes the decision controls', async ({ page }) => {
  await noteScenario(page);
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Awaiting approval');
  await page.getByRole('button', { name: 'Stop this run', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Cancelled');
  await expect(page.locator('.approval-card')).toHaveCount(0);
  await expect(page.locator('#mutation-count')).toHaveText('—');
  await expect(page.locator('#counter-detail')).toContainText('No final execution report');
});
test('trace keeps the submitted note and mode after a later draft changes', async ({ page }) => {
  await noteScenario(page);
  await page.locator('#run').click();
  await page.getByRole('button', { name: 'Deny this note', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Completed');
  await page.locator('#note-title').fill('Later draft');
  const waiting = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('lesson-05-tool-policy-trace.json');
  let json = '';
  const stream = await download.createReadStream();
  for await (const chunk of stream!) json += chunk.toString();
  expect(JSON.parse(json).config.title).toBe('Review unknown task IDs');
  expect(JSON.parse(json).mode).toBe('local');
});
test('guide shows actual built-in families and quiz distinguishes policy concepts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Tools & policy guide/ }).click();
  await expect(page.locator('.family-card')).toHaveCount(4);
  await expect(page.locator('.method-card')).toHaveCount(8);
  await expect(page.locator('#builtin-families')).toContainText('TaskCreate');
  await page.getByRole('tab', { name: /Check your understanding/ }).click();
  for (const [i, answer] of [0, 1, 2, 0].entries())
    await page.locator(`input[name=q${i}][value="${answer}"]`).check();
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('#quiz-score')).toContainText('4 / 4 correct');
});
test('phone layout fits the policy and pending-approval panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await noteScenario(page);
  await page.locator('#run').click();
  await expect(page.locator('.approval-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Deny this note', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Completed');
  for (const tab of [/Tools & policy guide/, /Check your understanding/]) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
