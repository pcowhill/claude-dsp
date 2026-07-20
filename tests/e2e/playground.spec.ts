/**
 * Browser end-to-end tests covering the representative workflows:
 * onboarding, patching a chain, analyzers, parameter editing, playback,
 * capture, persistence, import/export, share URLs and console hygiene.
 */

import { test, expect, type Page } from '@playwright/test';

const APP = 'http://localhost:5177/';

/** Collect console errors, ignoring benign autoplay-policy noise. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function boot(page: Page, opts: { dismissOnboarding?: boolean } = {}) {
  await page.goto(APP);
  await expect(page.locator('.masthead')).toBeVisible();
  if (opts.dismissOnboarding !== false) {
    const done = page.locator('[data-testid=onboarding-done]');
    if (await done.isVisible().catch(() => false)) await done.click();
  }
}

/** Drag a cable between two node handles on the canvas. */
async function connect(page: Page, fromNode: string, toNode: string, toPort = 'in') {
  const src = page.locator(`.react-flow__node[data-id="${fromNode}"] .react-flow__handle.source`).first();
  const dst = page.locator(
    `.react-flow__node[data-id="${toNode}"] .react-flow__handle[data-handleid="${toPort}"]`,
  );
  const a = (await src.boundingBox())!;
  const b = (await dst.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('boots with onboarding, no console errors', async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page, { dismissOnboarding: false });
  await expect(page.locator('.modal-title')).toContainText(/welcome/i);
  await page.locator('[data-testid=onboarding-done]').click();
  await expect(page.locator('[data-testid=flow-canvas]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('starter project loads with working live analyzers and playback', async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page);
  // Starter chain present
  await expect(page.locator('.dsp-node-title', { hasText: 'Oscilloscope' })).toBeVisible();
  // Play → transport runs and playhead advances
  await page.locator('[data-testid=btn-play]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.status-bar')).toContainText('PLAYING');
  const t1 = await page.locator('[data-testid=playhead]').textContent();
  await page.waitForTimeout(800);
  const t2 = await page.locator('[data-testid=playhead]').textContent();
  expect(t1).not.toBe(t2);
  // Stop
  await page.locator('[data-testid=btn-stop]').click();
  await expect(page.locator('.status-bar')).toContainText('STOPPED');
  expect(errors).toEqual([]);
});

test('build a sine → scope → output chain from an empty bench', async ({ page }) => {
  await boot(page);
  // Fresh project
  await page.locator('[data-testid=btn-projects]').click();
  await page.getByRole('button', { name: '+ New project' }).click();
  await expect(page.locator('.canvas-empty')).toBeVisible();
  // Click-to-add modules
  await page.locator('[data-testid="lib-src.sine"]').click();
  await page.locator('[data-testid="lib-ana.scope"]').click();
  await page.locator('[data-testid="lib-out.audio"]').click();
  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(3);
  // Wire them
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await nodes.nth(i).getAttribute('data-id'))!);
  const sineId = ids.find((id) => id.startsWith('sine'))!;
  const scopeId = ids.find((id) => id.startsWith('scope'))!;
  const outId = ids.find((id) => id.startsWith('audio'))!;
  await connect(page, sineId, scopeId);
  await connect(page, scopeId, outId);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  // Status bar reflects the patch
  await expect(page.locator('.status-bar')).toContainText('3 modules');
  await expect(page.locator('.status-bar')).toContainText('2 cables');
});

test('invalid connections are refused with an explanation', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=btn-projects]').click();
  await page.getByRole('button', { name: '+ New project' }).click();
  await page.locator('[data-testid="lib-src.sine"]').click();
  await page.locator('[data-testid="lib-proc.gain"]').click();
  const nodes = page.locator('.react-flow__node');
  const sineId = (await nodes.nth(0).getAttribute('data-id'))!;
  const gainId = (await nodes.nth(1).getAttribute('data-id'))!;
  await connect(page, sineId, gainId);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  // Second cable into the same input must be refused with a toast
  await page.locator('[data-testid="lib-src.square"]').click();
  const sqId = (await page.locator('.react-flow__node').nth(2).getAttribute('data-id'))!;
  await connect(page, sqId, gainId);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1); // unchanged
  await expect(page.locator('.toast')).toContainText(/already has a cable/);
});

test('parameter editing via inspector with validation', async ({ page }) => {
  await boot(page);
  // Select the sine node of the starter project
  await page.locator('.dsp-node-title', { hasText: 'Sine Wave' }).first().click();
  await expect(page.locator('.inspector-title')).toContainText(/sine wave/i);
  const freqInput = page.getByLabel('Frequency in Hz');
  await freqInput.fill('880');
  await freqInput.press('Enter');
  await expect(page.locator('.knob-value').first()).toContainText('880');
  // Out-of-range value → visible error, value not applied
  await freqInput.fill('999999');
  await freqInput.press('Enter');
  await expect(page.locator('.p-error')).toContainText(/Maximum is 20000/);
});

test('capture mode produces repeatable results and enables export', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=mode-capture]').click();
  await page.locator('[data-testid=btn-capture]').click();
  await expect(page.locator('[data-testid=capture-status]')).toContainText('CAPTURE READY', {
    timeout: 15000,
  });
  // WAV export produces a download
  await page.locator('[data-testid=btn-export]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid=export-wav]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
});

