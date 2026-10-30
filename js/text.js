export const isTextObject = object => ['textBoxAnnotation', 'speechAnnotation'].includes(object?.type);
export const TEXT_DEFAULTS = Object.freeze({ text: 'テキスト', fontMode: 'auto', fontSize: 32, bold: false, textColor: '#192439', align: 'left', verticalAlign: 'top', background: '#ffffff', borderColor: '#192439', opacity: 1, borderWidth: 2 });
let measure;
export const textFont = (object, size) => `${object.bold ? '700' : '400'} ${size.toFixed(15)}px sans-serif`;
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const layoutCache = new WeakMap();

// Prefer expanding a tiny/crowded frame to subpixel lettering. The image is the
// hard boundary; if even that is insufficient, fitting still keeps every line.
export function fitTextObject(object, imageWidth, imageHeight) {
  if (!isTextObject(object)) return object;
  const layout = layoutText(object);
  if (object.fontMode === 'manual') {
    if (layout.lines.length * layout.lineHeight <= object.height - layout.padding * 2 && layout.spans.every(span => span.width <= object.width - layout.padding * 2)) return object;
    // Keep the requested font size. Grow the frame before allowing overflow.
    let width = Math.min(imageWidth, layout.spans.reduce((max, span) => Math.max(max, span.width + 20), object.width));
    let expanded = layoutText({ ...object, width });
    if (expanded.lines.length * expanded.lineHeight + 20 > imageHeight) {
      width = imageWidth;
      expanded = layoutText({ ...object, width });
    }
    const height = Math.min(imageHeight, Math.max(object.height, expanded.lines.length * expanded.lineHeight + 20));
    return { ...object, x: Math.min(object.x, imageWidth - width), y: Math.min(object.y, imageHeight - height), width, height };
  }
  if (layout.size >= 8) return object;
  const factor = 8 / Math.max(layout.size, 1e-10);
  const width = Math.min(imageWidth, Math.max(32, object.width * factor));
  const height = Math.min(imageHeight, Math.max(24, object.height * factor));
  return { ...object, x: Math.min(object.x, imageWidth - width), y: Math.min(object.y, imageHeight - height), width, height };
}

// Always measure in source-image coordinates, regardless of preview zoom or DPR.
export function layoutText(object) {
  if (layoutCache.has(object)) return layoutCache.get(object);
  measure ??= document.createElement('canvas').getContext('2d');
  const padding = Math.min(10, object.width / 8, object.height / 8);
  const width = Math.max(Number.EPSILON, object.width - 2 * padding);
  const height = Math.max(Number.EPSILON, object.height - 2 * padding);
  const extent = text => {
    const metrics = measure.measureText(text);
    const left = Math.min(0, -metrics.actualBoundingBoxLeft);
    return { left, width: Math.max(metrics.width, metrics.actualBoundingBoxRight) - left,
      ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent };
  };
  const wrap = size => {
    measure.font = textFont(object, size);
    const lines = [];
    for (const paragraph of object.text.split('\n')) {
      let line = '';
      for (const { segment: char } of segmenter.segment(paragraph)) {
        if (line && extent(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  const calculate = size => {
    const lines = wrap(size), spans = lines.map(extent);
    const ascent = spans.reduce((max, span) => Math.max(max, span.ascent), size * .9);
    const descent = spans.reduce((max, span) => Math.max(max, span.descent), size * .3);
    return { lines, spans, ascent, lineHeight: Math.max(size * 1.5, ascent + descent) };
  };
  let size = object.fontSize;
  if (object.fontMode === 'auto') {
    let low = 0, high = Math.max(width, height);
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2, layout = calculate(mid);
      if (layout.lines.length * layout.lineHeight <= height && layout.spans.every(span => span.width <= width)) low = mid;
      else high = mid;
    }
    size = low;
  }
  const calculated = calculate(size);
  const spareHeight = Math.max(0, height - calculated.lines.length * calculated.lineHeight);
  const verticalOffset = object.verticalAlign === 'bottom' ? spareHeight : object.verticalAlign === 'middle' ? spareHeight / 2 : 0;
  const result = { size, padding, ...calculated, verticalOffset };
  layoutCache.set(object, result);
  return result;
}

// A single filled outline avoids translucent seams where the tail joins the box.
export function textOutline(object) {
  const { x, y, width: w, height: h } = object;
  const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (object.type !== 'speechAnnotation') return corners;
  const tip = { x: x + object.tailX, y: y + object.tailY };
  if (tip.x >= x && tip.x <= x + w && tip.y >= y && tip.y <= y + h) return corners;
  const cx = x + w / 2, cy = y + h / 2;
  const dx = tip.x - cx, dy = tip.y - cy;
  const side = Math.abs(dx / w) > Math.abs(dy / h) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  const a = corners[side], b = corners[(side + 1) % 4];
  const base = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [...corners.slice(0, side + 1), base(.35), tip, base(.65), ...corners.slice(side + 1)];
}

export function renderText(context, object, transform) {
  const layout = layoutText(object);
  context.save();
  context.translate(transform.offsetX, transform.offsetY);
  context.scale(transform.scale, transform.scale);
  context.globalAlpha = object.opacity;
  context.beginPath();
  textOutline(object).forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
  context.closePath();
  context.fillStyle = object.background;
  context.fill();
  context.strokeStyle = object.borderColor;
  context.lineWidth = Math.min(object.borderWidth, layout.padding);
  context.lineJoin = 'round';
  context.stroke();
  context.fillStyle = object.textColor;
  context.font = textFont(object, layout.size);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  layout.lines.forEach((line, index) => {
    const span = layout.spans[index];
    const x = object.align === 'center' ? object.x + (object.width - span.width) / 2 : object.align === 'right' ? object.x + object.width - layout.padding - span.width : object.x + layout.padding;
    context.fillText(line, x - span.left, object.y + layout.padding + layout.verticalOffset + layout.ascent + index * layout.lineHeight);
  });
  context.restore();
}
