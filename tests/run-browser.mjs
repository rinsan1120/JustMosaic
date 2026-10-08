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
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const mobile of [false, true]) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html');
    const ui = await page.locator('[data-tool]').evaluateAll(items => items.map(item => item.dataset.tool).sort());
    const registry = await page.evaluate(async () => Object.keys((await import('/js/objects.js')).DRAWING_TOOLS).sort());
    if (JSON.stringify(ui) !== JSON.stringify(registry)) throw new Error('UI must contain only drawing tools with editing adapters');
    const image = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 100;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = '#172033'; ctx.fillRect(100, 0, 100, 100);
      return c.toDataURL().split(',')[1];
    });
    const touchSession = mobile ? await context.newCDPSession(page) : null;
    const drag = async (a, b, hold = false) => {
      if (mobile) {
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
        if (hold) await page.waitForTimeout(500);
        for (let i = 1; i <= 5; i++) await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 5, y: a.y + (b.y - a.y) * i / 5 }] });
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(a.x, a.y); await page.mouse.down();
        if (hold) await page.waitForTimeout(500);
        await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
      }
    };
    const save = async () => {
      const promise = page.waitForEvent('download');
      await page.locator('#saveImage').click();
      const download = await promise;
      if (!download.suggestedFilename().endsWith('.png')) throw new Error('UI PNG export failed');
      return readFile(await download.path());
    };
    page.on('dialog', dialog => dialog.accept());
    for (const tool of registry) {
      await page.locator('#fileInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.locator('[data-tool="' + tool + '"]').click();
      if (tool === 'brush') await page.locator('#brushSize').evaluate(input => { input.value = '16'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      const canvas = page.locator('#editorCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      const scale = Math.min(box.width / 200, box.height / 100) * 0.94;
      const point = (x, y) => ({ x: box.x + (box.width - 200 * scale) / 2 + x * scale, y: box.y + (box.height - 100 * scale) / 2 + y * scale });
      await drag(point(25, 15), point(85, 55));
      const before = await save();
      await canvas.scrollIntoViewIfNeeded();
      // Recompute screen positions after save scrolls the page on mobile.
      const screenPoint = async (x, y) => {
        const current = await canvas.boundingBox();
        return { x: current.x + (current.width - 200 * scale) / 2 + x * scale, y: current.y + (current.height - 100 * scale) / 2 + y * scale };
      };
      await drag(await screenPoint(55, 35), await screenPoint(95, 45));
      if (await page.locator('[data-tool="' + tool + '"]').getAttribute('aria-pressed') !== 'true') throw new Error('Direct editing changed drawing tool');
      const after = await save();
      if (before.equals(after)) throw new Error(`${tool}: UI drag did not change saved image`);
      await page.locator('#undo').click();
      if (!before.equals(await save())) throw new Error(`${tool}: UI move Undo failed`);
      await page.locator('#redo').click();
      if (!after.equals(await save())) throw new Error(`${tool}: UI move Redo failed`);
      if (tool !== 'brush') {
        await canvas.scrollIntoViewIfNeeded();
        await drag(await screenPoint(95, 45), await screenPoint(95, 45));
        const handle = tool === 'arrow' ? { x: 65, y: 25 } : { x: 125, y: 65 };
        await drag(await screenPoint(handle.x, handle.y), await screenPoint(handle.x + 15, handle.y + 8));
        const resized = await save();
        if (after.equals(resized)) throw new Error(`${tool}: UI resize did not change saved image`);
        await page.locator('#undo').click();
        if (!after.equals(await save())) throw new Error(`${tool}: UI resize Undo failed`);
        await page.locator('#redo').click();
        if (!resized.equals(await save())) throw new Error(`${tool}: UI resize Redo failed`);
      }
      await canvas.scrollIntoViewIfNeeded();
      await drag(await screenPoint(95, 45), await screenPoint(110, 50), true);
      if (after.equals(await save())) throw new Error(`${tool}: long-press overlap creation failed`);
      console.log(`PASS: ${tool}/${mobile ? 'native touch' : 'native mouse'}: 同じツールで描画・直接移動・Undo/Redo・保存${tool !== 'brush' ? '・サイズ変更' : ''}・長押し重ね描き`);
    }
    if (process.env.EDITOR_SCREENSHOTS) {
      await page.locator('#editorCanvas').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/private/tmp/justmosaic-direct-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    }
    await page.goto(base + '/tests/mosaic-smoke.html');
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title));
    const result = await page.locator('#result').textContent();
    console.log(`${mobile ? 'Mobile' : 'Desktop'}: ${result.split('\n').at(-1)}`);
    if (!((await page.title()).startsWith('PASS')) || errors.length) throw new Error(errors.join('\n') || result);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
