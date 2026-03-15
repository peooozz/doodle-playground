import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const COLORS = [
  // Rainbow fun
  "#FF3B3B", "#FF6B6B", "#FF9F1C", "#FFE66D",
  "#00F5A0", "#4ECDC4", "#2BCBFF", "#9B5DE5",
  "#F04299", "#FF85C0",
  // Neon party
  "#39FF14", "#FF073A", "#DFFF00", "#FF6EC7",
  // Pastels
  "#FFB3BA", "#BAFFC9", "#BAE1FF", "#E8BAFF",
];

const ERASER_RADIUS = 45;

// --- 1€ (One Euro) Adaptive Filter ---
// Provides low jitter when hand is still, high responsiveness when moving fast.
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
    const dt = Math.max((timestamp - this.tPrev) / 1000, 0.001); // seconds
    this.tPrev = timestamp;

    // Estimate derivative (velocity)
    const dx = (x - this.xPrev) / dt;
    const aD = this.smoothingFactor(this.dCutoff, dt);
    const dxSmoothed = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxSmoothed;

    // Adaptive cutoff based on speed
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

// --- Position history buffer for outlier rejection ---
const HISTORY_SIZE = 5;
const OUTLIER_MULTIPLIER = 3.5; // reject jumps > 3.5x recent avg velocity
const MIN_POINT_DISTANCE = 4; // minimum px between drawn points (deadzone)
const HOLD_FRAMES_THRESHOLD = 15; // frames before shape snap triggers

interface Point { x: number; y: number; }
interface Drawing {
  points: Point[];
  color: string;
  id: number;
  holdFrames: number;
  isShape: boolean;
}

