import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const COLORS = [
  "#FF3B3B", "#FF6B6B", "#4ECDC4", "#FFE66D", "#9B5DE5",
  "#00F5A0", "#FF9F1C", "#2BCBFF", "#F04299",
];

const ERASER_RADIUS = 45;
const BASE_SMOOTHING = 0.25;

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
  const smoothedPosRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
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
        if (aspectRatio < 1.4) {
          let totalDeviation = 0;
          for (const p of pts) totalDeviation += Math.abs(Math.hypot(p.x - cx, p.y - cy) - avgRadius);
          if (totalDeviation / pts.length < avgRadius * 0.25) {
            const newPts: Point[] = [];
            for (let i = 0; i <= 40; i++) { const angle = (i / 40) * Math.PI * 2; newPts.push({ x: cx + Math.cos(angle) * avgRadius, y: cy + Math.sin(angle) * avgRadius }); }
            path.points = newPts; showGesture("✨ Perfect Circle!"); return;
          }
        }
        let edgeDev = 0;
        for (const p of pts) edgeDev += Math.min(Math.abs(p.x - minX), Math.abs(p.x - maxX), Math.abs(p.y - minY), Math.abs(p.y - maxY));
        if (edgeDev / pts.length < Math.min(width, height) * 0.15) {
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
          if (totalDev / pts.length < 25) { path.points = [first, last]; path.isShape = true; showGesture("📏 Straight Line!"); }
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
          const ex = (ix + mx + rx) / 3, ey = (iy + my + ry) / 3;
          eraseAt(ex, ey); drawEraserCursor(ex, ey);
          currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isIndexAndMiddleUp(hand)) {
          drawPointerCursor((ix + mx) / 2, (iy + my) / 2);
          currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isStrictlyIndexUp(hand) && !isPinching(hand)) {
          const sp = smoothedPosRef.current;
          if (sp.x === null) { sp.x = ix; sp.y = iy; } else {
            const dist = Math.hypot(ix - sp.x, iy - sp.y!);
            const factor = Math.min(1.0, BASE_SMOOTHING + dist * 0.05);
            sp.x += (ix - sp.x) * factor; sp.y! += (iy - sp.y!) * factor;
          }
          ix = sp.x; iy = sp.y!;

          if (!currentPathRef.current) {
            currentPathRef.current = { points: [], color: currentColorRef.current, id: Date.now(), holdFrames: 0, isShape: false };
            drawingsRef.current.push(currentPathRef.current);
          }
          const cp = currentPathRef.current;
          const lastPt = cp.points[cp.points.length - 1];
          const distToLast = lastPt ? Math.hypot(lastPt.x - ix, lastPt.y - iy) : Infinity;
          if (distToLast < 8) { cp.holdFrames++; if (cp.holdFrames > 18 && !cp.isShape) recognizeAndRefineShape(cp); }
          else cp.holdFrames = 0;
          if (!cp.isShape && (!lastPt || distToLast > 2.5)) cp.points.push({ x: ix, y: iy });
          isDraggingRef.current = false; selectedDrawingRef.current = null;
        } else if (isPinching(hand)) {
          smoothedPosRef.current = { x: null, y: null };
          const midX = (ix + tx) / 2, midY = (iy + ty) / 2;
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
          smoothedPosRef.current = { x: null, y: null };
        }
        drawNeonSkeleton(hand);
      } else {
        currentPathRef.current = null; isDraggingRef.current = false; selectedDrawingRef.current = null;
        smoothedPosRef.current = { x: null, y: null };
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
        hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8, minTrackingConfidence: 0.75 });
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

    return () => { window.removeEventListener("resize", setupCanvas); };
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

      {/* Color Picker */}
      <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50 rounded-[40px] p-3 backdrop-blur-xl" style={{ transform: "translateY(-50%) scaleX(-1)", background: "rgba(20,20,30,0.75)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {COLORS.map((c) => (
          <button key={c} onClick={() => setCurrentColor(c)}
            className="w-10 h-10 rounded-full border-[3px] cursor-pointer transition-all"
            style={{
              background: c,
              borderColor: currentColor === c ? "#fff" : "transparent",
              transform: currentColor === c ? "scale(1.2)" : "scale(1)",
              boxShadow: currentColor === c ? `0 0 22px ${c}, 0 0 6px #fff` : `0 2px 6px rgba(0,0,0,0.3)`,
            }}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div className="fixed top-4 right-4 flex gap-2 z-50" style={{ transform: "scaleX(-1)" }}>
        {[
          { id: "theme", emoji: isDarkTheme ? "🌙" : "☀️", action: () => setIsDarkTheme(!isDarkTheme) },
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
