import { renderOperations } from "./mosaic.js";

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function buildOutputName(originalName, mimeType) {
  const extension = MIME_EXTENSIONS[mimeType] || "png";
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${base}_mosaic.${extension}`;
}

export async function exportImage(state, originalName, mimeType) {
  const canvas = document.createElement("canvas");
  canvas.width = state.imageWidth;
  canvas.height = state.imageHeight;
  const context = canvas.getContext("2d", { alpha: mimeType !== "image/jpeg" });
  if (!context) throw new Error("CANVAS_FAILED");
  if (mimeType === "image/jpeg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(state.sourceImage, 0, 0, canvas.width, canvas.height);
  renderOperations(context, canvas, state.operations, { scale: 1, offsetX: 0, offsetY: 0 });
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("ENCODE_FAILED")), mimeType, mimeType === "image/jpeg" ? 0.98 : undefined);
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildOutputName(originalName, mimeType);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
