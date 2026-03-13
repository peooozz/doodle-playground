import { useNavigate } from "react-router-dom";

const gestures = [
  { icon: "☝️", title: "Draw", desc: "Point your index finger up to draw glowing lines!", color: "bg-primary" },
  { icon: "✌️", title: "Hover", desc: "Hold two fingers up to move without drawing.", color: "bg-secondary" },
  { icon: "🖐️", title: "Erase", desc: "Three fingers up to wipe away your art.", color: "bg-teal" },
  { icon: "🤏", title: "Move", desc: "Pinch near a drawing to drag it around!", color: "bg-sunny" },
];

const GuidePage = () => {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background overflow-y-auto p-6">
      <div className="max-w-2xl w-full text-center">
        <button
          onClick={() => navigate("/")}
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-muted px-6 py-3 font-display text-lg font-bold text-foreground transition-all hover:scale-105 active:scale-95"
        >
          ← Back
        </button>

        <h1 className="font-display text-5xl md:text-6xl font-bold text-foreground mb-10">
          How to <span className="text-primary">Play</span> 🎨
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
          {gestures.map((g) => (
            <div
              key={g.title}
              className="rounded-3xl bg-card border-4 border-border p-8 transition-all hover:scale-[1.03] hover:shadow-xl"
            >
              <div className="text-6xl mb-4">{g.icon}</div>
              <h3 className="font-display text-2xl font-bold text-foreground mb-2">{g.title}</h3>
              <p className="text-muted-foreground font-body text-base">{g.desc}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate("/draw")}
          className="rounded-full bg-primary px-12 py-5 font-display text-2xl font-bold text-primary-foreground shadow-lg transition-all hover:scale-110 active:scale-95"
          style={{ animation: "pulseGlow 2s ease-in-out infinite" }}
        >
          🚀 Start Drawing!
        </button>
      </div>
    </div>
  );
};

export default GuidePage;
