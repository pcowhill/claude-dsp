import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.click('[data-testid=onboarding-done]');
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.react-flow__node').forEach((n) => {
    const title = n.querySelector('.dsp-node-title')?.textContent;
    const r = n.getBoundingClientRect();
    out.push(`${title}: w=${Math.round(r.width)} h=${Math.round(r.height)}`);
  });
  return out;
});
console.log(info.join('\n'));
await browser.close();
