import { useState, useEffect } from "react";

const css = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
::selection{background:#18181B;color:#F4F4F5}
body{overflow-x:hidden}
.mono{font-family:'JetBrains Mono','SF Mono',monospace}
.serif{font-family:'Instrument Serif',Georgia,serif}
a{text-decoration:none;color:inherit}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
`;

const C = {
  t1: "#1A1A1A", t2: "#404040", t3: "#6B6B6B", t4: "#999", t5: "#CCC", t6: "#E2E2E2", t7: "#F2F2F2",
  bg: "#F7F6F3", card: "#FFF", sel: "#0C8CE9", sand: "#EDE9E3", ink: "#2C2C2C",
  kw: "#8B5CF6", fn: "#0E7490", str: "#047857", num: "#B45309", vr: "#1D4ED8",
};
const SH = "0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.08),0 20px 40px rgba(0,0,0,.05)";
const SHs = "0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.05)";

/* ═══ Logo ═══ */
function Logo({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" fill={C.ink} />
      <rect x="6" y="6" width="5" height="5" rx="1.2" fill="#fff" opacity=".9" />
      <rect x="13" y="6" width="5" height="5" rx="1.2" fill="#fff" opacity=".5" />
      <rect x="6" y="13" width="5" height="5" rx="1.2" fill="#fff" opacity=".5" />
      <rect x="13" y="13" width="5" height="5" rx="1.2" fill="#fff" opacity=".25" />
    </svg>
  );
}

/* ═══ TemPad Dev Panel ═══ */
function TPPanel() {
  const [tab, setTab] = useState("css");
  const v = s => <span style={{ color: C.vr }}>{s}</span>;
  const s = x => <span style={{ color: C.str }}>{x}</span>;
  const n = x => <span style={{ color: C.num }}>{x}</span>;
  return (
    <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", boxShadow: SH, border: "1px solid rgba(0,0,0,.07)", width: "100%" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(180deg,#FAFAF9,#fff)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x=".5" y=".5" width="11" height="11" rx="2.5" stroke={C.sel} strokeWidth="1" opacity=".45" /><rect x="3" y="3" width="6" height="6" rx=".8" fill={C.sel} opacity=".1" /></svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.t1, letterSpacing: "-.01em" }}>Button / Primary</span>
        </div>
        <span style={{ fontSize: 9.5, color: C.t5, letterSpacing: ".04em", fontWeight: 500 }}>INSTANCE</span>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
        {[["css", "CSS"], ["js", "JavaScript"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "9px 16px", fontSize: 12, cursor: "pointer", fontWeight: tab === id ? 600 : 400, color: tab === id ? C.t1 : C.t4, background: "transparent", border: "none", fontFamily: "inherit", borderBottom: tab === id ? `2px solid ${C.t1}` : "2px solid transparent", transition: "all .15s" }}>{label}</button>
        ))}
      </div>
      <div style={{ padding: "14px 16px", minHeight: 195 }}>
        {tab === "css" ? (
          <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.75, margin: 0, color: C.t2, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {"display: flex;\nalign-items: center;\ngap: 8px;\npadding: 12px 24px;\nborder-radius: "}{v("var(--radius-lg, 8px)")}{`;\nbackground: `}{v("var(--color-bg-inverse, #18181B)")}{`;\nfont-size: 14px;\nfont-weight: 600;\ncolor: #FFFFFF;`}</pre>
        ) : (
          <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.75, margin: 0, color: C.t2, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {"{\n  display: "}{s("'flex'")}{",\n  alignItems: "}{s("'center'")}{",\n  gap: "}{s("'8px'")}{",\n  padding: "}{s("'12px 24px'")}{",\n  borderRadius:\n    "}{v("'var(--radius-lg, 8px)'")}{",\n  background:\n    "}{v("'var(--color-bg-inverse, #18181B)'")}{",\n  fontSize: "}{s("'14px'")}{",\n  fontWeight: "}{n("600")}{",\n  color: "}{s("'#FFFFFF'")}{"\n}"}</pre>
        )}
      </div>
      <div style={{ padding: "9px 16px", borderTop: "1px solid rgba(0,0,0,.04)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,.012)" }}>
        <span style={{ fontSize: 11, color: C.t4 }}>9 properties · 2 variables</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: C.sel, cursor: "pointer" }}>Copy</span>
      </div>
    </div>
  );
}

