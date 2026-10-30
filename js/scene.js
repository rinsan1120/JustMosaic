import { renderOperations } from './mosaic.js?v=9';

// Crop entries change the viewport, never the original image or object coordinates.
export function imageBounds(state) {
  return state.operations.findLast(entry => entry.type === 'crop')?.rect
    ?? { x: 0, y: 0, width: state.imageWidth, height: state.imageHeight };
}

export function createImageCanvas(state, history = state.operations, mimeType = 'image/png') {
  const canvas = document.createElement('canvas');
  canvas.width = state.imageWidth; canvas.height = state.imageHeight;
  const ctx = canvas.getContext('2d');
  if (mimeType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(state.sourceImage, 0, 0);
  renderOperations(ctx, canvas, history, { scale: 1, offsetX: 0, offsetY: 0, imageWidth: canvas.width, imageHeight: canvas.height });
  return canvas;
}

export function cropCanvas(full, view) {
  if (view.x === 0 && view.y === 0 && view.width === full.width && view.height === full.height) return full;
  const output = document.createElement('canvas');
  output.width = view.width; output.height = view.height;
  output.getContext('2d').drawImage(full, view.x, view.y, view.width, view.height, 0, 0, view.width, view.height);
  return output;
}

export function outputCanvas(state, mimeType = 'image/png') {
  return cropCanvas(createImageCanvas(state, state.operations, mimeType), imageBounds(state));
}
