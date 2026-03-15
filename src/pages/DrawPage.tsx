import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

// --- Color Palettes ---
const CLASSIC_COLORS = [
  "#FFFFFF", "#000000", "#333333", "#666666",
  "#C0392B", "#E74C3C", "#2980B9", "#3498DB",
  "#27AE60", "#2ECC71", "#F39C12", "#F1C40F",
  "#8E44AD", "#9B59B6", "#1ABC9C", "#E67E22",
  "#2C3E50", "#7F8C8D",
];

const GLITTER_COLORS = [
  "#FF3B3B", "#FF6B6B", "#FF9F1C", "#FFE66D",
  "#00F5A0", "#4ECDC4", "#2BCBFF", "#9B5DE5",
  "#F04299", "#FF85C0",
  "#39FF14", "#FF073A", "#DFFF00", "#FF6EC7",
  "#FFB3BA", "#BAFFC9", "#BAE1FF", "#E8BAFF",
];

type BrushMode = "classic" | "glitter" | "rainbow";

const ERASER_RADIUS = 45;

// --- 1€ (One Euro) Adaptive Filter ---
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private smoothingFactor(cutoff: number, dt: number): number {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }

  filter(x: number, timestamp: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = timestamp;
      return x;
    }
    const dt = Math.max((timestamp - this.tPrev) / 1000, 0.001);
    this.tPrev = timestamp;
    const dx = (x - this.xPrev) / dt;
    const aD = this.smoothingFactor(this.dCutoff, dt);
    const dxSmoothed = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxSmoothed;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmoothed);
    const a = this.smoothingFactor(cutoff, dt);
    const xFiltered = a * x + (1 - a) * this.xPrev;
    this.xPrev = xFiltered;
    return xFiltered;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

const HISTORY_SIZE = 5;
const OUTLIER_MULTIPLIER = 3.5;
const MIN_POINT_DISTANCE = 4;
const HOLD_FRAMES_THRESHOLD = 15;

const RAINBOW_SEQUENCE = [
  "#FF0000", "#FF7F00", "#FFFF00", "#00FF00",
  "#0000FF", "#4B0082", "#8B00FF",
];

interface Point { x: number; y: number; }
interface Drawing {
  points: Point[];
  color: string;
  id: number;
  holdFrames: number;
  isShape: boolean;
  brushMode: BrushMode;
  strokeWidth: number;
  filled: boolean;
  // For rainbow mode, store color per segment
  segmentColors?: string[];
}

