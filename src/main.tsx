import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FluidCanvas } from "@/components/FluidCanvas";
import "./styles.css";

function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-foreground">
      <FluidCanvas />

      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-white/90 shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/70">
              Woven Signal
            </span>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/40">
            v0 · 2026
          </span>
        </header>

        <section className="flex flex-1 flex-col items-start justify-center px-6 pb-24 sm:px-10 md:px-16">
          <div className="max-w-3xl">
            <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.32em] text-white/50">
              Crypto infrastructure consultancy
            </p>
            <h1 className="text-balance text-5xl font-light leading-[1.02] tracking-tight text-white sm:text-7xl md:text-8xl">
              Woven Signal.
            </h1>
            <p className="mt-8 max-w-xl text-base font-light leading-relaxed text-white/60 sm:text-lg">
              We architect, operate, and harden the infrastructure that carries
              value on-chain - for protocols, validators, and the teams building
              what comes next.
            </p>

            <div className="mt-12 flex flex-wrap items-center gap-4">
              <a
                href="mailto:pathway@wovensignal.xyz"
                className="group relative inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/5 px-6 py-3 font-mono text-[12px] uppercase tracking-[0.22em] text-white backdrop-blur-md transition-all hover:border-white/60 hover:bg-white/10"
              >
                <span>Contact us</span>
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </a>
              <span className="font-mono text-[11px] tracking-[0.18em] text-white/40">
                pathway@wovensignal.xyz
              </span>
            </div>
          </div>
        </section>

        <footer className="flex items-center justify-end px-6 pb-6 sm:px-10 sm:pb-8">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
            © Path-Way AB - Org. nr 559477-0124
          </span>
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
