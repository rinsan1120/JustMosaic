import { renderOperations } from "./mosaic.js";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

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
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    };
    this.fitScale = 1;
    this.activeDraft = null;
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
    this.state.sourceImage = image;
    this.state.imageWidth = image.naturalWidth || image.width;
    this.state.imageHeight = image.naturalHeight || image.height;
    this.state.operations = [];
    this.state.redoStack = [];
    this.resetView();
    this.notifyState();
  }

  clearImage() {
    this.state.sourceImage = null;
    this.state.operations = [];
    this.state.redoStack = [];
    this.activeDraft = null;
    this.setHoverPointer(null);
    this.requestRender();
    this.notifyState();
  }

  setTool(tool) {
    this.state.tool = tool;
    this.canvas.classList.toggle("is-brush", tool === "brush");
    if (tool !== "brush") this.setHoverPointer(null);
    this.requestRender();
    this.notifyState();
  }

  setMosaicSize(value) { this.state.mosaicSize = Number(value); }
  setBrushSize(value) { this.state.brushSize = Number(value); this.requestRender(); }

  undo() {
    const operation = this.state.operations.pop();
    if (!operation) return;
    this.state.redoStack.push(operation);
    this.requestRender();
    this.notifyState();
  }

  redo() {
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
    return { x, y };
  }

  isInside(point) {
    return point.x >= 0 && point.y >= 0 && point.x <= this.state.imageWidth && point.y <= this.state.imageHeight;
  }

  commit(operation) {
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
    };
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      this.state.sourceImage,
      transform.offsetX,
      transform.offsetY,
      this.state.imageWidth * transform.scale,
      this.state.imageHeight * transform.scale,
    );
    renderOperations(ctx, this.canvas, this.state.operations, transform);
    if (this.activeDraft?.type === "brushMosaic") renderOperations(ctx, this.canvas, [this.activeDraft], transform);
    this.renderOverlay(ctx, transform, ratio);
  }

  renderOverlay(ctx, transform, ratio) {
    if (this.activeDraft?.type === "rectangleDraft") {
      const { start, end } = this.activeDraft;
      const x = transform.offsetX + Math.min(start.x, end.x) * transform.scale;
      const y = transform.offsetY + Math.min(start.y, end.y) * transform.scale;
      const width = Math.abs(end.x - start.x) * transform.scale;
      const height = Math.abs(end.y - start.y) * transform.scale;
      ctx.save();
      ctx.fillStyle = "rgba(76, 124, 255, .14)";
      ctx.strokeStyle = "#6f95ff";
      ctx.lineWidth = 2 * ratio;
      ctx.setLineDash([7 * ratio, 5 * ratio]);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
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
    if (!this.hasImage) return;
    this.updateHoverPointer(event);
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.activeDraft = null;
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
    if (this.state.tool === "rectangle") this.activeDraft = { type: "rectangleDraft", start: point, end: point };
    else this.activeDraft = { type: "brushMosaic", points: [point], brushSize: this.state.brushSize, blockSize: this.state.mosaicSize };
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
    if (this.activeDraft.type === "rectangleDraft") this.activeDraft.end = point;
    else {
      const last = this.activeDraft.points.at(-1);
      const minimumGap = Math.max(1, this.activeDraft.brushSize / 10);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= minimumGap) this.activeDraft.points.push(point);
    }
    this.requestRender();
  }

  onPointerUp(event, cancelled = false) {
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
      else this.requestRender();
      return;
    }
    if (this.activeDraft.type === "rectangleDraft") {
      const { start, end } = this.activeDraft;
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width >= 1 && height >= 1) this.commit({ type: "rectangleMosaic", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, blockSize: this.state.mosaicSize });
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
