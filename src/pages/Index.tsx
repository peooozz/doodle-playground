import { useNavigate } from "react-router-dom";
import magicHand from "@/assets/magic-hand.png";

const FloatingShape = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={className} style={style} />
);

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-background px-6">
      {/* Floating decorative blobs */}
      <FloatingShape
        className="absolute rounded-full opacity-30 blur-[80px]"
        style={{
          width: 400, height: 400,
          background: "hsl(var(--coral))",
          top: "-10%", left: "-8%",
          animation: "blobFloat 10s ease-in-out infinite alternate",
        }}
      />
      <FloatingShape
        className="absolute rounded-full opacity-25 blur-[80px]"
        style={{
          width: 350, height: 350,
          background: "hsl(var(--teal))",
          bottom: "-10%", right: "-5%",
          animation: "blobFloat 12s ease-in-out infinite alternate-reverse",
        }}
      />
      <FloatingShape
        className="absolute rounded-full opacity-20 blur-[80px]"
        style={{
          width: 300, height: 300,
          background: "hsl(var(--sunny))",
          top: "40%", right: "15%",
          animation: "blobFloat 8s ease-in-out infinite alternate",
        }}
      />

      {/* Floating stars */}
      {["⭐", "✨", "🌟", "💫", "⭐"].map((star, i) => (
        <span
          key={i}
          className="absolute text-2xl md:text-3xl pointer-events-none select-none"
          style={{
            top: `${15 + i * 18}%`,
            left: `${10 + i * 20}%`,
            animation: `float ${3 + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.4}s`,
            opacity: 0.6,
          }}
        >
          {star}
        </span>
      ))}

      {/* Main content */}
      <div className="relative z-10 text-center max-w-2xl">
        {/* Hero hand image */}
        <div className="relative inline-block mb-6" style={{ animation: "wiggle 2.5s ease-in-out infinite" }}>
          <img
            src={magicHand}
            alt="Magic drawing hand"
            className="w-28 h-28 md:w-36 md:h-36 drop-shadow-xl"
          />
          {/* Pulse rings */}
          <div className="absolute inset-0 rounded-full border-2 border-primary/30" style={{ animation: "pulseRing 3s ease-out infinite" }} />
          <div className="absolute inset-0 rounded-full border-2 border-secondary/30" style={{ animation: "pulseRing 3s ease-out infinite 1.5s" }} />
        </div>

        {/* Title */}
        <h1 className="font-display text-6xl md:text-8xl font-bold mb-2 leading-tight">
          <span className="block text-foreground drop-shadow-sm">Air</span>
          <span
            className="block bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, hsl(var(--coral)), hsl(var(--teal)), hsl(var(--sunny)))",
              backgroundSize: "200% 200%",
              animation: "shimmer 4s ease infinite",
              filter: "drop-shadow(0 4px 12px hsl(var(--coral) / 0.3))",
            }}
          >
            Doodle
          </span>
        </h1>

        <p className="font-display text-xl md:text-2xl font-bold text-foreground/90 mb-2">
          Draw in the air with your hands ✨
        </p>
        <p className="font-body text-base text-muted-foreground mb-10 max-w-md mx-auto">
          Wave, sketch, and create glowing art — no pencils needed!
        </p>

        {/* Buttons */}
        <div className="flex flex-wrap gap-5 justify-center mb-10">
          <button
            onClick={() => navigate("/draw")}
            className="relative overflow-hidden rounded-full bg-primary px-10 py-5 md:px-14 md:py-6 font-display text-xl md:text-2xl font-bold text-primary-foreground shadow-xl transition-all hover:-translate-y-1 hover:shadow-2xl active:translate-y-0.5 active:shadow-md"
            style={{ animation: "pulseGlow 2s ease-in-out infinite" }}
          >
            {/* Shine effect */}
            <span
              className="absolute top-0 -left-full w-3/5 h-full pointer-events-none"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                transform: "skewX(-20deg)",
                animation: "shineSweep 3s ease-in-out infinite",
              }}
            />
            <span className="text-2xl md:text-3xl mr-2">🎨</span>
            Let's Draw!
          </button>

          <button
            onClick={() => navigate("/guide")}
            className="rounded-full bg-secondary px-10 py-5 md:px-14 md:py-6 font-display text-xl md:text-2xl font-bold text-secondary-foreground shadow-xl transition-all hover:-translate-y-1 hover:shadow-2xl active:translate-y-0.5 active:shadow-md"
          >
            <span className="text-2xl md:text-3xl mr-2">📖</span>
            How to Play
          </button>
        </div>

        {/* Gesture badges */}
        <div className="flex flex-wrap gap-3 justify-center">
          {[
            { icon: "☝️", label: "Draw" },
            { icon: "✌️", label: "Hover" },
            { icon: "🖐️", label: "Erase" },
            { icon: "🤏", label: "Move" },
          ].map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-2 rounded-full bg-card border-2 border-border px-5 py-2.5 font-display text-sm font-bold text-foreground/80 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default"
            >
              {b.icon} {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
