import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('.');
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/index.html');
  const ui = await page.locator('[data-tool]').evaluateAll(items => items.map(item => item.dataset.tool).filter(tool => tool !== 'select').sort());
  const registry = await page.evaluate(async () => Object.keys((await import('/js/objects.js')).DRAWING_TOOLS).sort());
  if (JSON.stringify(ui) !== JSON.stringify(registry)) throw new Error('UI drawing tools must have editing adapters');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 100);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.locator('[data-tool="rectangleAnnotation"]').click();
  const canvas = page.locator('#editorCanvas');
  const box = await canvas.boundingBox();
  const scale = Math.min(box.width / 200, box.height / 100) * 0.94;
  const point = (x, y) => ({ x: box.x + (box.width - 200 * scale) / 2 + x * scale, y: box.y + (box.height - 100 * scale) / 2 + y * scale });
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  };
  await drag(point(25, 15), point(85, 55));
  await page.locator('[data-tool="select"]').click();
  if (await page.locator('[data-tool="select"]').getAttribute('aria-pressed') !== 'true') throw new Error('Selection button did not activate');
  await drag(point(55, 35), point(95, 45));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#saveImage').click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith('.png')) throw new Error('UI export failed');
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.locator('[data-tool="select"]').isVisible())) throw new Error('Mobile selection UI missing');
  console.log('PASS: 実UIのファイル読み込み・描画・選択ドラッグ・保存・スマートフォン幅');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(base + '/tests/mosaic-smoke.html');
  await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title));
  const result = await page.locator('#result').textContent();
  console.log(result);
  if (!((await page.title()).startsWith('PASS')) || errors.length) throw new Error(errors.join('\n') || result);
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
