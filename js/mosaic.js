const makeCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
};

const clipBounds = (x, y, width, height, canvas) => {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.width, Math.ceil(x + width));
  const bottom = Math.min(canvas.height, Math.ceil(y + height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};

function createPixelatedRegion(sourceCanvas, bounds, blockSize) {
  const block = Math.max(1, blockSize);
  const small = makeCanvas(Math.max(1, Math.ceil(bounds.width / block)), Math.max(1, Math.ceil(bounds.height / block)));
  const smallContext = small.getContext("2d", { alpha: true });
  smallContext.imageSmoothingEnabled = true;
  smallContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    small.width,
    small.height,
  );

  const pixelated = makeCanvas(bounds.width, bounds.height);
  const pixelContext = pixelated.getContext("2d", { alpha: true });
  pixelContext.imageSmoothingEnabled = false;
  pixelContext.drawImage(small, 0, 0, small.width, small.height, 0, 0, pixelated.width, pixelated.height);
  return pixelated;
}

function applyRectangle(context, canvas, operation, transform) {
  const raw = {
    x: transform.offsetX + operation.x * transform.scale,
    y: transform.offsetY + operation.y * transform.scale,
    width: operation.width * transform.scale,
    height: operation.height * transform.scale,
  };
  const bounds = clipBounds(raw.x, raw.y, raw.width, raw.height, canvas);
  if (!bounds.width || !bounds.height) return;
  const pixelated = createPixelatedRegion(canvas, bounds, operation.blockSize * transform.scale);
  context.save();
  context.beginPath();
  context.rect(raw.x, raw.y, raw.width, raw.height);
  context.clip();
  context.drawImage(pixelated, bounds.x, bounds.y);
  context.restore();
}

function traceBrush(context, points, transform, radius, localOffset = { x: 0, y: 0 }) {
  if (!points.length) return;
  context.beginPath();
  const firstX = transform.offsetX + points[0].x * transform.scale - localOffset.x;
  const firstY = transform.offsetY + points[0].y * transform.scale - localOffset.y;
  if (points.length === 1) {
    context.arc(firstX, firstY, radius, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.moveTo(firstX, firstY);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(
      transform.offsetX + points[index].x * transform.scale - localOffset.x,
      transform.offsetY + points[index].y * transform.scale - localOffset.y,
    );
  }
  context.lineWidth = radius * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function applyBrush(context, canvas, operation, transform) {
  if (!operation.points.length) return;
  const radius = (operation.brushSize * transform.scale) / 2;
  const xs = operation.points.map((point) => transform.offsetX + point.x * transform.scale);
  const ys = operation.points.map((point) => transform.offsetY + point.y * transform.scale);
  const raw = {
    x: Math.min(...xs) - radius,
    y: Math.min(...ys) - radius,
    width: Math.max(...xs) - Math.min(...xs) + radius * 2,
    height: Math.max(...ys) - Math.min(...ys) + radius * 2,
  };
  const bounds = clipBounds(raw.x, raw.y, raw.width, raw.height, canvas);
  if (!bounds.width || !bounds.height) return;

  const layer = createPixelatedRegion(canvas, bounds, operation.blockSize * transform.scale);
  const layerContext = layer.getContext("2d");
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.fillStyle = "#000";
  layerContext.strokeStyle = "#000";
  traceBrush(layerContext, operation.points, transform, radius, bounds);
  context.drawImage(layer, bounds.x, bounds.y);
}

export function renderOperations(context, canvas, operations, transform) {
  for (const operation of operations) {
    if (operation.type === "rectangleMosaic") applyRectangle(context, canvas, operation, transform);
    if (operation.type === "brushMosaic") applyBrush(context, canvas, operation, transform);
  }
}
