import { renderOperations } from "../js/mosaic.js";
import { buildOutputName } from "../js/export.js";
import { MosaicEditor } from "../js/editor.js";

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

  const editorHost = document.createElement("div");
  editorHost.style.cssText = "width:400px;height:250px";
  const editorCanvas = document.createElement("canvas");
  editorCanvas.style.cssText = "width:100%;height:100%";
  editorHost.append(editorCanvas);
  document.body.append(editorHost);
  const editor = new MosaicEditor(editorCanvas);
  editor.resize();
  const source = document.createElement("canvas");
  source.width = 200;
  source.height = 100;
  const sourceContext = source.getContext("2d");
  sourceContext.fillStyle = "#f5f5f5";
  sourceContext.fillRect(0, 0, 100, source.height);
  sourceContext.fillStyle = "#172033";
  sourceContext.fillRect(100, 0, 100, source.height);
  editor.setImage(source);
  editor.setTool("brush");
  const editorRect = editorCanvas.getBoundingClientRect();
  const hoverClientX = editorRect.left + editor.state.offsetX + 50 * editor.displayScale;
  const hoverClientY = editorRect.top + editor.state.offsetY + 40 * editor.displayScale;
  editorCanvas.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: hoverClientX, clientY: hoverClientY }));
  assert(Math.abs(editor.hoverPointer.x - 50) < 0.01 && Math.abs(editor.hoverPointer.y - 40) < 0.01, "マウス位置を元画像座標で保持する");
  assert(editorCanvas.classList.contains("has-brush-cursor"), "画像上ではカスタムブラシカーソルを有効にする");

  editor.setBrushSize(120);
  let cursorArc = null;
  const lineWidths = [];
  const overlayContext = {
    save() {}, beginPath() {},
    arc(...args) { cursorArc = args; },
    stroke() {}, restore() {},
    set strokeStyle(value) {},
    set lineWidth(value) { lineWidths.push(value); },
  };
  editor.renderOverlay(overlayContext, { scale: 3, offsetX: 10, offsetY: 20 }, 2);
  assert(cursorArc[2] === 180, "ブラシサイズと表示倍率から円の半径を算出する");
  assert(lineWidths.length === 2 && lineWidths[0] === 6 && lineWidths[1] === 3, "明暗二重アウトラインをHiDPI倍率で描画する");

  editor.panStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
  editor.updateHoverPointer(new PointerEvent("pointermove", { pointerType: "mouse", clientX: hoverClientX, clientY: hoverClientY }));
  assert(editor.hoverPointer === null, "パン中はブラシカーソルを表示しない");
  editor.panStart = null;
  editor.pinch = { distance: 1 };
  editor.updateHoverPointer(new PointerEvent("pointermove", { pointerType: "pen", clientX: hoverClientX, clientY: hoverClientY }));
  assert(editor.hoverPointer === null, "ピンチズーム中はブラシカーソルを表示しない");
  editor.pinch = null;
  editorCanvas.dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", clientX: hoverClientX, clientY: hoverClientY }));
  assert(editor.hoverPointer === null, "タッチ操作ではブラシカーソルを表示しない");
  editorCanvas.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: editorRect.left, clientY: editorRect.top }));
  assert(editor.hoverPointer === null, "画像領域外ではブラシカーソルを表示しない");
  const previewHeading = document.createElement("h2");
  previewHeading.textContent = "Brush cursor preview";
  editorHost.before(previewHeading);
  editor.setHoverPointer({ x: 100, y: 50 });
  editor.render();
  editor.resizeObserver.disconnect();

  result.textContent = `${assertions.join("\n")}\n\n${assertions.length} tests passed.`;
  document.title = "PASS — JustMosaic! smoke test";
} catch (error) {
  result.textContent = `FAIL: ${error.message}`;
  document.title = "FAIL — JustMosaic! smoke test";
  throw error;
}