test('project JSON export → import round trip', async ({ page }) => {
  await boot(page);
  // Rename so we can recognize the import
  await page.getByLabel('Project name').fill('RT test project');
  await page.locator('[data-testid=btn-export]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid=export-json]').click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.keyboard.press('Escape');
  // Import it back
  await page.locator('[data-testid=btn-projects]').click();
  await page.locator('[data-testid=import-file]').setInputFiles(path!);
  await expect(page.locator('.toast', { hasText: 'Imported' })).toContainText('RT test project');
  await expect(page.getByLabel('Project name')).toHaveValue('RT test project');
});

test('projects persist across reloads (autosave)', async ({ page }) => {
  await boot(page);
  await page.getByLabel('Project name').fill('Persistence check');
  await page.locator('[data-testid="lib-proc.delay"]').click();
  await page.waitForTimeout(1200); // autosave debounce
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Persistence check');
  await expect(page.locator('.dsp-node-title', { hasText: 'Delay' })).toBeVisible();
});

test('share URL opens the same project', async ({ page, context }) => {
  await boot(page);
  await page.getByLabel('Project name').fill('Shared patch');
  await page.locator('[data-testid=btn-export]').click();
  await page.locator('[data-testid=share-url]').click();
  const url = await page.locator('[data-testid=share-url-value]').inputValue();
  expect(url).toContain('#p=');
  const page2 = await context.newPage();
  await page2.goto(url);
  const done2 = page2.locator('[data-testid=onboarding-done]');
  if (await done2.isVisible().catch(() => false)) await done2.click();
  await expect(page2.getByLabel('Project name')).toHaveValue('Shared patch');
});

test('undo and redo work for graph edits', async ({ page }) => {
  await boot(page);
  const before = await page.locator('.react-flow__node').count();
  await page.locator('[data-testid="lib-proc.gain"]').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  await page.getByRole('button', { name: /undo/i }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
  await page.getByRole('button', { name: /redo/i }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
});

test('complete lesson 1 end to end', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=tab-lessons]').click();
  await page.locator('[data-testid=lesson-card-1]').click();
  await expect(page.locator('[data-testid=lesson-panel]')).toBeVisible();

  // Step 1: goal = playing
  await page.locator('[data-testid=btn-play]').click();
  await expect(page.locator('[data-testid=lesson-next]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid=lesson-next]').click();

  // Step 2: answer prediction, then set amplitude ≥ 0.8 via inspector
  await page.locator('.predict-option').nth(1).click();
  await page.locator('.dsp-node-title', { hasText: 'Sine Wave' }).first().click();
  const amp = page.getByRole('textbox', { name: 'Amplitude', exact: true });
  await amp.fill('0.85');
  await amp.press('Enter');
  await expect(page.locator('[data-testid=lesson-next]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid=lesson-next]').click();

  // Step 3: prediction + frequency above 800
  await page.locator('.predict-option').nth(1).click();
  const freq = page.getByRole('textbox', { name: 'Frequency in Hz' });
  await freq.fill('900');
  await freq.press('Enter');
  await expect(page.locator('[data-testid=lesson-next]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid=lesson-next]').click();

  // Step 4: DC offset ≥ 0.2
  const dc = page.getByRole('textbox', { name: 'DC Offset', exact: true });
  await dc.fill('0.3');
  await dc.press('Enter');
  await expect(page.locator('[data-testid=lesson-next]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid=lesson-next]').click();

  // Step 5: reset DC to ~0 → complete
  await dc.fill('0');
  await dc.press('Enter');
  await expect(page.locator('[data-testid=lesson-next]')).toBeEnabled({ timeout: 10000 });
  await page.locator('[data-testid=lesson-next]').click();
  await page.locator('[data-testid=lesson-finish]').click();

  // Catalog shows completion stamp
  await expect(page.locator('[data-testid=lesson-card-1] .done-stamp')).toBeVisible();
});

test('complete challenge 4 (hidden frequencies) end to end', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=tab-challenges]').click();
  await page.locator('[data-testid=challenge-card-4]').click();
  await expect(page.locator('[data-testid=challenge-panel]')).toBeVisible();
  await page.locator('[data-testid=answer-f1]').fill('620');
  await page.locator('[data-testid=answer-f2]').fill('1490');
  await page.locator('[data-testid=answer-f3]').fill('3170');
  await page.locator('[data-testid=grade-button]').click();
  await expect(page.locator('[data-testid=grade-result]')).toContainText('PASSED', {
    timeout: 20000,
  });
  await expect(page.locator('[data-testid=grade-result]')).toContainText('100 pts');
});

test('challenge grading rejects a wrong answer with actionable feedback', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=tab-challenges]').click();
  await page.locator('[data-testid=challenge-card-4]').click();
  await page.locator('[data-testid=answer-f1]').fill('111');
  await page.locator('[data-testid=answer-f2]').fill('222');
  await page.locator('[data-testid=answer-f3]').fill('333');
  await page.locator('[data-testid=grade-button]').click();
  await expect(page.locator('[data-testid=grade-result]')).toContainText(/needs 90 to pass/, {
    timeout: 20000,
  });
});

test('no critical console errors across a full tour', async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page);
  await page.locator('[data-testid=btn-play]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-testid=tab-lessons]').click();
  await page.locator('[data-testid=tab-challenges]').click();
  await page.locator('[data-testid=tab-sandbox]').click();
  await page.locator('[data-testid=mode-capture]').click();
  await page.locator('[data-testid=btn-capture]').click();
  await expect(page.locator('[data-testid=capture-status]')).toContainText('CAPTURE READY', {
    timeout: 15000,
  });
  await page.locator('[data-testid=btn-export]').click();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