/* ═══ Figma Properties Panel ═══ */
function FigmaPanel() {
  const hdr = t => <div style={{ marginBottom: 6, marginTop: 2 }}><span style={{ fontSize: 11, fontWeight: 600, color: C.t4 }}>{t}</span></div>;
  const sep = <div style={{ height: 1, background: C.t7, margin: "8px 0" }} />;
  const row = (l, v) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2.5px 0" }}>
      <span style={{ fontSize: 12, color: C.t4 }}>{l}</span>
      <span style={{ fontSize: 12, color: C.t2, fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
  const pill = n => <span className="mono" style={{ fontSize: 10, background: C.t7, color: C.t4, padding: "2px 7px", borderRadius: 4 }}>{n}</span>;
  return (
    <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", boxShadow: SHs, border: "1px solid rgba(0,0,0,.06)", width: "100%" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(180deg,#FAFAF9,#fff)" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.t2 }}>Properties</span>
        <span style={{ fontSize: 9.5, color: C.t5, letterSpacing: ".04em", fontWeight: 500 }}>VIEW-ONLY</span>
      </div>
      <div style={{ padding: "14px 16px" }}>
        {hdr("Layout")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 20px" }}>
          {[["W", "168"], ["H", "44"]].map(([l, v], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2.5px 0" }}>
              <span style={{ fontSize: 11, color: C.t5, width: 14 }}>{l}</span>
              <span style={{ fontSize: 12, color: C.t2, fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
        </div>
        {sep}{hdr("Fill")}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 5px" }}>
          <div style={{ width: 20, height: 20, borderRadius: 5, background: C.t1, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
          {pill("color/bg-inverse")}
        </div>
        {sep}{hdr("Typography")}
        {row("Font", "Inter")}{row("Weight", "Semi Bold")}{row("Size", "14")}
        {sep}{hdr("Corner radius")}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
          <span style={{ fontSize: 12, color: C.t2 }}>8</span>{pill("radius/lg")}
        </div>
        {sep}
        <p style={{ fontSize: 11, color: C.t5, lineHeight: 1.5, marginTop: 5 }}>Variable names visible, values hidden. No code, no padding/gap/display.</p>
      </div>
    </div>
  );
}

/* ═══ Code Block ═══ */
function Code({ label, dark, children }) {
  const bg = dark ? "#1A1A1A" : C.card;
  const bd = dark ? "#282828" : "rgba(0,0,0,.07)";
  return (
    <div style={{ background: bg, borderRadius: 16, overflow: "hidden", boxShadow: SHs, border: `1px solid ${bd}` }}>
      {label && <div className="mono" style={{ padding: "10px 16px", borderBottom: `1px solid ${bd}`, fontSize: 11, color: dark ? "#525252" : C.t4 }}>{label}</div>}
      <pre className="mono" style={{ padding: "14px 16px", fontSize: 12.5, lineHeight: 1.7, margin: 0, overflowX: "auto", color: dark ? "#A3A3A3" : C.t2 }}>{children}</pre>
    </div>
  );
}

/* ═══ Agent Conversation ═══ */
function AgentConvo() {
  const user = c => (
    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 22, height: 22, borderRadius: 7, background: "linear-gradient(135deg,#6366F1,#8B5CF6)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>Y</span>
      </div>
      <div style={{ paddingTop: 2 }}><p style={{ fontSize: 13, color: "#E5E5E5", lineHeight: 1.6 }}>{c}</p></div>
    </div>
  );
  const agent = c => (
    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 22, height: 22, borderRadius: 7, background: "linear-gradient(135deg,#D4A574,#C08552)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>A</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>{c}</div>
    </div>
  );
  const tool = (name, status) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span style={{ fontSize: 11, color: "#4ADE80" }}>✓</span>
      <span className="mono" style={{ fontSize: 11, color: "#737373" }}>{name}</span>
      <span style={{ fontSize: 11, color: "#525252" }}>{status}</span>
    </div>
  );
  return (
    <div style={{ background: "#18181B", borderRadius: 16, overflow: "hidden", boxShadow: SH, border: "1px solid #282828" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #282828", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#EF4444", "#FBBF24", "#22C55E"].map((c, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: .35 }} />)}
        </div>
        <span style={{ fontSize: 11, color: "#525252", marginLeft: 2 }}>Agent</span>
      </div>
      <div style={{ padding: "16px 16px 14px" }}>
        {user("I selected the hero button in Figma. Implement it using our design system.")}
        {agent(<>
          {tool("get_code", "· Button / Primary")}
          {tool("get_structure", "· 2 children")}
          <p style={{ fontSize: 13, color: "#D4D4D8", lineHeight: 1.6, marginTop: 6 }}>
            Got the design context from TemPad Dev. The button uses <span className="mono" style={{ fontSize: 12, color: "#D4A574" }}>--color-bg-inverse</span> and <span className="mono" style={{ fontSize: 12, color: "#D4A574" }}>--radius-lg</span>. Creating the component with your existing utilities.
          </p>
        </>)}
        {user("Done. I've selected the card wrapper now.")}
        {agent(<>
          {tool("get_code", "· Card / Featured")}
          <p style={{ fontSize: 13, color: "#D4D4D8", lineHeight: 1.6, marginTop: 6 }}>
            14 properties, 5 tokens, 2 SVG assets exported. Writing...
          </p>
          <span style={{ display: "inline-block", width: 6, height: 15, background: "#D4D4D8", marginTop: 4, animation: "blink 1.1s step-end infinite", opacity: .25 }} />
        </>)}
      </div>
    </div>
  );
}

/* ═══ MAIN ═══ */
export default function Landing() {
  const [sc, setSc] = useState(false);
  useEffect(() => {
    const h = () => setSc(window.scrollY > 20);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <div style={{ background: C.bg, color: C.t1, fontFamily: "'Inter',system-ui,sans-serif", minHeight: "100vh" }}>
      <style>{css}</style>

      {/* ── NAV ── */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, background: sc ? "rgba(247,246,243,.86)" : "transparent", backdropFilter: sc ? "blur(20px) saturate(1.6)" : "none", WebkitBackdropFilter: sc ? "blur(20px) saturate(1.6)" : "none", borderBottom: sc ? "1px solid rgba(0,0,0,.06)" : "1px solid transparent", transition: "all .35s" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Logo size={22} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.02em", color: C.ink }}>TemPad Dev</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {[["Source", "https://github.com/ecomfe/tempad-dev"], ["Discord", "https://discord.gg/MXGXwtkEck"]].map(([l, h], i) => (
              <a key={i} href={h} style={{ fontSize: 13, color: C.t4, transition: "color .2s" }} onMouseEnter={e => e.target.style.color = C.t1} onMouseLeave={e => e.target.style.color = C.t4}>{l}</a>
            ))}
            <a href="https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc" style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: C.ink, padding: "7px 18px", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,.1),0 1px 1px rgba(0,0,0,.06)", transition: "all .2s" }} onMouseEnter={e => e.target.style.background = "#444"} onMouseLeave={e => e.target.style.background = C.ink}>Install</a>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "144px 24px 88px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
          <Logo size={28} />
          <span style={{ fontSize: 14, color: C.t4 }}>Open handoff tooling on Figma</span>
        </div>
        <h1 className="serif" style={{ fontSize: "clamp(48px,10vw,84px)", fontWeight: 400, letterSpacing: "-.035em", lineHeight: .94, color: C.ink, marginBottom: 28 }}>
          Inspect. Transform. Connect.
        </h1>
        <p style={{ fontSize: 17, color: C.t3, lineHeight: 1.75, maxWidth: 460 }}>
          A browser extension that brings design context from Figma into your development workflow. Open source, MIT licensed.
        </p>
      </section>

      {/* ═══ INSPECT ═══ */}
      <section style={{ background: `linear-gradient(180deg,${C.sand} 0%,${C.bg} 100%)`, borderTop: "1px solid rgba(0,0,0,.04)", padding: "76px 24px 84px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: C.t4, letterSpacing: ".05em", marginBottom: 14 }}>INSPECT</p>
          <h2 className="serif" style={{ fontSize: "clamp(28px,4.5vw,40px)", fontWeight: 400, letterSpacing: "-.02em", lineHeight: 1.15, color: C.ink, marginBottom: 14 }}>
            Read design context from Figma's runtime.
          </h2>
          <p style={{ fontSize: 15, color: C.t3, lineHeight: 1.7, maxWidth: 480, marginBottom: 40 }}>
            Figma's view-only Properties panel shows dimensions and variable names. TemPad Dev gives you the complete picture: CSS code, JavaScript objects, resolved variable values, and layout properties like padding, gap, and display.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 24, alignItems: "start" }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.t4, letterSpacing: ".04em", marginBottom: 14 }}>FIGMA VIEW-ONLY</p>
              <FigmaPanel />
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.ink, letterSpacing: ".04em", marginBottom: 14 }}>TEMPAD DEV</p>
              <TPPanel />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,160px),1fr))", gap: "20px 32px", marginTop: 48 }}>
            {[
              ["Deep select", "Click into nested layers directly."],
              ["Measure", "Spacing without modifier keys."],
              ["Scroll to view", "Center node at 100% zoom."],
              ["Units and scale", "px to rem, custom root font size."],
            ].map(([k, v], i) => (
              <div key={i}>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 3 }}>{k}</p>
                <p style={{ fontSize: 13, color: C.t4, lineHeight: 1.55 }}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TRANSFORM ═══ */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "80px 24px" }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: C.t4, letterSpacing: ".05em", marginBottom: 14 }}>TRANSFORM</p>
        <h2 className="serif" style={{ fontSize: "clamp(28px,4.5vw,40px)", fontWeight: 400, letterSpacing: "-.02em", lineHeight: 1.15, color: C.ink, marginBottom: 14 }}>
          Reshape output through plugins.
        </h2>
        <p style={{ fontSize: 15, color: C.t3, lineHeight: 1.7, maxWidth: 520, marginBottom: 36 }}>
          Override the built-in CSS and JS blocks, convert variables to your own token format, map design components to dev components, or add entirely new output formats. Plugins run sandboxed in Web Workers with no DOM or network access, and only a restricted set of globals is available in the execution context.
        </p>

        <Code label="plugin.ts">
          <span style={{ color: C.kw }}>import</span>{" { definePlugin } "}<span style={{ color: C.kw }}>from</span> <span style={{ color: C.str }}>'@tempad-dev/plugins'</span>{"\n\n"}<span style={{ color: C.kw }}>export default</span> <span style={{ color: C.fn }}>definePlugin</span>{"({\n  name: "}<span style={{ color: C.str }}>'My Plugin'</span>{",\n  code: {\n    css: {\n      title: "}<span style={{ color: C.str }}>'SCSS'</span>{",\n      lang: "}<span style={{ color: C.str }}>'scss'</span>{",\n      "}<span style={{ color: C.fn }}>transform</span>{"({ style }) {\n        "}<span style={{ color: C.kw }}>return</span>{" Object."}<span style={{ color: C.fn }}>entries</span>{"(style)\n          ."}<span style={{ color: C.fn }}>map</span>{"(([k, v]) => "}<span style={{ color: C.str }}>{"`${k}: ${v};`"}</span>{")\n          ."}<span style={{ color: C.fn }}>join</span>{"("}<span style={{ color: C.str }}>"'\\n'"}</span>{")\n      }\n    },\n    js: "}<span style={{ color: C.kw }}>false</span>{"\n  }\n})"}</Code>

        <p style={{ fontSize: 14, color: C.t4, lineHeight: 1.65, marginTop: 24, maxWidth: 520 }}>
          Install from the plugin registry by name, or paste any CORS-accessible URL. Nuxt's official UI Figma Kit recommends TemPad Dev with the <span className="mono" style={{ fontSize: 12.5 }}>@nuxt</span> plugin for component code generation.
        </p>
      </section>

      {/* ═══ CONNECT ═══ */}
      <section style={{ background: C.card, borderTop: "1px solid rgba(0,0,0,.05)", borderBottom: "1px solid rgba(0,0,0,.05)", padding: "80px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: C.t4, letterSpacing: ".05em", marginBottom: 14 }}>CONNECT</p>
          <h2 className="serif" style={{ fontSize: "clamp(28px,4.5vw,40px)", fontWeight: 400, letterSpacing: "-.02em", lineHeight: 1.15, color: C.ink, marginBottom: 14 }}>
            MCP server for agents and IDEs.
          </h2>
          <p style={{ fontSize: 15, color: C.t3, lineHeight: 1.7, maxWidth: 520, marginBottom: 36 }}>
            Expose the current Figma selection to any MCP-compatible client. Select a component in Figma, and your agent calls <span className="mono" style={{ fontSize: 13, color: C.fn }}>get_code</span> to receive framework-ready output with resolved tokens and exported assets, or <span className="mono" style={{ fontSize: 13, color: C.fn }}>get_structure</span> for the component tree. The bundled <span className="mono" style={{ fontSize: 13, color: C.fn }}>figma-design-to-code</span> skill instructs agents to translate what you've selected into repository-native code.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 20 }}>
            <Code label="MCP config">
              {"{\n  "}<span style={{ color: C.str }}>"mcpServers"</span>{": {\n    "}<span style={{ color: C.str }}>"TemPad Dev"</span>{": {\n      "}<span style={{ color: C.str }}>"command"</span>{": "}<span style={{ color: C.str }}>"npx"</span>{",\n      "}<span style={{ color: C.str }}>"args"</span>{": [\n        "}<span style={{ color: C.str }}>"-y"</span>{",\n        "}<span style={{ color: C.str }}>"@tempad-dev/mcp@latest"</span>{"\n      ]\n    }\n  }\n}"}</Code>
            <AgentConvo />
          </div>
          <p style={{ fontSize: 12, color: C.t5, marginTop: 16 }}>Requires Node.js 18+ and TemPad Dev running in a Figma tab.</p>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "80px 24px 100px" }}>
        <a href="https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc" style={{ transition: "opacity .25s" }} onMouseEnter={e => e.target.style.opacity = .5} onMouseLeave={e => e.target.style.opacity = 1}>
          <span className="serif" style={{ fontSize: "clamp(36px,7vw,60px)", fontWeight: 400, letterSpacing: "-.025em", lineHeight: 1.1, display: "block", color: C.ink }}>Add to Chrome →</span>
        </a>
        <p style={{ fontSize: 13, color: C.t5, marginTop: 16 }}>Open source · MIT</p>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid rgba(0,0,0,.05)", padding: "24px 24px 40px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Logo size={16} />
            <span style={{ fontSize: 12, color: C.t5 }}>TemPad Dev</span>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[["GitHub", "https://github.com/ecomfe/tempad-dev"], ["Chrome Web Store", "https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc"], ["npm", "https://www.npmjs.com/package/@tempad-dev/plugins"], ["Discord", "https://discord.gg/MXGXwtkEck"]].map(([l, h], i) => (
              <a key={i} href={h} style={{ fontSize: 12, color: C.t5, transition: "color .2s" }} onMouseEnter={e => e.target.style.color = C.t3} onMouseLeave={e => e.target.style.color = C.t5}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
