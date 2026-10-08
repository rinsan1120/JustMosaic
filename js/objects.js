// Every drawable tool must declare its geometry here; tests compare this registry to the UI.
export const DRAWING_TOOLS = Object.freeze({
  rectangle: { type: 'rectangleMosaic', geometry: 'box' },
  ellipseMosaic: { type: 'ellipseMosaic', geometry: 'ellipse' },
  brush: { type: 'brushMosaic', geometry: 'brush' },
  rectangleAnnotation: { type: 'rectangleAnnotation', geometry: 'box' },
  ellipse: { type: 'ellipseAnnotation', geometry: 'ellipse' },
  arrow: { type: 'arrowAnnotation', geometry: 'arrow' },
});
const geometry = object => Object.values(DRAWING_TOOLS).find(tool => tool.type === object.type)?.geometry;
export function bounds(object) {
  const kind = geometry(object);
  if (kind === 'brush' || kind === 'arrow') {
    const points = kind === 'brush' ? object.points : [{ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }];
    const radius = kind === 'brush' ? object.brushSize / 2 : 0;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs) - radius, y = Math.min(...ys) - radius;
    return { x, y, width: Math.max(...xs) + radius - x, height: Math.max(...ys) + radius - y };
  }
  return object;
}
export function handles(object) {
  const kind = geometry(object);
  if (kind === 'brush') return [];
  if (kind === 'arrow') return [{ id: 'start', x: object.x1, y: object.y1 }, { id: 'end', x: object.x2, y: object.y2 }];
  return [{ id: 'resize', x: object.x + object.width, y: object.y + object.height }];
}
function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
export function contains(object, point, tolerance) {
  const kind = geometry(object);
  if (kind === 'brush') return object.points.some((p, i) => segmentDistance(point, p, object.points[Math.max(0, i - 1)]) <= object.brushSize / 2 + tolerance);
  if (kind === 'arrow') return segmentDistance(point, { x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) <= Math.max(tolerance, object.strokeWidth * 1.4);
  if (kind === 'ellipse') return ((point.x - object.x - object.width / 2) / (object.width / 2 + tolerance)) ** 2 + ((point.y - object.y - object.height / 2) / (object.height / 2 + tolerance)) ** 2 <= 1;
  return kind === 'box' && point.x >= object.x - tolerance && point.x <= object.x + object.width + tolerance && point.y >= object.y - tolerance && point.y <= object.y + object.height + tolerance;
}
export function editObject(original, start, point, handle, imageWidth, imageHeight) {
  if (handle === 'resize') return { ...original, width: Math.max(1, point.x - original.x), height: Math.max(1, point.y - original.y) };
  if (handle === 'start' || handle === 'end') return { ...original, [handle === 'start' ? 'x1' : 'x2']: point.x, [handle === 'start' ? 'y1' : 'y2']: point.y };
  const box = bounds(original);
  const dx = Math.max(Math.min(0, -box.x), Math.min(Math.max(0, imageWidth - box.x - box.width), point.x - start.x));
  const dy = Math.max(Math.min(0, -box.y), Math.min(Math.max(0, imageHeight - box.y - box.height), point.y - start.y));
  if (geometry(original) === 'brush') return { ...original, points: original.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  if (geometry(original) === 'arrow') return { ...original, x1: original.x1 + dx, y1: original.y1 + dy, x2: original.x2 + dx, y2: original.y2 + dy };
  return { ...original, x: original.x + dx, y: original.y + dy };
}
