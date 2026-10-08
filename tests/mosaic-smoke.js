import { DRAWING_TOOLS, bounds, handles } from "../js/objects.js";
import { renderOperations, resolveOperations } from "../js/mosaic.js";
import { buildOutputName, exportImage } from "../js/export.js";
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

  const near = (a, b) => Math.abs(a - b) < 0.001;
  const equivalent = (a, b) => typeof a === "number" ? near(a, b)
    : a && typeof a === "object" ? Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => equivalent(a[k], b[k])) : a === b;
  const drag = (start, end, pointerType = "mouse", cancel = false) => {
    editor.onPointerDown({ pointerId: 20, button: 0, pointerType, ...clientPoint(start.x, start.y) });
    editor.onPointerMove({ pointerId: 20, pointerType, ...clientPoint(end.x, end.y) });
    editor.onPointerUp({ pointerId: 20, pointerType, ...clientPoint(end.x, end.y) }, cancel);
  };
  const pixelsFor = history => {
    const c = document.createElement("canvas"); c.width = source.width; c.height = source.height;
    const ctx = c.getContext("2d"); ctx.drawImage(source, 0, 0);
    renderOperations(ctx, c, history, { scale: 1, offsetX: 0, offsetY: 0, imageWidth: source.width, imageHeight: source.height });
    return ctx.getImageData(0, 0, c.width, c.height).data;
  };
  const checkExport = async (expected, description) => {
    let blob;
    const createURL = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    try {
      URL.createObjectURL = value => { blob = value; return createURL.call(URL, value); };
      HTMLAnchorElement.prototype.click = () => {};
      await exportImage(editor.state, "test.png", "image/png");
    } finally { URL.createObjectURL = createURL; HTMLAnchorElement.prototype.click = click; }
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement("canvas"); c.width = bitmap.width; c.height = bitmap.height;
    c.getContext("2d").drawImage(bitmap, 0, 0); bitmap.close();
    const actual = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    assert(expected.every((v, i) => actual[i] === v), description);
  };
  // Independent fixtures make missing or incorrect geometry adapters fail.
  const fixtures = {
    rectangle: { type: "rectangleMosaic", x: 25, y: 15, width: 60, height: 40, blockSize: 20 },
    ellipseMosaic: { type: "ellipseMosaic", x: 25, y: 15, width: 60, height: 40, blockSize: 20 },
    brush: { type: "brushMosaic", points: [{ x: 25, y: 15 }, { x: 85, y: 55 }], brushSize: 16, blockSize: 20 },
    rectangleAnnotation: { type: "rectangleAnnotation", x: 25, y: 15, width: 60, height: 40, color: "#e53935", strokeWidth: 8 },
    ellipse: { type: "ellipseAnnotation", x: 25, y: 15, width: 60, height: 40, color: "#e53935", strokeWidth: 8 },
    arrow: { type: "arrowAnnotation", x1: 25, y1: 15, x2: 85, y2: 55, color: "#e53935", strokeWidth: 8 },
  };
  assert(Object.keys(DRAWING_TOOLS).every(tool => fixtures[tool]), "全描画ツールに独立した回帰テストが存在する");
  for (const pointerType of ["mouse", "touch"]) for (const [tool, descriptor] of Object.entries(DRAWING_TOOLS)) {
    editor.setImage(source); editor.setMosaicSize(20); editor.setBrushSize(16);
    editor.setAnnotationColor("#e53935"); editor.setAnnotationStrokeWidth(8);
    editor.setTool(tool);
    drag({ x: 25, y: 15 }, { x: 85, y: 55 }, pointerType);
    const original = resolveOperations(editor.state.operations)[0];
    const expectedOriginal = fixtures[tool];
    assert(original.type === descriptor.type && equivalent(original, expectedOriginal), `${tool}/${pointerType}: 作成座標と設定`);
    editor.setTool("select");
    drag({ x: 55, y: 35 }, { x: 95, y: 45 }, pointerType);
    assert(editor.selectedIndex === 0, `${tool}/${pointerType}: 選択`);
    const moved = tool === "brush" ? { ...expectedOriginal, points: expectedOriginal.points.map(p => ({ x: p.x + 40, y: p.y + 10 })) }
      : tool === "arrow" ? { ...expectedOriginal, x1: 65, y1: 25, x2: 125, y2: 65 }
      : { ...expectedOriginal, x: 65, y: 25 };
    const actual = resolveOperations(editor.state.operations)[0];
    assert(near(bounds(actual).x, bounds(moved).x) && near(bounds(actual).y, bounds(moved).y), `${tool}/${pointerType}: 移動座標`);
    if (tool === "brush") assert(actual.points.every((p, i) => near(p.x, moved.points[i].x) && near(p.y, moved.points[i].y)), "ブラシ全軌跡を移動");
    if (tool === "arrow") assert(near(actual.x2, moved.x2) && near(actual.y2, moved.y2), "矢印両端点を移動");
    assert(actual.color === original.color && actual.strokeWidth === original.strokeWidth, "編集で色・線幅を保持");
    editor.undo(); assert(JSON.stringify(resolveOperations(editor.state.operations)[0]) === JSON.stringify(original), `${tool}: 移動Undo`);
    editor.redo(); assert(JSON.stringify(resolveOperations(editor.state.operations)[0]) === JSON.stringify(actual), `${tool}: 移動Redo`);
    await checkExport(pixelsFor([moved]), `${tool}/${pointerType}: 保存PNGへ移動を反映し選択枠を除外`);
    const movedPixels = pixelsFor([moved]);
    assert(pixelsFor([original]).some((v, i) => v !== movedPixels[i]), `${tool}: 移動前後で保存画素が変わる`);
    // Select without creating a history entry, then manipulate the selected handle.
    drag({ x: 95, y: 45 }, { x: 95, y: 45 }, pointerType);
    for (const handle of handles(actual)) {
      const before = resolveOperations(editor.state.operations)[0];
      const currentHandle = handles(before).find(h => h.id === handle.id);
      const end = { x: currentHandle.x + 15, y: currentHandle.y + 8 };
      drag(currentHandle, end, pointerType);
      const resized = resolveOperations(editor.state.operations)[0];
      const expected = handle.id === "resize" ? { ...before, width: before.width + 15, height: before.height + 8 }
        : { ...before, [handle.id === "start" ? "x1" : "x2"]: end.x, [handle.id === "start" ? "y1" : "y2"]: end.y };
      assert(Object.keys(expected).every(k => typeof expected[k] !== "number" || near(expected[k], resized[k])), `${tool}/${pointerType}: サイズ・端点変更座標`);
      editor.undo(); assert(JSON.stringify(resolveOperations(editor.state.operations)[0]) === JSON.stringify(before), `${tool}: サイズUndo`);
      editor.redo(); assert(JSON.stringify(resolveOperations(editor.state.operations)[0]) === JSON.stringify(resized), `${tool}: サイズRedo`);
      await checkExport(pixelsFor([expected]), `${tool}: 保存PNGへサイズ変更を反映`);
      drag({ x: 95, y: 45 }, { x: 95, y: 45 }, pointerType);
    }
    const length = editor.state.operations.length;
    drag({ x: 95, y: 45 }, { x: 100, y: 50 }, pointerType, true);
    assert(editor.state.operations.length === length && editor.activeDraft === null, "pointercancelで編集を破棄");
  }
  editor.setImage(source);
  editor.commit(fixtures.rectangleAnnotation); editor.commit(fixtures.rectangle);
  editor.setTool("select"); drag({ x: 55, y: 35 }, { x: 55, y: 35 });
  assert(editor.selectedIndex === 0, "描画順に従いモザイクより前面の注釈を選択");
  editor.commit(fixtures.ellipse); drag({ x: 55, y: 35 }, { x: 55, y: 35 });
  assert(editor.selectedIndex === 2, "重なる注釈は最前面を選択");
  drag({ x: 180, y: 90 }, { x: 180, y: 90 });
  assert(editor.selectedIndex === null, "空白クリックで選択解除");
  editor.setTool("rectangleAnnotation"); drag({ x: 40, y: 25 }, { x: 70, y: 45 });
  assert(editor.state.operations.at(-1).type === "rectangleAnnotation", "描画モードは重なる新規図形を作成");
  editor.setTool("select");
  const length = editor.state.operations.length;
  editor.spacePressed = true; drag({ x: 55, y: 35 }, { x: 60, y: 40 }); editor.spacePressed = false;
  assert(editor.state.operations.length === length, "Spaceパンは編集履歴を変更しない");
  editor.onPointerDown({ pointerId: 1, button: 0, pointerType: "touch", ...clientPoint(55, 35) });
  editor.onPointerMove({ pointerId: 1, pointerType: "touch", ...clientPoint(60, 40) });
  editor.onPointerDown({ pointerId: 2, button: 0, pointerType: "touch", ...clientPoint(120, 65) });
  assert(editor.activeDraft === null && editor.pinch, "2本指は編集ドラフトを破棄しピンチへ切り替える");
  editor.onPointerUp({ pointerId: 2, pointerType: "touch" }); editor.onPointerUp({ pointerId: 1, pointerType: "touch" });
  assert(editor.state.operations.length === length, "ピンチ開始時の移動を確定しない");
  editor.state.zoom = 2;
  const selectedBeforeZoom = resolveOperations(editor.state.operations)[3];
  drag({ x: 55, y: 35 }, { x: 65, y: 40 });
  const selectedAfterZoom = resolveOperations(editor.state.operations)[3];
  assert(near(selectedAfterZoom.x, selectedBeforeZoom.x + 10) && near(selectedAfterZoom.y, selectedBeforeZoom.y + 5), "ズーム後も元画像座標で移動");
  const shapeCanvas = document.createElement("canvas");
  shapeCanvas.width = 120; shapeCanvas.height = 80;
  const shapeContext = shapeCanvas.getContext("2d");
  shapeContext.fillStyle = gradient;
  shapeContext.fillRect(0, 0, 120, 80);
  const corner = [...shapeContext.getImageData(31, 16, 1, 1).data];
  const center = [...shapeContext.getImageData(50, 30, 1, 1).data];
  renderOperations(shapeContext, shapeCanvas, [{ type: "ellipseMosaic", x: 30, y: 15, width: 60, height: 40, blockSize: 18 }], { scale: 1, offsetX: 0, offsetY: 0 });
  assert(corner.every((v, i) => v === shapeContext.getImageData(31, 16, 1, 1).data[i]), "楕円の外側にある矩形の角を変更しない");
  assert(center.some((v, i) => v !== shapeContext.getImageData(50, 30, 1, 1).data[i]), "楕円の内側だけモザイク化する");
  const unfilled = [...shapeContext.getImageData(60, 35, 1, 1).data];
  renderOperations(shapeContext, shapeCanvas, [{ type: "rectangleAnnotation", x: 30, y: 15, width: 60, height: 40, color: "#16a34a", strokeWidth: 4 }], { scale: 1, offsetX: 0, offsetY: 0 });
  assert(unfilled.every((v, i) => v === shapeContext.getImageData(60, 35, 1, 1).data[i]), "矩形注釈の内側を塗りつぶさない");
  assert(shapeContext.getImageData(30, 35, 1, 1).data[1] === 163, "矩形注釈の枠線を指定色で描画する");

  const expectedOutput = document.createElement("canvas");
  expectedOutput.width = source.width;
  expectedOutput.height = source.height;
  const expectedContext = expectedOutput.getContext("2d");
  expectedContext.drawImage(source, 0, 0);
  renderOperations(expectedContext, expectedOutput, editor.state.operations, { scale: 1, offsetX: 0, offsetY: 0, imageWidth: source.width, imageHeight: source.height });
  let outputBlob;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  try {
    URL.createObjectURL = (blob) => { outputBlob = blob; return originalCreateObjectURL.call(URL, blob); };
    HTMLAnchorElement.prototype.click = () => {};
    await exportImage(editor.state, "selection.png", "image/png");
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
  const outputImage = await createImageBitmap(outputBlob);
  assert(outputImage.width === source.width && outputImage.height === source.height, "選択枠表示中も保存画像の元解像度を維持する");
  const expectedPixels = expectedContext.getImageData(0, 0, source.width, source.height).data;
  expectedContext.clearRect(0, 0, source.width, source.height);
  expectedContext.drawImage(outputImage, 0, 0);
  const outputPixels = expectedContext.getImageData(0, 0, source.width, source.height).data;
  assert(expectedPixels.every((value, index) => value === outputPixels[index]), "保存PNGはモザイク描画のみと全画素が一致し選択枠を含まない");
  outputImage.close();
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
