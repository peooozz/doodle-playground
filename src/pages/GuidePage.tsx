import { useNavigate } from "react-router-dom";

const gestures = [
  { icon: "☝️", title: "Draw", desc: "Point your index finger up to draw glowing neon lines! Move slowly for smooth curves.", color: "from-coral to-pink-400" },
  { icon: "✌️", title: "Hover", desc: "Hold two fingers up to move around without drawing. Great for repositioning!", color: "from-secondary to-purple-400" },
  { icon: "🖐️", title: "Erase", desc: "Three fingers up acts like a magic eraser! Sweep over lines to wipe them away.", color: "from-teal to-emerald-400" },
  { icon: "🤏", title: "Move", desc: "Pinch near any drawing to grab and drag it to a new spot on the canvas!", color: "from-sunny to-amber-400" },
];

const shapes = [
  { icon: "⭕", title: "Circle", desc: "Draw a round shape and hold still — it snaps into a perfect circle!", emoji: "✨" },
  { icon: "🟩", title: "Square", desc: "Draw a boxy shape with equal sides and it becomes a perfect square!", emoji: "🎯" },
  { icon: "🔲", title: "Rectangle", desc: "Draw a longer box shape and watch it straighten into a clean rectangle!", emoji: "📐" },
  { icon: "📏", title: "Straight Line", desc: "Draw roughly in a straight direction — it auto-corrects into a perfect line!", emoji: "✏️" },
  { icon: "🔺", title: "Triangle", desc: "Draw a three-sided shape and it snaps into a perfect triangle!", emoji: "📸" },
  { icon: "💎", title: "Diamond", desc: "Draw a tilted square shape to create a sparkling diamond!", emoji: "💫" },
];

const tips = [
  { emoji: "🌟", tip: "Hold still after drawing to trigger shape recognition!" },
  { emoji: "🎨", tip: "Pick colors from the palette on the left side of the screen." },
  { emoji: "↩️", tip: "Made a mistake? Hit the undo button in the top-right corner." },
  { emoji: "🌙", tip: "Toggle dark/light mode with the moon/sun button." },
  { emoji: "🗑️", tip: "Clear everything at once with the trash button." },
];

const GuidePage = () => {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto text-center px-6 py-10">
        <button
          onClick={() => navigate("/")}
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-muted px-6 py-3 font-display text-lg font-bold text-foreground transition-all hover:scale-105 active:scale-95"
        >
          ← Back
        </button>

        <h1 className="font-display text-5xl md:text-6xl font-bold text-foreground mb-4">
          How to <span className="text-primary">Play</span> 🎨
        </h1>
        <p className="text-muted-foreground font-body text-lg mb-10">
          Use your hand in front of the camera to draw, erase, and create shapes!
        </p>

        {/* Gestures */}
        <h2 className="font-display text-3xl font-bold text-foreground mb-6">✋ Hand Gestures</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-12">
          {gestures.map((g) => (
            <div
              key={g.title}
              className="rounded-3xl bg-card border-4 border-border p-8 transition-all hover:scale-[1.03] hover:shadow-xl"
            >
              <div className={`w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${g.color} flex items-center justify-center text-5xl shadow-lg`}>
                {g.icon}
              </div>
              <h3 className="font-display text-2xl font-bold text-foreground mb-2">{g.title}</h3>
              <p className="text-muted-foreground font-body text-base">{g.desc}</p>
            </div>
          ))}
        </div>

        {/* Shape Recognition */}
        <h2 className="font-display text-3xl font-bold text-foreground mb-3">✨ Magic Shape Recognition</h2>
        <p className="text-muted-foreground font-body text-base mb-6">
          Draw a shape and <strong>hold your finger still</strong> — if it looks like one of these, it transforms automatically!
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-12">
          {shapes.map((s) => (
            <div
              key={s.title}
              className="rounded-2xl bg-card border-2 border-border p-5 transition-all hover:scale-105 hover:border-primary"
            >
              <div className="text-4xl mb-2">{s.icon}</div>
              <h3 className="font-display text-lg font-bold text-foreground mb-1">{s.title} {s.emoji}</h3>
              <p className="text-muted-foreground font-body text-sm">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Tips */}
        <h2 className="font-display text-3xl font-bold text-foreground mb-6">💡 Pro Tips</h2>
        <div className="space-y-3 mb-12 text-left max-w-md mx-auto">
          {tips.map((t, i) => (
            <div key={i} className="flex items-start gap-3 bg-card rounded-2xl border-2 border-border px-5 py-4">
              <span className="text-2xl">{t.emoji}</span>
              <p className="font-body text-foreground text-base">{t.tip}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate("/draw")}
          className="rounded-full bg-primary px-12 py-5 font-display text-2xl font-bold text-primary-foreground shadow-lg transition-all hover:scale-110 active:scale-95 mb-10"
          style={{ animation: "pulseGlow 2s ease-in-out infinite" }}
        >
          🚀 Start Drawing!
        </button>
      </div>
    </div>
  );
};

export default GuidePage;