const DrawPage = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [currentColor, setCurrentColor] = useState("#FF3B3B");
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [gestureText, setGestureText] = useState("");
  const [gestureVisible, setGestureVisible] = useState(false);

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
  const isDarkThemeRef = useRef(isDarkTheme);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { currentColorRef.current = currentColor; }, [currentColor]);
  useEffect(() => { isDarkThemeRef.current = isDarkTheme; }, [isDarkTheme]);

  const showGesture = useCallback((text: string) => {
    setGestureText(text);
    setGestureVisible(true);
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => setGestureVisible(false), 1200);
  }, []);

  const downloadDoodle = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a temporary canvas to save the image (without UI)
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d")!;

    // Mirror back so the saved image is readable/correctly oriented
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

    // Helper functions
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
          drawingsRef.current.splice(i, 0, { points: seg, color: d.color, id: Date.now() + Math.random(), holdFrames: 0, isShape: false });
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
      // Merge nearby corners (larger merge radius for noisy input)
      const merged: Point[] = [];
      for (const a of angles) {
        const last = merged[merged.length - 1];
        if (last && Math.hypot(pts[a.idx].x - last.x, pts[a.idx].y - last.y) < 50) continue;
        merged.push(pts[a.idx]);
      }
      return merged;
    }

    // Outlier rejection: checks if a new position is an unreasonable jump
    function isOutlier(nx: number, ny: number, now: number): boolean {
      const hist = posHistoryRef.current;
      if (hist.length < 2) return false;
      // compute average velocity over recent history
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
            path.points = newPts; showGesture("✨ Perfect Circle!"); return;
          }
        }
        // Check for triangle: find corners by analyzing angle changes
        const corners = findCorners(pts);
        if (corners.length === 3) {
          const [a, b, c] = corners;
          path.points = [a, b, c, a];
          path.isShape = true; showGesture("🔺 Perfect Triangle!"); return;
        }

        // Check for diamond (4 corners with roughly equal sides)
        if (corners.length === 4) {
          const [a, b, c, d] = corners;
          const sides = [
            Math.hypot(b.x-a.x, b.y-a.y), Math.hypot(c.x-b.x, c.y-b.y),
            Math.hypot(d.x-c.x, d.y-c.y), Math.hypot(a.x-d.x, a.y-d.y)
          ];
          const avgSide = sides.reduce((s,v)=>s+v,0)/4;
          const sideVar = sides.every(s => Math.abs(s - avgSide) < avgSide * 0.35);
          if (sideVar) {
            // Check if it's rotated (diamond) vs axis-aligned (square)
            const topIdx = [a,b,c,d].reduce((mi, p, i, arr) => p.y < arr[mi].y ? i : mi, 0);
            const sorted = [...[a,b,c,d].slice(topIdx), ...[a,b,c,d].slice(0, topIdx)];
            const isAxisAligned = Math.abs(sorted[0].x - cx) < width * 0.15;
            if (isAxisAligned) {
              // Diamond shape
              const r = avgSide / Math.sqrt(2);
              path.points = [
                { x: cx, y: cy - r }, { x: cx + r, y: cy },
                { x: cx, y: cy + r }, { x: cx - r, y: cy },
                { x: cx, y: cy - r }
              ];
              path.isShape = true; showGesture("💎 Perfect Diamond!"); return;
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
          path.isShape = true; showGesture(isSquare ? "🟩 Perfect Square!" : "🔲 Perfect Rectangle!"); return;
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
      ctx.strokeStyle = isDarkThemeRef.current ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.4)";
      ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,100,100,0.12)"; ctx.fill();
      ctx.restore();
    }

    function drawStoredPaths() {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      drawingsRef.current.forEach((d, dIdx) => {
        if (d.points.length < 2) return;
        const isSelected = selectedDrawingRef.current && selectedDrawingRef.current.id === d.id;
        const color = d.color || "#FF3B3B";
        const rgb = hexToRgb(color);
        ctx.save();

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

        ctx.shadowBlur = isSelected ? 45 : 30;
        ctx.shadowColor = isSelected ? "#ffff00" : color;
        ctx.strokeStyle = isSelected ? "rgba(255,255,0,0.5)" : `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`;
        ctx.lineWidth = isSelected ? 34 : 28;
        drawStroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = isSelected ? "#ffff00" : color;
        ctx.lineWidth = isSelected ? 26 : 22;
        drawStroke();

        ctx.strokeStyle = isSelected ? "#fffde7" : `rgba(${Math.min(255, rgb.r + 80)},${Math.min(255, rgb.g + 80)},${Math.min(255, rgb.b + 80)},0.7)`;
        ctx.lineWidth = isSelected ? 8 : 6;
        drawStroke();
        ctx.restore();

        // Glitter
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
      ctx.fillStyle = isDarkThemeRef.current ? "#2a2a2a" : "#f5f0e8";
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
          // --- 1€ filter + outlier rejection ---
          const now = performance.now();
          if (!isOutlier(ix, iy, now)) {
            pushHistory(ix, iy, now);
            ix = filterXRef.current.filter(ix, now);
            iy = filterYRef.current.filter(iy, now);
          } else {
            // Use last known good position
            const hist = posHistoryRef.current;
            if (hist.length > 0) {
              ix = hist[hist.length - 1].x;
              iy = hist[hist.length - 1].y;
            }
          }

          if (!currentPathRef.current) {
            currentPathRef.current = { points: [], color: currentColorRef.current, id: Date.now(), holdFrames: 0, isShape: false };
            drawingsRef.current.push(currentPathRef.current);
          }
          const cp = currentPathRef.current;
          const lastPt = cp.points[cp.points.length - 1];
          const distToLast = lastPt ? Math.hypot(lastPt.x - ix, lastPt.y - iy) : Infinity;

          if (distToLast < 8) { cp.holdFrames++; if (cp.holdFrames > HOLD_FRAMES_THRESHOLD && !cp.isShape) recognizeAndRefineShape(cp); }
          else cp.holdFrames = 0;
          if (!cp.isShape && (!lastPt || distToLast > MIN_POINT_DISTANCE)) cp.points.push({ x: ix, y: iy });
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

    // --- Mouse support for simulation/debug ---
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / canvas.width;
      const y = (e.clientY - rect.top) / canvas.height;
      // Invert x because canvas is scaleX(-1)
      const invX = 1 - x;
      
      const simulateHand = (isErase = false, isPinch = false) => {
        const hand = Array(21).fill(0).map(() => ({ x: invX, y: y }));
        // Tip of index
        hand[8] = { x: invX, y: y };
        // Joint of index
        hand[6] = { x: invX, y: y + 0.1 };
        
        if (isErase) {
          // Tip of middle
          hand[12] = { x: invX + 0.02, y: y };
          hand[10] = { x: invX + 0.02, y: y + 0.1 };
          // Tip of ring
          hand[16] = { x: invX + 0.04, y: y };
          hand[14] = { x: invX + 0.04, y: y + 0.1 };
        } else if (isPinch) {
          // Thumb tip close to index tip
          hand[4] = { x: invX + 0.01, y: y + 0.01 };
        } else {
          // Other fingers down
          hand[12] = { x: invX + 0.02, y: y + 0.2 };
          hand[10] = { x: invX + 0.02, y: y + 0.15 };
        }
        onResults({ multiHandLandmarks: [hand] });
      };

      const handleMove = (me: MouseEvent) => {
        const mRect = canvas.getBoundingClientRect();
        const mx = (me.clientX - mRect.left) / canvas.width;
        const my = (me.clientY - mRect.top) / canvas.height;
        const mInvX = 1 - mx;
        
        const hand = Array(21).fill(0).map(() => ({ x: mInvX, y: my }));
        hand[8] = { x: mInvX, y: my };
        hand[6] = { x: mInvX, y: my + 0.1 };
        
        if (me.buttons === 2 || (me.buttons === 1 && me.ctrlKey)) {
          // Erase (Right click or Ctrl+Click)
          hand[12] = { x: mInvX + 0.02, y: my };
          hand[10] = { x: mInvX + 0.02, y: my + 0.1 };
          hand[16] = { x: mInvX + 0.04, y: my };
          hand[14] = { x: mInvX + 0.04, y: my + 0.1 };
        } else if (me.shiftKey) {
          // Pinch
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
      simulateHand(e.buttons === 2, e.shiftKey);
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => { 
      window.removeEventListener("resize", setupCanvas); 
      canvas.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showGesture]);

  return (
    <div className="fixed inset-0" style={{ background: isDarkTheme ? "#2a2a2a" : "#f5f0e8" }}>
      <video ref={videoRef} className="absolute invisible w-px h-px" />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-screen h-screen z-[5]" style={{ transform: "scaleX(-1)" }} />

      {/* Loading */}
      {loading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5" style={{ background: "#1a1a2e" }}>
          <div className="flex gap-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-5 h-5 rounded-full" style={{
                background: i === 0 ? "#f04299" : i === 1 ? "#9b5de5" : "#2bcbff",
                animation: `dotBounce 1.2s ease-in-out infinite ${i * 0.15}s`,
              }} />
            ))}
          </div>
          <p className="text-muted-foreground text-base font-semibold">Starting camera magic...</p>
        </div>
      )}

      {/* Color Picker - scrollable rainbow palette */}
      <div className="fixed left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-50 rounded-[40px] p-2.5 backdrop-blur-xl max-h-[85vh] overflow-y-auto scrollbar-hide" style={{ transform: "translateY(-50%) scaleX(-1)", background: "rgba(20,20,30,0.8)", border: "2px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div className="text-center text-lg mb-1" style={{ transform: "scaleX(-1)" }}>🎨</div>
        {COLORS.map((c, i) => (
          <button key={c} onClick={() => setCurrentColor(c)}
            className="w-9 h-9 rounded-full border-[3px] cursor-pointer transition-all duration-200"
            style={{
              background: c,
              borderColor: currentColor === c ? "#fff" : "transparent",
              transform: currentColor === c ? "scale(1.25)" : "scale(1)",
              boxShadow: currentColor === c ? `0 0 20px ${c}, 0 0 8px #fff` : `0 2px 6px rgba(0,0,0,0.3)`,
              animation: currentColor === c ? "pulseGlow 1.5s ease-in-out infinite" : "none",
            }}
          />
        ))}
        {/* Rainbow cycle button */}
        <button
          onClick={() => {
            const idx = COLORS.indexOf(currentColor);
            setCurrentColor(COLORS[(idx + 1) % COLORS.length]);
          }}
          className="w-9 h-9 rounded-full cursor-pointer transition-all duration-200 border-2 border-white/20 hover:scale-110 active:scale-90 mt-1"
          style={{
            background: "conic-gradient(#FF3B3B, #FFE66D, #00F5A0, #2BCBFF, #9B5DE5, #F04299, #FF3B3B)",
            animation: "spin 4s linear infinite",
          }}
          title="Next color!"
        />
      </div>

      {/* Toolbar */}
      <div className="fixed top-4 right-4 flex gap-2 z-50" style={{ transform: "scaleX(-1)" }}>
        {[
          { id: "theme", emoji: isDarkTheme ? "🌙" : "☀️", action: () => setIsDarkTheme(!isDarkTheme) },
          { id: "download", emoji: "💾", action: downloadDoodle },
          { id: "clear", emoji: "🗑️", action: clearAll },
          { id: "undo", emoji: "↩️", action: undo },
          { id: "home", emoji: "🏠", action: () => navigate("/") },
        ].map((btn) => (
          <button key={btn.id} onClick={btn.action}
            className="w-[50px] h-[50px] rounded-[14px] flex items-center justify-center text-[22px] cursor-pointer transition-all hover:scale-110 active:scale-90"
            style={{ background: "rgba(20,20,30,0.75)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {btn.emoji}
          </button>
        ))}
      </div>

      {/* Gesture Indicator */}
      <div className={`fixed bottom-5 left-1/2 z-50 font-body font-bold text-sm px-6 py-2.5 rounded-full pointer-events-none transition-opacity duration-300 ${gestureVisible ? "opacity-100" : "opacity-0"}`}
        style={{ transform: "translateX(-50%) scaleX(-1)", background: "rgba(15,15,30,0.8)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)" }}
      >
        {gestureText}
      </div>
    </div>
  );
};

export default DrawPage;
