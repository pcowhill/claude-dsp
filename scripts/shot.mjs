// Quick visual inspection: load app, screenshot, dump console errors.
import { chromium } from '@playwright/test';

const url = process.env.APP_URL ?? 'http://localhost:5199/';
const out = process.env.OUT ?? '/tmp/shot.png';
const actions = process.env.ACTIONS ?? '';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    errors.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
  }
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${String(err).slice(0, 300)}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

for (const act of actions.split(',').filter(Boolean)) {
  const [kind, sel] = act.split('|');
  try {
    if (kind === 'click') await page.click(sel, { timeout: 3000 });
    else if (kind === 'wait') await page.waitForTimeout(parseInt(sel));
  } catch (e) {
    errors.push(`[action-failed] ${act}: ${String(e).slice(0, 150)}`);
  }
}
await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log('SCREENSHOT SAVED', out);
console.log(errors.length ? 'CONSOLE ISSUES:\n' + errors.slice(0, 20).join('\n') : 'NO CONSOLE ISSUES');
await browser.close();
