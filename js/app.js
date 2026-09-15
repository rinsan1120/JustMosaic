import { MosaicEditor } from "./editor.js?v=3";
import { exportImage } from "./export.js?v=3";

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const elements = Object.fromEntries([
  "stage", "dropZone", "editorView", "editorCanvas", "openInitial", "openAnother", "fileInput",
  "loading", "message", "mosaicSize", "mosaicValue", "brushSize", "brushValue", "brushSizeRow",
  "annotationStrokeWidth", "annotationStrokeValue", "undo", "redo", "saveImage", "zoomIn", "zoomOut", "zoomReset", "zoomValue",
].map((id) => [id, document.getElementById(id)]));

let currentFile = null;
let currentObjectUrl = null;
let messageTimer = null;

const editor = new MosaicEditor(elements.editorCanvas, {
  onStateChange: updateInterface,
});

function updateInterface(state) {
  elements.undo.disabled = state.operations.length === 0;
  elements.redo.disabled = state.redoStack.length === 0;
  elements.saveImage.disabled = !state.sourceImage;
  elements.zoomValue.value = `${Math.round(state.zoom * 100)}%`;
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function showMessage(text, success = false) {
  window.clearTimeout(messageTimer);
  elements.message.textContent = text;
  elements.message.classList.toggle("is-success", success);
  elements.message.hidden = false;
  messageTimer = window.setTimeout(() => { elements.message.hidden = true; }, 4500);
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading;
  elements.openInitial.disabled = isLoading;
  elements.openAnother.disabled = isLoading;
}

function releaseCurrentImage() {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  currentFile = null;
}

async function decodeImage(file) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("DECODE_FAILED");
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!SUPPORTED_TYPES.has(file.type)) {
    showMessage("この画像形式には対応していません。JPEG、PNG、WebP形式の画像を選択してください。");
    return;
  }
  setLoading(true);
  try {
    const decoded = await decodeImage(file);
    releaseCurrentImage();
    currentFile = file;
    currentObjectUrl = decoded.objectUrl;
    elements.dropZone.hidden = true;
    elements.editorView.hidden = false;
    editor.setImage(decoded.image);
  } catch (error) {
    const likelyMemoryError = error instanceof RangeError || /memory|allocation/i.test(error?.message || "");
    showMessage(likelyMemoryError ? "画像サイズが大きすぎるため処理できませんでした。" : "画像を読み込めませんでした。別の画像をお試しください。");
  } finally {
    setLoading(false);
    elements.fileInput.value = "";
  }
}

function requestFile() {
  if (editor.state.operations.length > 0 && !window.confirm("現在の編集内容を破棄して、別の画像を開きますか？")) return;
  elements.fileInput.click();
}

elements.openInitial.addEventListener("click", requestFile);
elements.openAnother.addEventListener("click", requestFile);
elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));

for (const eventName of ["dragenter", "dragover"]) {
  elements.stage.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!editor.hasImage) elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.stage.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.stage.addEventListener("drop", (event) => {
  const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/")) || event.dataTransfer.files[0];
  if (editor.state.operations.length > 0 && !window.confirm("現在の編集内容を破棄して、別の画像を開きますか？")) return;
  loadFile(file);
});

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    editor.setTool(tool);
    document.querySelectorAll("[data-tool]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    const brushActive = tool === "brush";
    elements.brushSize.disabled = !brushActive;
    elements.brushSizeRow.classList.toggle("is-muted", !brushActive);
  });
});

elements.mosaicSize.addEventListener("input", () => {
  elements.mosaicValue.value = `${elements.mosaicSize.value} px`;
  elements.mosaicValue.textContent = `${elements.mosaicSize.value} px`;
  editor.setMosaicSize(elements.mosaicSize.value);
});
elements.brushSize.addEventListener("input", () => {
  elements.brushValue.value = `${elements.brushSize.value} px`;
  elements.brushValue.textContent = `${elements.brushSize.value} px`;
  editor.setBrushSize(elements.brushSize.value);
});
elements.annotationStrokeWidth.addEventListener("input", () => {
  elements.annotationStrokeValue.value = `${elements.annotationStrokeWidth.value} px`;
  elements.annotationStrokeValue.textContent = `${elements.annotationStrokeWidth.value} px`;
  editor.setAnnotationStrokeWidth(elements.annotationStrokeWidth.value);
});
document.querySelectorAll("[data-annotation-color]").forEach((button) => {
  button.addEventListener("click", () => {
    editor.setAnnotationColor(button.dataset.annotationColor);
    document.querySelectorAll("[data-annotation-color]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  });
});

elements.undo.addEventListener("click", () => editor.undo());
elements.redo.addEventListener("click", () => editor.redo());
elements.zoomIn.addEventListener("click", () => editor.zoomIn());
elements.zoomOut.addEventListener("click", () => editor.zoomOut());
elements.zoomReset.addEventListener("click", () => editor.resetView());

elements.saveImage.addEventListener("click", async () => {
  if (!currentFile || !editor.hasImage) return;
  elements.saveImage.disabled = true;
  elements.saveImage.textContent = "保存中…";
  try {
    await exportImage(editor.state, currentFile.name, currentFile.type);
    showMessage("元の解像度で画像を保存しました。", true);
  } catch (error) {
    const likelyMemoryError = error instanceof RangeError || /memory|allocation/i.test(error?.message || "");
    showMessage(likelyMemoryError ? "画像サイズが大きすぎるため保存できませんでした。" : "画像を保存できませんでした。もう一度お試しください。");
  } finally {
    elements.saveImage.textContent = "画像を保存";
    elements.saveImage.disabled = false;
  }
});

window.addEventListener("keydown", (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) editor.redo(); else editor.undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); editor.redo(); return; }
  editor.handleKeyDown(event);
});
window.addEventListener("keyup", (event) => editor.handleKeyUp(event));
window.addEventListener("blur", () => { editor.spacePressed = false; });
window.addEventListener("beforeunload", releaseCurrentImage);

updateInterface(editor.state);
