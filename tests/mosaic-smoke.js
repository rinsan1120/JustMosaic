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

  const annotationCanvas = document.createElement("canvas");
  annotationCanvas.width = 120;
  annotationCanvas.height = 80;
  const annotationContext = annotationCanvas.getContext("2d");
  annotationContext.fillStyle = "#ffffff";
  annotationContext.fillRect(0, 0, 120, 80);
  renderOperations(annotationContext, annotationCanvas, [
    { type: "arrowAnnotation", x1: 10, y1: 40, x2: 110, y2: 40, color: "#2563eb", strokeWidth: 6 },
    { type: "ellipseAnnotation", x: 20, y: 10, width: 80, height: 50, color: "#e53935", strokeWidth: 4 },
    { type: "rectangleMosaic", x: 0, y: 0, width: 120, height: 80, blockSize: 12 },
  ], { scale: 1, offsetX: 0, offsetY: 0, imageWidth: 120, imageHeight: 80 });
  const arrowPixel = annotationContext.getImageData(60, 40, 1, 1).data;
  const ellipsePixel = annotationContext.getImageData(60, 10, 1, 1).data;
  assert(arrowPixel[2] > arrowPixel[0], "矢印をモザイクより上に描画する");
  assert(ellipsePixel[0] > ellipsePixel[1], "丸囲みを輪郭線として描画する");

  const arrowMoves = [];
  const arrowLines = [];
  const arrowShapeContext = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, stroke() {}, closePath() {}, fill() {},
    moveTo(x, y) { arrowMoves.push({ x, y }); },
    lineTo(x, y) { arrowLines.push({ x, y }); },
    set strokeStyle(value) {}, set fillStyle(value) {}, set lineWidth(value) {}, set lineCap(value) {}, set lineJoin(value) {},
  };
  renderOperations(arrowShapeContext, { width: 120, height: 80 }, [
    { type: "arrowAnnotation", x1: 0, y1: 40, x2: 100, y2: 40, color: "#e53935", strokeWidth: 8 },
  ], { scale: 1, offsetX: 0, offsetY: 0, imageWidth: 120, imageHeight: 80 });
  assert(Math.abs(arrowLines[0].x - 68) < 0.01 && arrowLines[0].y === 40, "矢印の軸を矢尻の付け根で終了する");
  assert(arrowMoves[1].x === 100 && arrowLines[1].x === arrowLines[2].x, "終点を頂点とする対称な矢尻を描画する");
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

  const clientPoint = (x, y) => ({
    clientX: editorRect.left + editor.state.offsetX + x * editor.displayScale,
    clientY: editorRect.top + editor.state.offsetY + y * editor.displayScale,
  });
  editor.canvas.setPointerCapture = () => {};
  editor.setTool("arrow");
  editor.setAnnotationColor("#16a34a");
  editor.setAnnotationStrokeWidth("12");
  editor.onPointerDown({ pointerId: 7, button: 0, pointerType: "mouse", ...clientPoint(20, 20) });
  editor.onPointerMove({ pointerId: 7, pointerType: "mouse", ...clientPoint(160, 70) });
  editor.onPointerUp({ pointerId: 7, pointerType: "mouse", ...clientPoint(160, 70) });
  const arrowOperation = editor.state.operations.at(-1);
  assert(arrowOperation.type === "arrowAnnotation" && arrowOperation.color === "#16a34a" && arrowOperation.strokeWidth === 12, "矢印を色・線幅付きで履歴へ確定する");

  editor.setTool("ellipse");
  editor.onPointerDown({ pointerId: 8, button: 0, pointerType: "mouse", ...clientPoint(30, 15) });
  editor.onPointerMove({ pointerId: 8, pointerType: "mouse", ...clientPoint(140, 75) });
  editor.onPointerUp({ pointerId: 8, pointerType: "mouse", ...clientPoint(140, 75) });
  const ellipseOperation = editor.state.operations.at(-1);
  assert(ellipseOperation.type === "ellipseAnnotation" && Math.abs(ellipseOperation.width - 110) < 0.01 && Math.abs(ellipseOperation.height - 60) < 0.01, "ドラッグ範囲を楕円注釈として確定する");
  editor.undo();
  assert(editor.state.redoStack.at(-1).type === "ellipseAnnotation", "丸囲みをUndoできる");
  editor.redo();
  assert(editor.state.operations.at(-1).type === "ellipseAnnotation", "丸囲みをRedoできる");

  editor.state.operations = [
    { type: "rectangleMosaic", x: 1, y: 2, width: 30, height: 20, blockSize: 20 },
    { type: "brushMosaic", points: [{ x: 10, y: 10 }], brushSize: 55, blockSize: 20 },
  ];
  editor.state.redoStack = [
    { type: "brushMosaic", points: [{ x: 20, y: 20 }], brushSize: 65, blockSize: 20 },
  ];
  editor.activeDraft = { type: "brushMosaic", points: [{ x: 30, y: 30 }], brushSize: 75, blockSize: 20 };
  let renderRequests = 0;
  editor.requestRender = () => { renderRequests += 1; };
  editor.setMosaicSize("40");
  assert(editor.state.mosaicSize === 40, "新しいモザイク強度を状態へ設定する");
  assert(editor.state.operations.every((operation) => operation.blockSize === 40), "確定済みの矩形・ブラシへ最新強度を反映する");
  assert(editor.state.redoStack.every((operation) => operation.blockSize === 40), "Redo待ちのモザイクへ最新強度を反映する");
  assert(editor.activeDraft.blockSize === 40, "描画中のブラシへ最新強度を反映する");
  assert(editor.state.operations[1].brushSize === 55 && editor.state.redoStack[0].brushSize === 65 && editor.activeDraft.brushSize === 75, "既存ブラシのサイズを変更しない");
  assert(renderRequests === 1, "強度変更後に再描画を要求する");
  editor.activeDraft = null;
  editor.redo();
  assert(editor.state.operations.at(-1).blockSize === 40, "Redo後も最新のモザイク強度を維持する");

  editor.state.operations = [
    { type: "arrowAnnotation", x1: 1, y1: 2, x2: 30, y2: 20, color: "#e53935", strokeWidth: 8 },
    { type: "ellipseAnnotation", x: 5, y: 6, width: 40, height: 25, color: "#2563eb", strokeWidth: 8 },
    { type: "rectangleMosaic", x: 1, y: 2, width: 30, height: 20, blockSize: 40 },
  ];
  editor.state.redoStack = [
    { type: "arrowAnnotation", x1: 3, y1: 4, x2: 20, y2: 30, color: "#16a34a", strokeWidth: 8 },
  ];
  editor.activeDraft = { type: "ellipseDraft", start: { x: 1, y: 1 }, end: { x: 20, y: 15 }, color: "#f4b400", strokeWidth: 8 };
  renderRequests = 0;
  editor.setAnnotationStrokeWidth("20");
  assert(editor.state.annotationStrokeWidth === 20, "新しい注釈線幅を状態へ設定する");
  assert(editor.state.operations.slice(0, 2).every((operation) => operation.strokeWidth === 20), "既存の矢印・丸囲みへ最新線幅を反映する");
  assert(editor.state.redoStack.every((operation) => operation.strokeWidth === 20), "Redo待ちの注釈へ最新線幅を反映する");
  assert(editor.activeDraft.strokeWidth === 20, "編集中の注釈へ最新線幅を反映する");
  assert(editor.state.operations[0].color === "#e53935" && editor.state.operations[1].color === "#2563eb" && editor.activeDraft.color === "#f4b400", "注釈色は変更しない");
  assert(editor.state.operations[2].blockSize === 40, "モザイク強度は変更しない");
  assert(renderRequests === 1, "線幅変更後に再描画を要求する");
  editor.activeDraft = null;
  editor.redo();
  assert(editor.state.operations.at(-1).strokeWidth === 20, "Redo後も最新の注釈線幅を維持する");

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