const DrawPage = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [currentColor, setCurrentColor] = useState("#FF3B3B");
  const [gestureText, setGestureText] = useState("");
  const [gestureVisible, setGestureVisible] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>("classic");
  const [strokeWidth, setStrokeWidth] = useState(6);
  const [fillMode, setFillMode] = useState(false);
  const [showBrushPanel, setShowBrushPanel] = useState(false);

  const drawingsRef = useRef<Drawing[]>([]);
  const currentPathRef = useRef<Drawing | null>(null);
  const selectedDrawingRef = useRef<Drawing | null>(null);
  const isDraggingRef = useRef(false);
  const lastFingerPosRef = useRef({ x: 0, y: 0 });
  const filterXRef = useRef<OneEuroFilter>(new OneEuroFilter(1.0, 0.007, 1.0));
  const filterYRef = useRef<OneEuroFilter>(new OneEuroFilter(1.0, 0.007, 1.0));
  const posHistoryRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const eraserFilterXRef = useRef<OneEuroFilter>(new OneEuroFilter(1.5, 0.005, 1.0));
  const eraserFilterYRef = useRef<OneEuroFilter>(new OneEuroFilter(1.5, 0.005, 1.0));
  const pinchFilterXRef = useRef<OneEuroFilter>(new OneEuroFilter(1.5, 0.005, 1.0));
  const pinchFilterYRef = useRef<OneEuroFilter>(new OneEuroFilter(1.5, 0.005, 1.0));
  const animTickRef = useRef(0);
  const currentColorRef = useRef(currentColor);
  const brushModeRef = useRef(brushMode);
  const strokeWidthRef = useRef(strokeWidth);
  const fillModeRef = useRef(fillMode);
  const rainbowIndexRef = useRef(0);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { currentColorRef.current = currentColor; }, [currentColor]);
  useEffect(() => { brushModeRef.current = brushMode; }, [brushMode]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { fillModeRef.current = fillMode; }, [fillMode]);

  const showGesture = useCallback((text: string) => {
    setGestureText(text);
    setGestureVisible(true);
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => setGestureVisible(false), 1200);
  }, []);

  const downloadDoodle = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.save();
    tempCtx.translate(tempCanvas.width, 0);
    tempCtx.scale(-1, 1);
    tempCtx.drawImage(canvas, 0, 0);
    tempCtx.restore();
    const link = document.createElement("a");
    link.download = `my-doodle-${Date.now()}.png`;
    link.href = tempCanvas.toDataURL("image/png");
    link.click();
    showGesture("📸 Saved!");
  }, [showGesture]);

  const clearAll = useCallback(() => {
    drawingsRef.current = [];
    currentPathRef.current = null;
    showGesture("🗑️ All Clear!");
  }, [showGesture]);

  const undo = useCallback(() => {
    if (drawingsRef.current.length > 0) {
      drawingsRef.current.pop();
      showGesture("↩️ Undo!");
    }
  }, [showGesture]);

  const activeColors = brushMode === "classic" ? CLASSIC_COLORS : GLITTER_COLORS;

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d")!;

    function setupCanvas() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    setupCanvas();
    window.addEventListener("resize", setupCanvas);

    function hexToRgb(hex: string) {
      hex = hex.replace("#", "");
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
      };
    }

    function seededRand(seed: number) {
      let x = Math.sin(seed) * 43758.5453123;
      return x - Math.floor(x);
    }

    function getRawDistance(p1: any, p2: any) {
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    function isStrictlyIndexUp(lm: any[]) {
      return lm[8].y < lm[6].y && !(lm[12].y < lm[10].y) && !(lm[16].y < lm[14].y) && !(lm[20].y < lm[18].y);
    }

    function isIndexAndMiddleUp(lm: any[]) {
      return lm[8].y < lm[6].y && lm[12].y < lm[10].y && !(lm[16].y < lm[14].y) && !(lm[20].y < lm[18].y);
    }

    function isThreeFingersUp(lm: any[]) {
      return lm[8].y < lm[6].y && lm[12].y < lm[10].y && lm[16].y < lm[14].y && !(lm[20].y < lm[18].y);
    }

    function isPinching(lm: any[]) {
      return getRawDistance(lm[4], lm[8]) < 0.06;
    }

    function findDrawingAt(x: number, y: number) {
      const padding = 50;
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const d = drawingsRef.current[i];
        if (d.points.length === 0) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of d.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        if (x >= minX - padding && x <= maxX + padding && y >= minY - padding && y <= maxY + padding) return d;
      }
      return null;
    }

    function eraseAt(ex: number, ey: number) {
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const d = drawingsRef.current[i];
        const origIndices = d.points.map((p) => ({ ...p, keep: Math.hypot(p.x - ex, p.y - ey) > ERASER_RADIUS }));
        const anyErased = origIndices.some((p) => !p.keep);
        if (!anyErased) continue;
        const allErased = origIndices.every((p) => !p.keep);
        if (allErased) { drawingsRef.current.splice(i, 1); continue; }
        const newSegments: Point[][] = [];
        let segment: Point[] = [];
        for (const p of origIndices) {
          if (p.keep) { segment.push({ x: p.x, y: p.y }); } else { if (segment.length >= 2) newSegments.push(segment); segment = []; }
        }
        if (segment.length >= 2) newSegments.push(segment);
        drawingsRef.current.splice(i, 1);
        for (const seg of newSegments) {
          drawingsRef.current.splice(i, 0, { points: seg, color: d.color, id: Date.now() + Math.random(), holdFrames: 0, isShape: false, brushMode: d.brushMode, strokeWidth: d.strokeWidth, filled: d.filled, segmentColors: d.segmentColors });
        }
      }
    }

    function findCorners(pts: Point[]): Point[] {
      if (pts.length < 10) return [];
      const step = Math.max(1, Math.floor(pts.length / 40));
      const angles: { idx: number; angle: number }[] = [];
      for (let i = step; i < pts.length - step; i += step) {
        const prev = pts[Math.max(0, i - step)], curr = pts[i], next = pts[Math.min(pts.length - 1, i + step)];
        const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
        let diff = Math.abs(a2 - a1);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > 0.35) angles.push({ idx: i, angle: diff });
      }
      const merged: Point[] = [];
      for (const a of angles) {
        const last = merged[merged.length - 1];
        if (last && Math.hypot(pts[a.idx].x - last.x, pts[a.idx].y - last.y) < 50) continue;
        merged.push(pts[a.idx]);
      }
      return merged;
    }

    function isOutlier(nx: number, ny: number, now: number): boolean {
      const hist = posHistoryRef.current;
      if (hist.length < 2) return false;
      let totalDist = 0;
      for (let i = 1; i < hist.length; i++) {
        totalDist += Math.hypot(hist[i].x - hist[i - 1].x, hist[i].y - hist[i - 1].y);
      }
      const avgStep = totalDist / (hist.length - 1);
      const last = hist[hist.length - 1];
      const jump = Math.hypot(nx - last.x, ny - last.y);
      return jump > Math.max(avgStep * OUTLIER_MULTIPLIER, 60);
    }

    function pushHistory(x: number, y: number, t: number) {
      const hist = posHistoryRef.current;
      hist.push({ x, y, t });
      if (hist.length > HISTORY_SIZE) hist.shift();
    }

    function recognizeAndRefineShape(path: Drawing) {
      if (!path || path.points.length < 15) return;
      const pts = path.points;
      const first = pts[0], last = pts[pts.length - 1];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      const width = maxX - minX, height = maxY - minY, diag = Math.hypot(width, height);
      if (diag < 40) return;
      const closureDist = Math.hypot(first.x - last.x, first.y - last.y);
      const isClosed = closureDist < diag * 0.3;
      const cx = minX + width / 2, cy = minY + height / 2;

      if (isClosed) {
        const avgRadius = (width + height) / 4;
        const aspectRatio = Math.max(width, height) / Math.min(width, height);
        if (aspectRatio < 1.35) {
          let totalDeviation = 0;
          for (const p of pts) totalDeviation += Math.abs(Math.hypot(p.x - cx, p.y - cy) - avgRadius);
          if (totalDeviation / pts.length < avgRadius * 0.22) {
            const newPts: Point[] = [];
            for (let i = 0; i <= 40; i++) { const angle = (i / 40) * Math.PI * 2; newPts.push({ x: cx + Math.cos(angle) * avgRadius, y: cy + Math.sin(angle) * avgRadius }); }
            path.points = newPts; path.isShape = true;
            if (fillModeRef.current) path.filled = true;
            showGesture("✨ Perfect Circle!"); return;
          }
        }
        const corners = findCorners(pts);
        if (corners.length === 3) {
          const [a, b, c] = corners;
          path.points = [a, b, c, a];
          path.isShape = true;
          if (fillModeRef.current) path.filled = true;
          showGesture("🔺 Perfect Triangle!"); return;
        }
        if (corners.length === 4) {
          const [a, b, c, d] = corners;
          const sides = [
            Math.hypot(b.x-a.x, b.y-a.y), Math.hypot(c.x-b.x, c.y-b.y),
            Math.hypot(d.x-c.x, d.y-c.y), Math.hypot(a.x-d.x, a.y-d.y)
          ];
          const avgSide = sides.reduce((s,v)=>s+v,0)/4;
          const sideVar = sides.every(s => Math.abs(s - avgSide) < avgSide * 0.35);
          if (sideVar) {
            const topIdx = [a,b,c,d].reduce((mi, p, i, arr) => p.y < arr[mi].y ? i : mi, 0);
            const sorted = [...[a,b,c,d].slice(topIdx), ...[a,b,c,d].slice(0, topIdx)];
            const isAxisAligned = Math.abs(sorted[0].x - cx) < width * 0.15;
            if (isAxisAligned) {
              const r = avgSide / Math.sqrt(2);
              path.points = [
                { x: cx, y: cy - r }, { x: cx + r, y: cy },
                { x: cx, y: cy + r }, { x: cx - r, y: cy },
                { x: cx, y: cy - r }
              ];
              path.isShape = true;
              if (fillModeRef.current) path.filled = true;
              showGesture("💎 Perfect Diamond!"); return;
            }
          }
        }

        let edgeDev = 0;
        for (const p of pts) edgeDev += Math.min(Math.abs(p.x - minX), Math.abs(p.x - maxX), Math.abs(p.y - minY), Math.abs(p.y - maxY));
        if (edgeDev / pts.length < Math.min(width, height) * 0.13) {
          const isSquare = Math.max(width, height) / Math.min(width, height) < 1.35;
          const sizeX = isSquare ? Math.max(width, height) : width;
          const sizeY = isSquare ? Math.max(width, height) : height;
          path.points = [{ x: cx - sizeX / 2, y: cy - sizeY / 2 }, { x: cx + sizeX / 2, y: cy - sizeY / 2 }, { x: cx + sizeX / 2, y: cy + sizeY / 2 }, { x: cx - sizeX / 2, y: cy + sizeY / 2 }, { x: cx - sizeX / 2, y: cy - sizeY / 2 }];
          path.isShape = true;
          if (fillModeRef.current) path.filled = true;
          showGesture(isSquare ? "🟩 Perfect Square!" : "🔲 Perfect Rectangle!"); return;
        }
      } else {
        const lineLen = Math.hypot(last.x - first.x, last.y - first.y);
        if (lineLen > 60) {
          let totalDev = 0;
          for (const p of pts) totalDev += Math.abs((last.y - first.y) * p.x - (last.x - first.x) * p.y + last.x * first.y - last.y * first.x) / lineLen;
          if (totalDev / pts.length < 20) { path.points = [first, last]; path.isShape = true; showGesture("📏 Straight Line!"); }
        }
      }
    }

    function drawPointerCursor(x: number, y: number) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }

    function drawEraserCursor(x: number, y: number) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,100,100,0.12)"; ctx.fill();
      ctx.restore();
    }

    function fillClosedShape(d: Drawing) {
      if (!d.filled || d.points.length < 3) return;
      const color = d.color;
      const rgb = hexToRgb(color);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) {
        ctx.lineTo(d.points[i].x, d.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
      ctx.fill();
      ctx.restore();
    }

    function drawStoredPaths() {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      drawingsRef.current.forEach((d, dIdx) => {
        if (d.points.length < 2) return;
        const isSelected = selectedDrawingRef.current && selectedDrawingRef.current.id === d.id;
        const color = d.color || "#FF3B3B";
        const rgb = hexToRgb(color);
        const sw = d.strokeWidth || 6;
        ctx.save();

        // Fill closed shapes if filled
        if (d.filled && d.isShape) {
          fillClosedShape(d);
        }

        if (d.brushMode === "rainbow" && d.segmentColors && d.segmentColors.length > 0) {
          // Rainbow mode: draw each segment with its own color
          for (let i = 1; i < d.points.length; i++) {
            const segColor = d.segmentColors[Math.min(i - 1, d.segmentColors.length - 1)] || color;
            const segRgb = hexToRgb(segColor);
            ctx.beginPath();
            ctx.moveTo(d.points[i - 1].x, d.points[i - 1].y);
            ctx.lineTo(d.points[i].x, d.points[i].y);

            // Outer glow
            ctx.shadowBlur = sw * 2;
            ctx.shadowColor = segColor;
            ctx.strokeStyle = `rgba(${segRgb.r},${segRgb.g},${segRgb.b},0.5)`;
            ctx.lineWidth = sw + 4;
            ctx.stroke();

            // Main stroke
            ctx.shadowBlur = 0;
            ctx.strokeStyle = segColor;
            ctx.lineWidth = sw;
            ctx.stroke();

            // Inner highlight
            ctx.strokeStyle = `rgba(${Math.min(255, segRgb.r + 80)},${Math.min(255, segRgb.g + 80)},${Math.min(255, segRgb.b + 80)},0.5)`;
            ctx.lineWidth = Math.max(1, sw * 0.3);
            ctx.stroke();
          }
        } else {
          // Classic or glitter stroke
          const drawStroke = () => {
            ctx.beginPath();
            if (d.points.length > 0) {
              ctx.moveTo(d.points[0].x, d.points[0].y);
              if (d.isShape) {
                for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
              } else {
                for (let i = 1; i < d.points.length - 1; i++) {
                  const xc = (d.points[i].x + d.points[i + 1].x) / 2;
                  const yc = (d.points[i].y + d.points[i + 1].y) / 2;
                  ctx.quadraticCurveTo(d.points[i].x, d.points[i].y, xc, yc);
                }
                if (d.points.length > 1) { const last = d.points[d.points.length - 1]; ctx.lineTo(last.x, last.y); }
              }
            }
            ctx.lineJoin = d.isShape ? "miter" : "round";
            ctx.stroke();
          };

          if (d.brushMode === "glitter") {
            // Neon glow for glitter
            ctx.shadowBlur = isSelected ? sw * 3 : sw * 2.5;
            ctx.shadowColor = color;
            ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`;
            ctx.lineWidth = sw + 6;
            drawStroke();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = color;
            ctx.lineWidth = sw;
            drawStroke();

            ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 80)},${Math.min(255, rgb.g + 80)},${Math.min(255, rgb.b + 80)},0.7)`;
            ctx.lineWidth = Math.max(1, sw * 0.3);
            drawStroke();
          } else {
            // Classic: clean solid stroke, no glow
            ctx.strokeStyle = color;
            ctx.lineWidth = sw;
            drawStroke();

            // Subtle inner highlight for depth
            ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 40)},${Math.min(255, rgb.g + 40)},${Math.min(255, rgb.b + 40)},0.3)`;
            ctx.lineWidth = Math.max(1, sw * 0.25);
            drawStroke();
          }
        }

        ctx.restore();

        // Glitter particles only for glitter brush
        if (d.brushMode === "glitter") {
          ctx.save();
          const time = animTickRef.current * 0.05;
          for (let i = 0; i < d.points.length; i += 3) {
            const p = d.points[i];
            for (let j = 0; j < 5; j++) {
              const seed = dIdx * 10000 + i * 100 + j;
              const r1 = seededRand(seed), r2 = seededRand(seed + 0.5), r3 = seededRand(seed + 1.0), r4 = seededRand(seed + 1.5);
              const twinkle = Math.sin(time + r1 * 20) * 0.5 + 0.5;
              if (twinkle < 0.25) continue;
              const gx = p.x + (r2 - 0.5) * 24, gy = p.y + (r3 - 0.5) * 24;
              const size = r4 * 3.0 + 0.8;
              const mw = twinkle * 0.7;
              ctx.globalAlpha = twinkle * 0.9;
              ctx.fillStyle = `rgb(${Math.round(rgb.r + (255 - rgb.r) * mw)},${Math.round(rgb.g + (255 - rgb.g) * mw)},${Math.round(rgb.b + (255 - rgb.b) * mw)})`;
              ctx.beginPath(); ctx.arc(gx, gy, size, 0, Math.PI * 2); ctx.fill();
            }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        // Selection indicator: subtle white dashed outline instead of yellow glow
        if (isSelected) {
          ctx.save();
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of d.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          const pad = 12;
          ctx.setLineDash([8, 4]);
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2;
          ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
          ctx.setLineDash([]);
          ctx.restore();
        }
      });
    }

    function drawNeonSkeleton(landmarks: any[]) {
      ctx.save();
      ctx.shadowBlur = 15; ctx.shadowColor = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
      connections.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(landmarks[a].x * canvas!.width, landmarks[a].y * canvas!.height);
        ctx.lineTo(landmarks[b].x * canvas!.width, landmarks[b].y * canvas!.height);
        ctx.stroke();
      });
      ctx.fillStyle = "#ffffff";
      landmarks.forEach((point) => {
        ctx.beginPath(); ctx.arc(point.x * canvas!.width, point.y * canvas!.height, 4, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }

    function onResults(results: any) {
      setLoading(false);
      animTickRef.current++;
      ctx.save();
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas!.width, canvas!.height);
      drawStoredPaths();

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        let ix = hand[8].x * canvas!.width, iy = hand[8].y * canvas!.height;
        const mx = hand[12].x * canvas!.width, my = hand[12].y * canvas!.height;
        const rx = hand[16].x * canvas!.width, ry = hand[16].y * canvas!.height;
        const tx = hand[4].x * canvas!.width, ty = hand[4].y * canvas!.height;

        if (isThreeFingersUp(hand)) {
          const rawEx = (ix + mx + rx) / 3, rawEy = (iy + my + ry) / 3;
          const now = performance.now();
          const ex = eraserFilterXRef.current.filter(rawEx, now);
          const ey = eraserFilterYRef.current.filter(rawEy, now);
          eraseAt(ex, ey); drawEraserCursor(ex, ey);
          currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isIndexAndMiddleUp(hand)) {
          drawPointerCursor((ix + mx) / 2, (iy + my) / 2);
          currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isStrictlyIndexUp(hand) && !isPinching(hand)) {
          const now = performance.now();
          if (!isOutlier(ix, iy, now)) {
            pushHistory(ix, iy, now);
            ix = filterXRef.current.filter(ix, now);
            iy = filterYRef.current.filter(iy, now);
          } else {
            const hist = posHistoryRef.current;
            if (hist.length > 0) {
              ix = hist[hist.length - 1].x;
              iy = hist[hist.length - 1].y;
            }
          }

          if (!currentPathRef.current) {
            currentPathRef.current = {
              points: [], color: currentColorRef.current, id: Date.now(), holdFrames: 0, isShape: false,
              brushMode: brushModeRef.current, strokeWidth: strokeWidthRef.current, filled: false,
              segmentColors: [],
            };
            drawingsRef.current.push(currentPathRef.current);
            rainbowIndexRef.current = 0;
          }
          const cp = currentPathRef.current;
          const lastPt = cp.points[cp.points.length - 1];
          const distToLast = lastPt ? Math.hypot(lastPt.x - ix, lastPt.y - iy) : Infinity;

          if (distToLast < 8) { cp.holdFrames++; if (cp.holdFrames > HOLD_FRAMES_THRESHOLD && !cp.isShape) recognizeAndRefineShape(cp); }
          else cp.holdFrames = 0;
          if (!cp.isShape && (!lastPt || distToLast > MIN_POINT_DISTANCE)) {
            cp.points.push({ x: ix, y: iy });
            // For rainbow mode, cycle colors per segment
            if (cp.brushMode === "rainbow") {
              const rIdx = rainbowIndexRef.current % RAINBOW_SEQUENCE.length;
              if (!cp.segmentColors) cp.segmentColors = [];
              cp.segmentColors.push(RAINBOW_SEQUENCE[rIdx]);
              rainbowIndexRef.current++;
            }
          }
          isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isPinching(hand)) {
          filterXRef.current.reset(); filterYRef.current.reset();
          posHistoryRef.current = [];
          const now = performance.now();
          const rawMidX = (ix + tx) / 2, rawMidY = (iy + ty) / 2;
          const midX = pinchFilterXRef.current.filter(rawMidX, now);
          const midY = pinchFilterYRef.current.filter(rawMidY, now);
          if (!isDraggingRef.current) {
            selectedDrawingRef.current = findDrawingAt(midX, midY);
            if (selectedDrawingRef.current) { isDraggingRef.current = true; lastFingerPosRef.current = { x: midX, y: midY }; }
          }
          if (isDraggingRef.current && selectedDrawingRef.current) {
            const dx = midX - lastFingerPosRef.current.x, dy = midY - lastFingerPosRef.current.y;
            selectedDrawingRef.current.points.forEach((p) => { p.x += dx; p.y += dy; });
            lastFingerPosRef.current = { x: midX, y: midY };
          }
          currentPathRef.current = null;
        } else {
          currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
          filterXRef.current.reset(); filterYRef.current.reset();
          eraserFilterXRef.current.reset(); eraserFilterYRef.current.reset();
          pinchFilterXRef.current.reset(); pinchFilterYRef.current.reset();
          posHistoryRef.current = [];
        }
        drawNeonSkeleton(hand);
      } else {
        currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        filterXRef.current.reset(); filterYRef.current.reset();
        eraserFilterXRef.current.reset(); eraserFilterYRef.current.reset();
        pinchFilterXRef.current.reset(); pinchFilterYRef.current.reset();
        posHistoryRef.current = [];
      }
      ctx.restore();
    }

    // Load MediaPipe
    const script1 = document.createElement("script");
    script1.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
    script1.crossOrigin = "anonymous";
    const script2 = document.createElement("script");
    script2.src = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
    script2.crossOrigin = "anonymous";

    script1.onload = () => {
      script2.onload = () => {
        const w = window as any;
        const hands = new w.Hands({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
        hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8, minTrackingConfidence: 0.85 });
        hands.onResults(onResults);
        const camera = new w.Camera(video, {
          onFrame: async () => { await hands.send({ image: video }); },
          width: 1280, height: 720,
        });
        camera.start();
      };
      document.head.appendChild(script2);
    };
    document.head.appendChild(script1);

    // Mouse support
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / canvas.width;
      const y = (e.clientY - rect.top) / canvas.height;
      const invX = 1 - x;

      const handleMove = (me: MouseEvent) => {
        const mRect = canvas.getBoundingClientRect();
        const mx = (me.clientX - mRect.left) / canvas.width;
        const my = (me.clientY - mRect.top) / canvas.height;
        const mInvX = 1 - mx;

        const hand = Array(21).fill(0).map(() => ({ x: mInvX, y: my }));
        hand[8] = { x: mInvX, y: my };
        hand[6] = { x: mInvX, y: my + 0.1 };

        if (me.buttons === 2 || (me.buttons === 1 && me.ctrlKey)) {
          hand[12] = { x: mInvX + 0.02, y: my };
          hand[10] = { x: mInvX + 0.02, y: my + 0.1 };
          hand[16] = { x: mInvX + 0.04, y: my };
          hand[14] = { x: mInvX + 0.04, y: my + 0.1 };
        } else if (me.shiftKey) {
          hand[4] = { x: mInvX + 0.01, y: my + 0.01 };
        } else {
          hand[12] = { x: mInvX + 0.02, y: my + 0.2 };
          hand[10] = { x: mInvX + 0.02, y: my + 0.15 };
        }
        onResults({ multiHandLandmarks: [hand] });
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        onResults({ multiHandLandmarks: [] });
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);

      const hand = Array(21).fill(0).map(() => ({ x: invX, y: y }));
      hand[8] = { x: invX, y: y };
      hand[6] = { x: invX, y: y + 0.1 };
      if (e.buttons === 2) {
        hand[12] = { x: invX + 0.02, y: y };
        hand[10] = { x: invX + 0.02, y: y + 0.1 };
        hand[16] = { x: invX + 0.04, y: y };
        hand[14] = { x: invX + 0.04, y: y + 0.1 };
      } else if (e.shiftKey) {
        hand[4] = { x: invX + 0.01, y: y + 0.01 };
      } else {
        hand[12] = { x: invX + 0.02, y: y + 0.2 };
        hand[10] = { x: invX + 0.02, y: y + 0.15 };
      }
      onResults({ multiHandLandmarks: [hand] });
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      window.removeEventListener("resize", setupCanvas);
      canvas.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showGesture]);

  return (
    <div className="fixed inset-0" style={{ background: "#0a0a0a" }}>
      <video ref={videoRef} className="absolute invisible w-px h-px" />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-screen h-screen z-[5]" style={{ transform: "scaleX(-1)" }} />

      {/* Loading */}
      {loading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5" style={{ background: "#0a0a0a" }}>
          <div className="flex gap-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-5 h-5 rounded-full" style={{
                background: i === 0 ? "#f04299" : i === 1 ? "#9b5de5" : "#2bcbff",
                animation: `dotBounce 1.2s ease-in-out infinite ${i * 0.15}s`,
              }} />
            ))}
          </div>
          <p className="text-white/70 text-base font-semibold">Starting camera magic...</p>
        </div>
      )}

      {/* Color Picker */}
      <div className="fixed left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-50 rounded-[40px] p-2.5 backdrop-blur-xl max-h-[85vh] overflow-y-auto scrollbar-hide" style={{ transform: "translateY(-50%) scaleX(-1)", background: "rgba(10,10,10,0.85)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
        <div className="text-center text-lg mb-1" style={{ transform: "scaleX(-1)" }}>🎨</div>
        {activeColors.map((c) => (
          <button key={c} onClick={() => setCurrentColor(c)}
            className="w-8 h-8 rounded-full border-2 cursor-pointer transition-all duration-200"
            style={{
              background: c,
              borderColor: currentColor === c ? "#fff" : "transparent",
              transform: currentColor === c ? "scale(1.2)" : "scale(1)",
              boxShadow: currentColor === c ? `0 0 12px ${c}` : "none",
            }}
          />
        ))}
      </div>

      {/* Brush Mode Panel */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50" style={{ transform: "translateY(-50%) scaleX(-1)" }}>
        {/* Brush toggle */}
        <button
          onClick={() => setShowBrushPanel(!showBrushPanel)}
          className="w-[50px] h-[50px] rounded-2xl flex items-center justify-center text-xl cursor-pointer transition-all hover:scale-110 active:scale-90"
          style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          🖌️
        </button>

        {showBrushPanel && (
          <div className="flex flex-col gap-2 p-3 rounded-2xl" style={{ transform: "scaleX(-1)", background: "rgba(10,10,10,0.9)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(16px)" }}>
            <p className="text-white/50 text-[10px] uppercase tracking-wider font-bold text-center">Brush</p>

            {/* Brush modes */}
            {([
              { mode: "classic" as BrushMode, label: "Classic", icon: "✏️" },
              { mode: "glitter" as BrushMode, label: "Glitter", icon: "✨" },
              { mode: "rainbow" as BrushMode, label: "Rainbow", icon: "🌈" },
            ]).map(({ mode, label, icon }) => (
              <button key={mode} onClick={() => setBrushMode(mode)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-xs font-semibold"
                style={{
                  background: brushMode === mode ? "rgba(255,255,255,0.15)" : "transparent",
                  color: brushMode === mode ? "#fff" : "rgba(255,255,255,0.5)",
                  border: brushMode === mode ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
                }}
              >
                <span className="text-base">{icon}</span>
                <span>{label}</span>
              </button>
            ))}

            {/* Stroke size */}
            <p className="text-white/50 text-[10px] uppercase tracking-wider font-bold text-center mt-2">Size</p>
            <div className="flex flex-col items-center gap-1">
              <input
                type="range" min="2" max="30" value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full accent-white"
                style={{ height: "4px" }}
              />
              <div className="flex items-center justify-center">
                <div className="rounded-full bg-white" style={{ width: strokeWidth, height: strokeWidth }} />
              </div>
            </div>

            {/* Fill toggle */}
            <p className="text-white/50 text-[10px] uppercase tracking-wider font-bold text-center mt-2">Fill</p>
            <button onClick={() => setFillMode(!fillMode)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-xs font-semibold"
              style={{
                background: fillMode ? "rgba(255,255,255,0.15)" : "transparent",
                color: fillMode ? "#fff" : "rgba(255,255,255,0.5)",
                border: fillMode ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
              }}
            >
              <span className="text-base">🪣</span>
              <span>Fill Shape</span>
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="fixed top-4 right-4 flex gap-2 z-50" style={{ transform: "scaleX(-1)" }}>
        {[
          { id: "download", emoji: "💾", action: downloadDoodle },
          { id: "clear", emoji: "🗑️", action: clearAll },
          { id: "undo", emoji: "↩️", action: undo },
          { id: "home", emoji: "🏠", action: () => navigate("/") },
        ].map((btn) => (
          <button key={btn.id} onClick={btn.action}
            className="w-[46px] h-[46px] rounded-2xl flex items-center justify-center text-xl cursor-pointer transition-all hover:scale-110 active:scale-90"
            style={{ background: "rgba(10,10,10,0.8)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {btn.emoji}
          </button>
        ))}
      </div>

      {/* Gesture Indicator */}
      <div className={`fixed bottom-5 left-1/2 z-50 font-body font-bold text-sm px-6 py-2.5 rounded-full pointer-events-none transition-opacity duration-300 ${gestureVisible ? "opacity-100" : "opacity-0"}`}
        style={{ transform: "translateX(-50%) scaleX(-1)", background: "rgba(10,10,10,0.85)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)" }}
      >
        {gestureText}
      </div>
    </div>
  );
};

export default DrawPage;
