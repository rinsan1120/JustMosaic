import { bounds, handles, contains, editObject } from "./objects.js?v=6";
import { renderOperations, resolveOperations } from "./mosaic.js?v=6";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const DRAW_HOLD_MS = 450;
const DRAG_THRESHOLD = 4;

export class MosaicEditor {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.callbacks = callbacks;
    this.state = {
      sourceImage: null,
      imageWidth: 0,
      imageHeight: 0,
      operations: [],
      redoStack: [],
      tool: "rectangle",
      mosaicSize: 20,
      brushSize: 80,
      annotationColor: "#e53935",
      annotationStrokeWidth: 8,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    };
    this.fitScale = 1;
    this.activeDraft = null;
    this.drawHoldTimer = null;
    this.hoverPointer = null;
    this.pointers = new Map();
    this.pinch = null;
    this.spacePressed = false;
    this.panStart = null;
    this.framePending = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.bindEvents();
  }

  get hasImage() { return Boolean(this.state.sourceImage); }
  get displayScale() { return this.fitScale * this.state.zoom; }

  setImage(image) {
    this.cancelDrawHold();
    this.activeDraft = null;
    this.selectedIndex = null;
    this.state.sourceImage = image;
    this.state.imageWidth = image.naturalWidth || image.width;
    this.state.imageHeight = image.naturalHeight || image.height;
    this.state.operations = [];
    this.state.redoStack = [];
    this.resetView();
    this.notifyState();
  }

  clearImage() {
    this.cancelDrawHold();
    this.selectedIndex = null;
    this.state.sourceImage = null;
    this.state.operations = [];
    this.state.redoStack = [];
    this.activeDraft = null;
    this.setHoverPointer(null);
    this.requestRender();
    this.notifyState();
  }

  setTool(tool) {
    this.cancelDrawHold();
    this.activeDraft = null;
    this.selectedIndex = null;
    this.state.tool = tool;
    this.canvas.classList.toggle("is-brush", tool === "brush");
    if (tool !== "brush") this.setHoverPointer(null);
    this.requestRender();
    this.notifyState();
  }

  setMosaicSize(value) {
    const blockSize = Number(value);
    this.state.mosaicSize = blockSize;

    for (const operation of this.state.operations) {
      const shape = operation.type === "shapeEdit" ? operation.operation : operation;
      if (shape.type.endsWith("Mosaic")) shape.blockSize = blockSize;
    }
    for (const operation of this.state.redoStack) {
      const shape = operation.type === "shapeEdit" ? operation.operation : operation;
      if (shape.type.endsWith("Mosaic")) shape.blockSize = blockSize;
    }
    if (this.activeDraft?.type === "brushMosaic") this.activeDraft.blockSize = blockSize;
    if (this.activeDraft?.operation?.type.endsWith("Mosaic")) this.activeDraft.operation.blockSize = blockSize;

    this.requestRender();
  }
  setBrushSize(value) { this.state.brushSize = Number(value); this.requestRender(); }
  setAnnotationColor(value) {
    this.state.annotationColor = value;
    const selected = this.selectedShapeIndex();
    if (resolveOperations(this.state.operations)[selected]?.type.endsWith("Annotation")) {
      for (const entry of [...this.state.operations, ...this.state.redoStack]) {
        const shape = entry.type === "shapeEdit" ? entry.operation : entry;
        if (entry === this.state.operations[selected] || entry.target === selected) shape.color = value;
      }
    }
    if (this.activeDraft?.type === "rectangleAnnotationDraft") this.activeDraft.color = value;
    if (this.activeDraft?.operation?.type.endsWith("Annotation")) this.activeDraft.operation.color = value;
    this.requestRender();
  }

  selectedShapeIndex() {
    if (this.selectedIndex != null && this.state.operations[this.selectedIndex]) return this.selectedIndex;
    return -1;
  }

  setAnnotationStrokeWidth(value) {
    const strokeWidth = Number(value);
    this.state.annotationStrokeWidth = strokeWidth;

    for (const operation of this.state.operations) {
      const shape = operation.type === "shapeEdit" ? operation.operation : operation;
      if (shape.type.endsWith("Annotation")) shape.strokeWidth = strokeWidth;
    }
    for (const operation of this.state.redoStack) {
      const shape = operation.type === "shapeEdit" ? operation.operation : operation;
      if (shape.type.endsWith("Annotation")) shape.strokeWidth = strokeWidth;
    }
    if (this.activeDraft?.type === "arrowDraft" || this.activeDraft?.type === "ellipseDraft" || this.activeDraft?.type === "rectangleAnnotationDraft") this.activeDraft.strokeWidth = strokeWidth;

    if (this.activeDraft?.operation?.type.endsWith("Annotation")) this.activeDraft.operation.strokeWidth = strokeWidth;
    this.requestRender();
  }

  undo() {
    this.cancelDrawHold();
    this.activeDraft = null;
    this.selectedIndex = null;
    const operation = this.state.operations.pop();
    if (!operation) return;
    this.state.redoStack.push(operation);
    this.requestRender();
    this.notifyState();
  }

  redo() {
    this.cancelDrawHold();
    this.activeDraft = null;
    this.selectedIndex = null;
    const operation = this.state.redoStack.pop();
    if (!operation) return;
    this.state.operations.push(operation);
    this.requestRender();
    this.notifyState();
  }

  resetView() {
    if (!this.hasImage || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
    this.fitScale = Math.min(
      this.canvas.clientWidth / this.state.imageWidth,
      this.canvas.clientHeight / this.state.imageHeight,
    ) * 0.94;
    this.state.zoom = 1;
    this.centerImage();
    this.requestRender();
    this.notifyState();
  }

  centerImage() {
    const width = this.state.imageWidth * this.displayScale;
    const height = this.state.imageHeight * this.displayScale;
    this.state.offsetX = (this.canvas.clientWidth - width) / 2;
    this.state.offsetY = (this.canvas.clientHeight - height) / 2;
  }

  zoomBy(factor, centerX = this.canvas.clientWidth / 2, centerY = this.canvas.clientHeight / 2) {
    if (!this.hasImage) return;
    const oldScale = this.displayScale;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.state.zoom * factor));
    const imageX = (centerX - this.state.offsetX) / oldScale;
    const imageY = (centerY - this.state.offsetY) / oldScale;
    this.state.zoom = nextZoom;
    const nextScale = this.displayScale;
    this.state.offsetX = centerX - imageX * nextScale;
    this.state.offsetY = centerY - imageY * nextScale;
    this.constrainPan();
    this.requestRender();
    this.notifyState();
  }

  zoomIn() { this.zoomBy(ZOOM_STEP); }
  zoomOut() { this.zoomBy(1 / ZOOM_STEP); }

  constrainPan() {
    const viewportWidth = this.canvas.clientWidth;
    const viewportHeight = this.canvas.clientHeight;
    const imageWidth = this.state.imageWidth * this.displayScale;
    const imageHeight = this.state.imageHeight * this.displayScale;
    const margin = 50;
    if (imageWidth <= viewportWidth) this.state.offsetX = (viewportWidth - imageWidth) / 2;
    else this.state.offsetX = Math.min(margin, Math.max(viewportWidth - imageWidth - margin, this.state.offsetX));
    if (imageHeight <= viewportHeight) this.state.offsetY = (viewportHeight - imageHeight) / 2;
    else this.state.offsetY = Math.min(margin, Math.max(viewportHeight - imageHeight - margin, this.state.offsetY));
  }

  imagePoint(clientX, clientY, clamp = false) {
    const rect = this.canvas.getBoundingClientRect();
    let x = (clientX - rect.left - this.state.offsetX) / this.displayScale;
    let y = (clientY - rect.top - this.state.offsetY) / this.displayScale;
    if (clamp) {
      x = Math.max(0, Math.min(this.state.imageWidth, x));
      y = Math.max(0, Math.min(this.state.imageHeight, y));
    }
    // Canvas clipping uses floor/ceil: floating point noise at an integer boundary
    // must not change the sampled mosaic region between devices or exports.
    return { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 };
  }

  isInside(point) {
    return point.x >= 0 && point.y >= 0 && point.x <= this.state.imageWidth && point.y <= this.state.imageHeight;
  }

  commit(operation) {
    this.selectedIndex = operation.type === "shapeEdit" ? operation.target : this.state.operations.length;
    this.state.operations.push(operation);
    this.state.redoStack = [];
    this.activeDraft = null;
    this.requestRender();
    this.notifyState();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const oldWidth = this.canvas.clientWidth;
    const oldHeight = this.canvas.clientHeight;
    this.canvas.style.width = `${Math.max(1, rect.width)}px`;
    this.canvas.style.height = `${Math.max(1, rect.height)}px`;
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    if (this.hasImage) {
      const previousFit = this.fitScale;
      this.fitScale = Math.min(rect.width / this.state.imageWidth, rect.height / this.state.imageHeight) * 0.94;
      if (!oldWidth || !oldHeight || this.state.zoom === 1) this.centerImage();
      else {
        this.state.offsetX += (rect.width - oldWidth) / 2;
        this.state.offsetY += (rect.height - oldHeight) / 2;
        if (previousFit) this.state.zoom *= previousFit / this.fitScale;
        this.constrainPan();
      }
    }
    this.requestRender();
  }

  requestRender() {
    if (this.framePending) return;
    this.framePending = true;
    requestAnimationFrame(() => { this.framePending = false; this.render(); });
  }

  render() {
    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#e9edf3";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.hasImage) return;

    const transform = {
      scale: this.displayScale * ratio,
      offsetX: this.state.offsetX * ratio,
      offsetY: this.state.offsetY * ratio,
      imageWidth: this.state.imageWidth,
      imageHeight: this.state.imageHeight,
    };
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      this.state.sourceImage,
      transform.offsetX,
      transform.offsetY,
      this.state.imageWidth * transform.scale,
      this.state.imageHeight * transform.scale,
    );
    const history = this.activeDraft?.type === "shapeEditDraft"
      ? [...this.state.operations, { type: "shapeEdit", target: this.activeDraft.target, operation: this.activeDraft.operation }]
      : this.state.operations;
    renderOperations(ctx, this.canvas, history, transform);
    if (this.activeDraft?.type === "brushMosaic") renderOperations(ctx, this.canvas, [this.activeDraft], transform);
    this.renderOverlay(ctx, transform, ratio);
  }

  renderOverlay(ctx, transform, ratio) {
    const isRectangleDraft = ["rectangleDraft", "ellipseMosaicDraft"].includes(this.activeDraft?.type);
    let rectangle = null;
    if (isRectangleDraft) {
      const { start, end } = this.activeDraft;
      rectangle = { type: this.activeDraft.type, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    } else {
      rectangle = resolveOperations(this.state.operations)[this.selectedShapeIndex()];
    }
    if (this.activeDraft?.type === "shapeEditDraft") rectangle = this.activeDraft.operation;
    if (rectangle) {
      const box = bounds(rectangle);
      const x = transform.offsetX + box.x * transform.scale;
      const y = transform.offsetY + box.y * transform.scale;
      const width = box.width * transform.scale;
      const height = box.height * transform.scale;
      ctx.save();
      ctx.fillStyle = "rgba(76, 124, 255, .14)";
      ctx.strokeStyle = "#6f95ff";
      ctx.lineWidth = 2 * ratio;
      ctx.setLineDash([7 * ratio, 5 * ratio]);
      if (["ellipseMosaic", "ellipseMosaicDraft"].includes(rectangle.type)) {
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (isRectangleDraft) ctx.fill();
        ctx.stroke();
      } else {
        if (isRectangleDraft) ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      }
      if (!isRectangleDraft) {
        ctx.setLineDash([]);
        for (const handle of handles(rectangle)) {
          const hx = transform.offsetX + handle.x * transform.scale;
          const hy = transform.offsetY + handle.y * transform.scale;
          ctx.fillStyle = "#fff";
          ctx.fillRect(hx - 6 * ratio, hy - 6 * ratio, 12 * ratio, 12 * ratio);
          ctx.strokeRect(hx - 6 * ratio, hy - 6 * ratio, 12 * ratio, 12 * ratio);
        }
      }
      ctx.restore();
    }

    if (this.activeDraft?.type === "arrowDraft" || this.activeDraft?.type === "ellipseDraft" || this.activeDraft?.type === "rectangleAnnotationDraft") {
      const { start, end, color, strokeWidth } = this.activeDraft;
      const operation = this.activeDraft.type === "arrowDraft"
        ? { type: "arrowAnnotation", x1: start.x, y1: start.y, x2: end.x, y2: end.y, color, strokeWidth }
        : { type: this.activeDraft.type === "rectangleAnnotationDraft" ? "rectangleAnnotation" : "ellipseAnnotation", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), color, strokeWidth };
      renderOperations(ctx, this.canvas, [operation], transform);
    }

    if (this.state.tool === "brush" && this.hoverPointer && !this.panStart && !this.pinch) {
      const x = transform.offsetX + this.hoverPointer.x * transform.scale;
      const y = transform.offsetY + this.hoverPointer.y * transform.scale;
      const brushSize = this.activeDraft?.type === "brushMosaic" ? this.activeDraft.brushSize : this.state.brushSize;
      const radius = (brushSize * transform.scale) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, .7)";
      ctx.lineWidth = 3 * ratio;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, .95)";
      ctx.lineWidth = 1.5 * ratio;
      ctx.stroke();
      ctx.restore();
    }
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerenter", (event) => this.updateHoverPointer(event));
    this.canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") this.setHoverPointer(null);
    });
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event, true));
    this.canvas.addEventListener("wheel", (event) => {
      if (!this.hasImage) return;
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
  }

  onPointerDown(event) {
    this.cancelDrawHold();
    if (!this.hasImage) return;
    this.updateHoverPointer(event);
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.activeDraft = null;
      this.panStart = null;
      this.canvas.classList.remove("is-panning");
      this.setHoverPointer(null);
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.state.zoom,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        offset: { x: this.state.offsetX, y: this.state.offsetY },
      };
      return;
    }

    if (event.button === 1 || this.spacePressed) {
      this.panStart = { x: event.clientX, y: event.clientY, offsetX: this.state.offsetX, offsetY: this.state.offsetY };
      this.setHoverPointer(null);
      this.canvas.classList.add("is-panning");
      return;
    }
    if (event.button !== 0) return;
    const point = this.imagePoint(event.clientX, event.clientY);
    if (!this.isInside(point)) return;
    if (!event.altKey) {
      const operations = resolveOperations(this.state.operations);
      const tolerance = (event.pointerType === "touch" ? 22 : 10) / this.displayScale;
      const selected = operations[this.selectedIndex];
      const handle = selected && handles(selected).find(h => Math.hypot(point.x - h.x, point.y - h.y) <= tolerance);
      // Match rendering: annotations are above mosaics, then latest creation first.
      const indices = operations.map((object, index) => object ? index : null).filter(index => index != null)
        .sort((a, b) => Number(operations[b].type.endsWith("Annotation")) - Number(operations[a].type.endsWith("Annotation")) || b - a);
      const index = handle ? this.selectedIndex : indices.find(i => contains(operations[i], point, tolerance));
      this.selectedIndex = index ?? null;
      if (index != null) {
        this.activeDraft = { type: "shapeEditDraft", target: index, start: point, original: operations[index], operation: operations[index], handle: handle?.id };
        if (!handle) {
          const draft = this.activeDraft;
          this.drawHoldTimer = setTimeout(() => {
            this.drawHoldTimer = null;
            if (this.activeDraft === draft && this.pointers.size === 1) this.beginDrawing(point);
          }, DRAW_HOLD_MS);
        }
        this.requestRender();
        return;
      }
    }
    this.beginDrawing(point);
  }

  cancelDrawHold() {
    clearTimeout(this.drawHoldTimer);
    this.drawHoldTimer = null;
  }

  beginDrawing(point) {
    this.cancelDrawHold();
    this.selectedIndex = null;
    if (this.state.tool === "ellipseMosaic") this.activeDraft = { type: "ellipseMosaicDraft", start: point, end: point };
    else if (this.state.tool === "rectangle") this.activeDraft = { type: "rectangleDraft", start: point, end: point };
    else if (this.state.tool === "brush") this.activeDraft = { type: "brushMosaic", points: [point], brushSize: this.state.brushSize, blockSize: this.state.mosaicSize };
    else this.activeDraft = {
      type: this.state.tool === "arrow" ? "arrowDraft" : this.state.tool === "rectangleAnnotation" ? "rectangleAnnotationDraft" : "ellipseDraft",
      start: point,
      end: point,
      color: this.state.annotationColor,
      strokeWidth: this.state.annotationStrokeWidth,
    };
    this.requestRender();
  }

  onPointerMove(event) {
    this.updateHoverPointer(event);
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = this.canvas.getBoundingClientRect();
      const startCenterX = this.pinch.midpoint.x - rect.left;
      const startCenterY = this.pinch.midpoint.y - rect.top;
      const oldScale = this.fitScale * this.pinch.zoom;
      const imageX = (startCenterX - this.pinch.offset.x) / oldScale;
      const imageY = (startCenterY - this.pinch.offset.y) / oldScale;
      this.state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.pinch.zoom * distance / this.pinch.distance));
      const centerX = midpoint.x - rect.left;
      const centerY = midpoint.y - rect.top;
      this.state.offsetX = centerX - imageX * this.displayScale;
      this.state.offsetY = centerY - imageY * this.displayScale;
      this.constrainPan();
      this.requestRender();
      this.notifyState();
      return;
    }
    if (this.panStart) {
      this.state.offsetX = this.panStart.offsetX + event.clientX - this.panStart.x;
      this.state.offsetY = this.panStart.offsetY + event.clientY - this.panStart.y;
      this.constrainPan();
      this.requestRender();
      return;
    }
    if (!this.activeDraft) return;
    const point = this.imagePoint(event.clientX, event.clientY, true);
    if (this.activeDraft.type === "shapeEditDraft") {
      const { original, start, handle } = this.activeDraft;
      if (!handle && !this.activeDraft.moved) {
        if (Math.hypot(point.x - start.x, point.y - start.y) * this.displayScale < DRAG_THRESHOLD) return;
        this.activeDraft.moved = true;
        this.cancelDrawHold();
      }
      this.activeDraft.operation = editObject(original, start, point, handle, this.state.imageWidth, this.state.imageHeight);
    } else if (this.activeDraft.type === "ellipseMosaicDraft" || this.activeDraft.type === "rectangleAnnotationDraft" || this.activeDraft.type === "rectangleDraft" || this.activeDraft.type === "arrowDraft" || this.activeDraft.type === "ellipseDraft") this.activeDraft.end = point;
    else {
      const last = this.activeDraft.points.at(-1);
      const minimumGap = Math.max(1, this.activeDraft.brushSize / 10);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= minimumGap) this.activeDraft.points.push(point);
    }
    this.requestRender();
  }

  onPointerUp(event, cancelled = false) {
    if (!this.pointers.has(event.pointerId)) return;
    this.cancelDrawHold();
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.panStart) {
      this.panStart = null;
      this.canvas.classList.remove("is-panning");
      if (cancelled) this.setHoverPointer(null);
      else this.updateHoverPointer(event);
      return;
    }
    if (cancelled || !this.activeDraft) {
      this.activeDraft = null;
      if (cancelled) this.setHoverPointer(null);
      this.requestRender();
      return;
    }
    if (this.activeDraft.type === "shapeEditDraft") {
      const { target, operation, original } = this.activeDraft;
      if (JSON.stringify(operation) !== JSON.stringify(original)) this.commit({ type: "shapeEdit", target, operation });
      else { this.activeDraft = null; this.requestRender(); }
    } else if (this.activeDraft.type === "rectangleDraft" || this.activeDraft.type === "ellipseMosaicDraft") {
      const { start, end } = this.activeDraft;
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width >= 1 && height >= 1) this.commit({ type: this.activeDraft.type === "ellipseMosaicDraft" ? "ellipseMosaic" : "rectangleMosaic", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, blockSize: this.state.mosaicSize });
      else { this.activeDraft = null; this.requestRender(); }
    } else if (this.activeDraft.type === "arrowDraft") {
      const { start, end, color, strokeWidth } = this.activeDraft;
      if (Math.hypot(end.x - start.x, end.y - start.y) >= 1) this.commit({ type: "arrowAnnotation", x1: start.x, y1: start.y, x2: end.x, y2: end.y, color, strokeWidth });
      else { this.activeDraft = null; this.requestRender(); }
    } else if (this.activeDraft.type === "ellipseDraft" || this.activeDraft.type === "rectangleAnnotationDraft") {
      const { start, end, color, strokeWidth } = this.activeDraft;
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width >= 1 && height >= 1) this.commit({ type: this.activeDraft.type === "rectangleAnnotationDraft" ? "rectangleAnnotation" : "ellipseAnnotation", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, color, strokeWidth });
      else { this.activeDraft = null; this.requestRender(); }
    } else this.commit(this.activeDraft);
  }

  handleKeyDown(event) {
    if (event.code === "Space" && !event.repeat) { this.spacePressed = true; event.preventDefault(); }
  }
  handleKeyUp(event) { if (event.code === "Space") this.spacePressed = false; }

  setHoverPointer(point) {
    this.hoverPointer = point;
    this.canvas.classList.toggle("has-brush-cursor", Boolean(point));
    this.requestRender();
  }

  updateHoverPointer(event) {
    const supportsHover = event.pointerType === "mouse" || event.pointerType === "pen";
    if (!supportsHover || !this.hasImage || this.state.tool !== "brush" || this.panStart || this.pinch) {
      this.setHoverPointer(null);
      return;
    }
    const point = this.imagePoint(event.clientX, event.clientY);
    this.setHoverPointer(this.isInside(point) ? point : null);
  }

  notifyState() { this.callbacks.onStateChange?.(this.state); }
}
