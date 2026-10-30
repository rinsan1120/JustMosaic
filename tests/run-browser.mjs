import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.');
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
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
    for (const tool of ['speech', 'textBox', 'text']) {
      await page.locator('#fileInput').setInputFiles({ name: 'text.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.locator(`[data-tool="${tool}"]`).click();
      await page.locator('#fontMode').selectOption('auto');
      await page.locator('#textBold').uncheck();
      await page.locator('#textAlign').selectOption('left');
      await page.locator('#textVerticalAlign').selectOption('top');
      const canvas = page.locator('#editorCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      const scale = Math.min(box.width / 200, box.height / 100) * .94;
      const point = (x, y) => ({ x: box.x + (box.width - 200 * scale) / 2 + x * scale, y: box.y + (box.height - 100 * scale) / 2 + y * scale });
      await drag(point(25, 15), point(85, 55));
      const initial = await save();
      if (mobile) await page.locator('#editText').click();
      else {
        await canvas.scrollIntoViewIfNeeded();
        const boxNow = await canvas.boundingBox();
        await page.mouse.dblclick(boxNow.x + (boxNow.width - 200 * scale) / 2 + 55 * scale, boxNow.y + (boxNow.height - 100 * scale) / 2 + 35 * scale);
      }
      const input = page.locator('.canvas-text-input');
      await input.fill('日本語の説明 ABC\n改行と折り返し');
      await input.press('Space');
      await input.press('Control+z');
      if (await page.locator('#undo').isDisabled()) throw new Error(`${tool}: text shortcut changed object history`);
      await input.press('Space');
      if (mobile) await page.locator('.text-input-done').click();
      else await input.press('Control+Enter');
      const edited = await save();
      if (initial.equals(edited)) throw new Error(`${tool}: text edit was not saved`);
      await page.locator('#undo').click();
      if (!initial.equals(await save())) throw new Error(`${tool}: text Undo failed`);
      await page.locator('#redo').click();
      if (!edited.equals(await save())) throw new Error(`${tool}: text Redo failed`);
      // Select the text object again after history navigation clears selection.
      await canvas.scrollIntoViewIfNeeded();
      const current = await canvas.boundingBox();
      const p = { x: current.x + (current.width - 200 * scale) / 2 + 55 * scale, y: current.y + (current.height - 100 * scale) / 2 + 35 * scale };
      await drag(p, p);
      await page.locator('#editText').click();
      await input.fill('キャンセルする入力');
      await input.press('Escape');
      if (!edited.equals(await save())) throw new Error(`${tool}: Escape changed text`);
      await page.locator('#fontMode').selectOption('manual');
      await page.locator('#fontSize').fill('19');
      await page.locator('#fontSize').press('Tab');
      if (await page.locator('#fontSize').inputValue() !== '19') throw new Error(`${tool}: manual size input failed`);
      await page.locator('#textBold').check();
      await page.locator('#textAlign').selectOption('right');
      const styled = await save();
      if (edited.equals(styled)) throw new Error(`${tool}: text style did not affect PNG`);
      await page.locator('#fontSize').fill('10');
      await page.locator('#fontSize').press('Tab');
      const alignmentTop = await save();
      await page.locator('#textVerticalAlign').selectOption('bottom');
      const bottomAligned = await save();
      if (alignmentTop.equals(bottomAligned)) throw new Error(`${tool}: vertical alignment did not change PNG`);
      await page.locator('#undo').click();
      if (!alignmentTop.equals(await save())) throw new Error(`${tool}: vertical alignment Undo failed`);
      await page.locator('#redo').click();
      if (!bottomAligned.equals(await save())) throw new Error(`${tool}: vertical alignment Redo failed`);
      await canvas.scrollIntoViewIfNeeded();
      const alignedBox = await canvas.boundingBox();
      const selectedPoint = { x: alignedBox.x + (alignedBox.width - 200 * scale) / 2 + 55 * scale, y: alignedBox.y + (alignedBox.height - 100 * scale) / 2 + 35 * scale };
      await drag(selectedPoint, selectedPoint);
      if (await page.locator('#textVerticalAlign').inputValue() !== 'bottom' || await page.locator('#textAlign').inputValue() !== 'right') throw new Error(`${tool}: per-object alignment was not restored`);
      await page.locator('#textVerticalAlign').selectOption('middle');
      if (await page.locator('#textVerticalAlign').inputValue() !== 'middle') throw new Error(`${tool}: middle alignment control failed`);
      await page.locator('#textVerticalAlign').selectOption('top');
      await page.locator('#fontSize').fill('19');
      await page.locator('#fontSize').press('Tab');
      await page.locator('#deleteText').click();
      const deleted = await save();
      if (styled.equals(deleted)) throw new Error(`${tool}: deletion did not affect PNG`);
      await page.locator('#undo').click();
      if (!styled.equals(await save())) throw new Error(`${tool}: delete Undo failed`);
      console.log(`PASS: ${tool}/${mobile ? 'native touch' : 'native mouse'}: 文字入力・改行・Escape・手動サイズ・太字・揃え・個別削除・Undo/Redo・保存`);
    }
    const assertCroppedPNG = async (full, cropped, rect) => {
      const matches = await page.evaluate(async ({ full, cropped, rect }) => {
        const decode = async value => createImageBitmap(new Blob([Uint8Array.from(atob(value), c => c.charCodeAt(0))], { type: 'image/png' }));
        const before = await decode(full), after = await decode(cropped);
        const c = document.createElement('canvas'); c.width = before.width; c.height = before.height;
        const ctx = c.getContext('2d'); ctx.drawImage(before, 0, 0);
        const expected = ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data;
        c.width = after.width; c.height = after.height; ctx.drawImage(after, 0, 0);
        const actual = ctx.getImageData(0, 0, after.width, after.height).data;
        const ok = after.width === rect.width && after.height === rect.height && expected.length === actual.length && expected.every((v, i) => v === actual[i]);
        before.close(); after.close(); return ok;
      }, { full: full.toString('base64'), cropped: cropped.toString('base64'), rect });
      if (!matches) throw new Error('Native crop PNG must exactly match the selected original pixels');
    };
    for (const tool of ['brush', 'speech', 'textBox', 'text']) {
      await page.locator('#fileInput').setInputFiles({ name: 'crop.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.locator(`[data-tool="${tool}"]`).click();
      if (tool !== 'brush') {
        await page.locator('#fontMode').selectOption('auto');
        if (tool === 'text' && (await page.locator('#textBackground').isVisible() || await page.locator('#textBorder').isVisible())) throw new Error('Text-only tool must hide background and border controls');
      }
      const canvas = page.locator('#editorCanvas');
      const screen = async (x, y, rect = { x: 0, y: 0, width: 200, height: 100 }, zoom = 1) => {
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        const scale = Math.min(box.width / rect.width, box.height / rect.height) * .94 * zoom;
        return { x: box.x + (box.width - rect.width * scale) / 2 + (x - rect.x) * scale, y: box.y + (box.height - rect.height * scale) / 2 + (y - rect.y) * scale };
      };
      await drag(await screen(25, 15), await screen(85, 55));
      const original = await save();
      await page.locator('#startCrop').click();
      await drag(await screen(40, 20), await screen(160, 90));
      await drag(await screen(100, 55), await screen(105, 55));
      await drag(await screen(165, 90), await screen(170, 95));
      if (await page.locator('#cropSize').textContent() !== '125 × 75 px') throw new Error(`${tool}: native crop move/resize failed (${await page.locator("#cropSize").textContent()})`);
      await page.locator('#cancelCrop').click();
      if (!original.equals(await save())) throw new Error(`${tool}: crop cancel changed PNG`);
      await page.locator('#startCrop').click();
      await drag(await screen(40, 20), await screen(160, 90));
      await page.locator('#confirmCrop').click();
      const rect = { x: 40, y: 20, width: 120, height: 70 }, cropped = await save();
      await assertCroppedPNG(original, cropped, rect);
      await page.locator('#undo').click();
      if (!original.equals(await save())) throw new Error(`${tool}: crop Undo did not restore the full image`);
      await page.locator('#redo').click();
      if (!cropped.equals(await save())) throw new Error(`${tool}: crop Redo failed`);
      await page.locator('#zoomIn').click();
      await drag(await screen(55, 35, rect, 1.25), await screen(65, 40, rect, 1.25));
      const moved = await save();
      if (moved.equals(cropped)) throw new Error(`${tool}: native direct move after crop failed`);
      await page.locator('#undo').click();
      if (!cropped.equals(await save())) throw new Error(`${tool}: post-crop move Undo failed`);
      await page.locator('#redo').click();
      if (!moved.equals(await save())) throw new Error(`${tool}: post-crop move Redo failed`);
      await page.locator('#zoomReset').click();
      if (tool !== 'brush') {
        await drag(await screen(70, 40, rect), await screen(70, 40, rect));
        await page.locator('#editText').click();
        await page.locator('.canvas-text-input').fill('切り抜き後の編集');
        await page.locator('.text-input-done').click();
        const edited = await save();
        if (edited.equals(moved)) throw new Error(`${tool}: post-crop text edit failed`);
        await page.locator('#deleteText').click();
        if (edited.equals(await save())) throw new Error(`${tool}: post-crop delete failed`);
        await page.locator('#undo').click();
        if (!edited.equals(await save())) throw new Error(`${tool}: post-crop delete Undo failed`);
      }
      const beforeNested = await save();
      await page.locator('#startCrop').click();
      await drag(await screen(60, 30, rect), await screen(140, 80, rect));
      await page.locator('#confirmCrop').click();
      const nested = await save();
      await assertCroppedPNG(beforeNested, nested, { x: 20, y: 10, width: 80, height: 50 });
      await page.locator('#undo').click();
      if (!beforeNested.equals(await save())) throw new Error(`${tool}: nested crop Undo failed`);
      await page.locator('#redo').click();
      if (!nested.equals(await save())) throw new Error(`${tool}: nested crop Redo failed`);
      console.log(`PASS: ${tool}/${mobile ? 'native touch' : 'native mouse'}: トリミング指定・移動・サイズ変更・確定・キャンセル・保存全画素一致・Undo/Redo・ズーム後の編集・再トリミング`);
    }
    if (process.env.EDITOR_SCREENSHOTS) {
      await page.locator('#editorCanvas').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(process.env.EDITOR_SCREENSHOTS, `justmosaic-direct-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    }
    await page.goto(base + '/tests/mosaic-smoke.html');
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title));
    const result = await page.locator('#result').textContent();
    console.log(`${mobile ? 'Mobile' : 'Desktop'}: ${result.split('\n').at(-1)}`);
    if (!((await page.title()).startsWith('PASS')) || errors.length) throw new Error(errors.join('\n') || result);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
