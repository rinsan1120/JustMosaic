import { renderOperations } from "../js/mosaic.js";
import { buildOutputName } from "../js/export.js";

const result = document.getElementById("result");
const assertions = [];
const assert = (condition, description) => {
  if (!condition) throw new Error(description);
  assertions.push(`PASS: ${description}`);
};

try {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 120, 80);
  gradient.addColorStop(0, "#ff0000");
  gradient.addColorStop(1, "#0000ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 120, 80);
  const beforeOutside = [...context.getImageData(2, 2, 1, 1).data];
  const beforeInside = [...context.getImageData(50, 30, 1, 1).data];

  renderOperations(context, canvas, [{
    type: "rectangleMosaic",
    x: 30,
    y: 15,
    width: 55,
    height: 38,
    blockSize: 12,
  }], { scale: 1, offsetX: 0, offsetY: 0 });

  const afterOutside = [...context.getImageData(2, 2, 1, 1).data];
  const afterInside = [...context.getImageData(50, 30, 1, 1).data];
  assert(beforeOutside.every((value, index) => value === afterOutside[index]), "矩形の外側を変更しない");
  assert(beforeInside.some((value, index) => value !== afterInside[index]), "矩形の内側をモザイク化する");

  const brushOutside = [...context.getImageData(105, 70, 1, 1).data];
  renderOperations(context, canvas, [{
    type: "brushMosaic",
    points: [{ x: 15, y: 65 }, { x: 45, y: 62 }, { x: 75, y: 68 }],
    brushSize: 14,
    blockSize: 9,
  }], { scale: 1, offsetX: 0, offsetY: 0 });
  const brushOutsideAfter = [...context.getImageData(105, 70, 1, 1).data];
  assert(brushOutside.every((value, index) => value === brushOutsideAfter[index]), "ブラシ範囲の外側を変更しない");
  assert(buildOutputName("photo.jpeg", "image/jpeg") === "photo_mosaic.jpg", "JPEGの出力名を生成する");
  assert(buildOutputName("photo.png", "image/png") === "photo_mosaic.png", "PNGの出力名を生成する");
  assert(buildOutputName("photo.webp", "image/webp") === "photo_mosaic.webp", "WebPの出力名を生成する");

  result.textContent = `${assertions.join("\n")}\n\n${assertions.length} tests passed.`;
  document.title = "PASS — JustMosaic! smoke test";
} catch (error) {
  result.textContent = `FAIL: ${error.message}`;
  document.title = "FAIL — JustMosaic! smoke test";
  throw error;
}
