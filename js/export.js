import { outputCanvas } from './scene.js?v=9';

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
  const canvas = outputCanvas(state, mimeType);
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
