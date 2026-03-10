import React, { useEffect, useMemo, useState } from 'react'
import { SiDiscord, SiGithub, SiGooglechrome, SiNpm } from 'react-icons/si'
import { Bot, CheckCircle2, Copy, ExternalLink, Sparkles } from 'lucide-react'

const css = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
:root{
  --bg:#f2f5f8;
  --panel:#f7f7f8;
  --panel-2:#fbfbfc;
  --line:rgba(16,19,25,.08);
  --line-strong:rgba(16,19,25,.14);
  --text:#171b22;
  --text-2:#55606f;
  --text-3:#7d8793;
  --ink:#11161d;
  --blue:#1668dc;
  --green:#0f7b52;
  --shadow:0 12px 32px rgba(10,15,22,.045);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;overflow-x:hidden}
a{text-decoration:none;color:inherit}
button{font:inherit}
::selection{background:rgba(22,104,220,.12)}
.page{
  min-height:100vh;
  background:
    radial-gradient(circle at 0% 0%, rgba(22,104,220,.03), transparent 24%),
    linear-gradient(180deg,#f7f9fc 0%, #f2f5f8 48%, #eef2f6 100%);
}
.page::before{
  content:'';
  position:fixed;
  inset:0;
  pointer-events:none;
  background-image:
    linear-gradient(rgba(13,20,28,.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(13,20,28,.022) 1px, transparent 1px);
  background-size:48px 48px;
  mask-image:radial-gradient(circle at center, rgba(0,0,0,.84), transparent 86%);
  opacity:.16;
}
.container{max-width:1100px;margin:0 auto;padding:0 24px}
.nav{position:sticky;top:0;z-index:40;transition:.22s ease}
.nav.scrolled{background:rgba(247,249,252,.78);backdrop-filter:blur(12px) saturate(140%);border-bottom:1px solid var(--line)}
.nav-wrap{padding:0 24px}
.nav-inner{max-width:1100px;margin:0 auto;min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand-name{font-size:14px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.nav-links{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.nav-link{font-size:13px;color:var(--text-3);font-weight:500}
.nav-link.strong{color:var(--ink);font-weight:700}
.hero{padding:76px 0 62px}
.hero-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:28px}
.hero-brand{font-size:18px;font-weight:800;letter-spacing:-.03em;color:var(--ink)}
.hero-subtitle{margin-top:8px;font-size:14px;line-height:1.6;color:var(--text-3);font-weight:600;letter-spacing:-.01em}
.hero-title{margin:12px 0 0;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(60px,8vw,88px);font-weight:400;line-height:.92;letter-spacing:-.05em;color:var(--ink);max-width:760px}
.hero-copy{max-width:560px;margin:18px 0 0;font-size:15.5px;line-height:1.75;color:var(--text-2)}
.hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.action-button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  min-height:40px;
  padding:0 14px;
  border-radius:10px;
  font-size:12.5px;
  line-height:1;
  font-weight:700;
  letter-spacing:-.01em;
  border:1px solid transparent;
  transition:background .18s ease,border-color .18s ease,box-shadow .18s ease,color .18s ease,transform .18s ease;
}
.action-button svg{width:15px;height:15px;display:block;flex:none}
.action-button.primary{
  background:linear-gradient(180deg,#171d26 0%, #10161e 100%);
  color:#fff;
  border-color:rgba(13,20,28,.86);
  box-shadow:0 1px 2px rgba(13,20,28,.12), 0 8px 18px rgba(13,20,28,.06);
}
.action-button.primary:hover{transform:translateY(-1px)}
.action-button.secondary{
  background:rgba(255,255,255,.72);
  color:var(--ink);
  border-color:rgba(13,20,28,.10);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.72), 0 1px 2px rgba(13,20,28,.03);
}
.action-button.secondary:hover{background:rgba(255,255,255,.86)}
.hero-note{margin-top:18px;font-size:12.5px;color:var(--text-3)}
.overview-card{
  border:1px solid var(--line-strong);
  border-radius:16px;
  background:rgba(248,250,252,.84);
  box-shadow:var(--shadow);
  overflow:hidden;
}
.overview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:18px 18px 16px;border-bottom:1px solid var(--line)}
.overview-title{font-size:22px;font-weight:800;letter-spacing:-.03em;color:var(--ink)}
.overview-copy{margin-top:6px;font-size:13.5px;line-height:1.7;color:var(--text-2);max-width:420px}
.overview-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.overview-badge{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border-radius:999px;border:1px solid rgba(16,19,25,.08);background:rgba(255,255,255,.78);font-size:10.5px;color:var(--ink);font-family:'JetBrains Mono',monospace}
.overview-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid rgba(16,19,25,.04)}
.overview-item + .overview-item{border-left:1px solid rgba(16,19,25,.06)}
.overview-item{padding:16px 18px 18px}
.overview-item-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink)}
.overview-item-title svg{width:15px;height:15px;color:var(--blue)}
.overview-item-copy{margin-top:8px;font-size:13px;line-height:1.7;color:var(--text-2)}
.overview-code{margin-top:14px;border-top:1px solid rgba(16,19,25,.06);padding:14px 18px 18px;background:rgba(255,255,255,.34)}
.mini-code{border:1px solid rgba(16,19,25,.08);border-radius:10px;background:rgba(255,255,255,.78);overflow:hidden}
.mini-code-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid rgba(16,19,25,.06);font-size:10.5px;color:var(--text-3);font-family:'JetBrains Mono',monospace}
.mini-code-body{padding:10px;font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.7;color:#1c2431;white-space:pre-wrap}
.compare-stage{
  border:1px solid var(--line-strong);
  border-radius:16px;
  background:rgba(248,250,252,.82);
  box-shadow:var(--shadow);
  padding:18px;
}
.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.panel-label{margin:0 0 10px;font-size:11px;color:var(--text-3);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em}
.fig-panel,.tempad-panel,.focus-card{
  min-width:0;
  border:1px solid rgba(16,19,25,.08);
  border-radius:12px;
  background:var(--panel);
  box-shadow:0 8px 24px rgba(15,23,34,.04);
  overflow:hidden;
}
.panel-top{padding:18px 22px;border-bottom:1px solid var(--line);font-size:18px;font-weight:800;letter-spacing:-.03em;color:var(--ink);background:rgba(255,255,255,.34)}
.panel-section{padding:20px 22px;border-bottom:1px solid var(--line)}
.panel-section:last-child{border-bottom:none}
.panel-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.panel-section-title{font-size:12px;font-weight:800;color:var(--ink);letter-spacing:-.01em}
.panel-section-note{font-size:10.5px;color:var(--text-3);font-family:'JetBrains Mono',monospace}
.panel-row{display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-size:12px;color:var(--ink)}
.panel-row-label{color:#7c7c82}
.panel-row-value{text-align:right}
.token-pill{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:8px;border:1px solid rgba(16,19,25,.08);background:rgba(255,255,255,.76);font-size:10.5px;color:var(--ink);font-family:'Inter',system-ui,sans-serif}
.select-chip{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:0 8px;border-radius:8px;border:1px solid rgba(22,104,220,.24);background:rgba(22,104,220,.06);font-size:10.5px;color:var(--blue);font-weight:700}
.code-stack{display:grid;gap:14px}
.code-block-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.code-block-title{font-size:12px;color:var(--ink)}
.code-card{border:1px solid rgba(16,19,25,.08);border-radius:12px;background:rgba(255,255,255,.76);overflow:hidden}
.code-card-head{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(16,19,25,.06);font-size:10.5px;color:var(--text-3);font-family:'JetBrains Mono',monospace}
.code-preview{display:grid;grid-template-columns:32px minmax(0,1fr);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.8;background:rgba(16,19,25,.018)}
.code-gutter{padding:10px 0 10px 10px;color:#a2a6ad;border-right:1px solid rgba(16,19,25,.05);white-space:pre}
.code-content{padding:10px 12px;color:#1c2431;white-space:pre-wrap;word-break:break-word}
.copy-glyph{font-size:12px;color:var(--text-3)}
.tok-key{color:#ef2db2}
.tok-prop{color:#22242b;font-weight:500}
.tok-var{color:#2f2f2f;text-decoration:underline;text-decoration-style:dashed;text-decoration-color:#7fbc7f;text-underline-offset:3px}
.tok-str{color:#1677ff}
.tok-num{color:#ef2db2}
.section{padding:78px 0;border-top:1px solid rgba(13,20,28,.06)}
.section.alt{background:linear-gradient(180deg, rgba(231,237,244,.44) 0%, rgba(242,245,248,0) 100%)}
.section-grid{display:grid;grid-template-columns:120px minmax(0,1fr);gap:28px;align-items:start}
.section-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);font-family:'JetBrains Mono',monospace;padding-top:6px}
.section-main{min-width:0}
.section-title{margin:0;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(34px,5vw,46px);font-weight:400;line-height:1.02;letter-spacing:-.03em;color:var(--ink)}
.section-copy{max-width:620px;margin:12px 0 0;font-size:14.5px;line-height:1.75;color:var(--text-2)}
.section-rule{margin-top:24px;padding-top:16px;border-top:1px solid rgba(13,20,28,.08)}
.focus-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.38)}
.focus-card-title{font-size:13px;font-weight:700;color:var(--ink)}
.focus-card-note{font-size:11px;color:var(--text-3)}
.focus-card-body{padding:16px}
.focus-card-copy{margin:0;font-size:14px;line-height:1.75;color:var(--text-2);max-width:620px}
.meta-list{display:grid;gap:8px;margin-top:14px}
.meta-row{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--text-2)}
.meta-row span:first-child{color:var(--text-3)}
.connect-tools{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.tool-pill{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border-radius:10px;border:1px solid rgba(16,19,25,.08);background:rgba(255,255,255,.74);font-size:12.5px;color:var(--ink)}
.tool-pill svg{width:14px;height:14px;color:var(--text-3)}
.utility-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.utility-button{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid rgba(16,19,25,.10);background:rgba(255,255,255,.76);font-size:12.5px;color:var(--ink)}
.utility-button svg{width:14px;height:14px;display:block}
.status-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.status-pill{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border-radius:999px;border:1px solid rgba(15,123,82,.14);background:rgba(15,123,82,.06);font-size:11px;color:var(--green);font-family:'JetBrains Mono',monospace}
.status-pill svg{width:14px;height:14px;display:block}
.agent-card{margin-top:16px;border:1px solid rgba(16,19,25,.08);border-radius:12px;background:rgba(255,255,255,.72);overflow:hidden}
.agent-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(16,19,25,.06);font-size:12px;color:var(--text-3)}
.agent-thread{padding:12px;display:grid;gap:12px}
.agent-message{padding:12px;border-radius:10px;background:var(--panel-2);border:1px solid rgba(16,19,25,.06)}
.agent-role{font-size:10.5px;color:var(--text-3);font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em}
.agent-body{margin-top:6px;font-size:13px;line-height:1.75;color:var(--ink)}
.endbar{padding:30px 0 12px;border-top:1px solid rgba(13,20,28,.08)}
.endbar-row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
.endbar-title{margin:0;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(36px,5vw,54px);font-weight:400;line-height:.96;letter-spacing:-.04em;color:var(--ink)}
.endbar-copy{margin:10px 0 0;font-size:14px;line-height:1.75;color:var(--text-2);max-width:520px}
.link-actions{display:flex;gap:10px;flex-wrap:wrap}
.icon-link{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:40px;
  height:40px;
  border-radius:10px;
  border:1px solid rgba(13,20,28,.10);
  background:rgba(255,255,255,.72);
  color:var(--ink);
}
.icon-link svg{width:16px;height:16px;display:block}
.footer{padding:16px 0 34px;color:var(--text-3);font-size:12px}
.footer-row{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}
.footer-brand{font-size:12px;color:var(--text-3)}
@media (max-width: 980px){
  .overview-grid,.compare-grid,.section-grid{grid-template-columns:1fr}
  .overview-item + .overview-item{border-left:none;border-top:1px solid rgba(16,19,25,.06)}
}
@media (max-width: 640px){
  .container{padding:0 18px}
  .nav-wrap{padding:0 18px}
  .nav-inner{min-height:auto;padding:14px 0;align-items:flex-start}
  .hero{padding:44px 0 40px}
  .hero-copy{font-size:15px}
  .section{padding:58px 0}
  .overview-head,.panel-top,.panel-section,.focus-card-body{padding-left:14px;padding-right:14px}
  .overview-code{padding-left:14px;padding-right:14px}
}
`

const heroCodeLines = [
  [
    ['display', 'prop'],
    [': ', 'plain'],
    ['flex', 'key'],
    [';', 'plain'],
  ],
  [
    ['padding', 'prop'],
    [': ', 'plain'],
    ['$kui-space-70', 'var'],
    [';', 'plain'],
  ],
  [
    ['gap', 'prop'],
    [': ', 'plain'],
    ['20px', 'num'],
    [';', 'plain'],
  ],
  [
    ['border-radius', 'prop'],
    [': ', 'plain'],
    ['$kui-border-radius-30', 'var'],
    [';', 'plain'],
  ],
  [
    ['border', 'prop'],
    [': ', 'plain'],
    ['$kui-border-width-10', 'var'],
    [' solid ', 'plain'],
    ['$kui-color-border', 'var'],
    [';', 'plain'],
  ],
]

const scssLines = [
  [
    ['display', 'prop'],
    [': ', 'plain'],
    ['flex', 'key'],
    [';', 'plain'],
  ],
  [
    ['padding', 'prop'],
    [': ', 'plain'],
    ['$kui-space-70', 'var'],
    [';', 'plain'],
  ],
  [
    ['flex-direction', 'prop'],
    [': ', 'plain'],
    ['column', 'key'],
    [';', 'plain'],
  ],
  [
    ['align-items', 'prop'],
    [': ', 'plain'],
    ['flex-start', 'key'],
    [';', 'plain'],
  ],
  [
    ['gap', 'prop'],
    [': ', 'plain'],
    ['20px', 'num'],
    [';', 'plain'],
  ],
  [
    ['flex', 'prop'],
    [': ', 'plain'],
    ['1 0 0', 'num'],
    [';', 'plain'],
  ],
  [
    ['align-self', 'prop'],
    [': ', 'plain'],
    ['stretch', 'key'],
    [';', 'plain'],
  ],
  [
    ['border-radius', 'prop'],
    [': ', 'plain'],
    ['$kui-border-radius-30', 'var'],
    [';', 'plain'],
  ],
  [
    ['border', 'prop'],
    [': ', 'plain'],
    ['$kui-border-width-10', 'var'],
    [' solid ', 'plain'],
    ['$kui-color-border', 'var'],
    [';', 'plain'],
  ],
  [
    ['background-color', 'prop'],
    [': ', 'plain'],
    ['$kui-color-background', 'var'],
    [';', 'plain'],
  ],
]

const jsLines = [
  [['{', 'plain']],
  [
    ['  display', 'prop'],
    [': ', 'plain'],
    ["'flex'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  padding', 'prop'],
    [': ', 'plain'],
    ['KUI_SPACE_70', 'var'],
    [',', 'plain'],
  ],
  [
    ['  flexDirection', 'prop'],
    [': ', 'plain'],
    ["'column'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  alignItems', 'prop'],
    [': ', 'plain'],
    ["'flex-start'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  gap', 'prop'],
    [': ', 'plain'],
    ["'20px'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  flex', 'prop'],
    [': ', 'plain'],
    ["'1 0 0'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  alignSelf', 'prop'],
    [': ', 'plain'],
    ["'stretch'", 'str'],
    [',', 'plain'],
  ],
  [
    ['  borderRadius', 'prop'],
    [': ', 'plain'],
    ['KUI_BORDER_RADIUS_30', 'var'],
    [',', 'plain'],
  ],
  [
    ['  border', 'prop'],
    [': ', 'plain'],
    ['`${KUI_BORDER_WIDTH_10} solid ${KUI_COLOR_BORDER}`', 'str'],
    [',', 'plain'],
  ],
  [
    ['  backgroundColor', 'prop'],
    [': ', 'plain'],
    ['KUI_COLOR_BACKGROUND', 'var'],
  ],
  [['}', 'plain']],
]

const transformPluginLines = [
  [
    ['import', 'key'],
    [' { definePlugin } ', 'plain'],
    ['from', 'key'],
    [" '@tempad-dev/plugins'", 'str'],
  ],
  [['', 'plain']],
  [
    ['export', 'key'],
    [' default ', 'plain'],
    ['definePlugin', 'prop'],
    ['({', 'plain'],
  ],
  [
    ['  code', 'prop'],
    [': {', 'plain'],
  ],
  [
    ['    css', 'prop'],
    [': { ', 'plain'],
    ['transform', 'prop'],
    ['() {} },', 'plain'],
  ],
  [
    ['    js', 'prop'],
    [': { ', 'plain'],
    ['transform', 'prop'],
    ['() {} }', 'plain'],
  ],
  [['  },', 'plain']],
  [
    ['  transformVariable', 'prop'],
    ['() {},', 'plain'],
  ],
  [
    ['  transformPx', 'prop'],
    ['() {},', 'plain'],
  ],
  [
    ['  transformComponent', 'prop'],
    ['() {}', 'plain'],
  ],
  [['})', 'plain']],
]

function flattenLines(lines) {
  return lines.map((line) => line.map(([text]) => text).join('')).join('\n')
}

function buildLineNumbers(lines) {
  return lines.map((_, index) => index + 1).join('\n')
}

function runSnippetTests() {
  const checks = [
    [
      'flatten hero lines',
      flattenLines(heroCodeLines) ===
        'display: flex;\npadding: $kui-space-70;\ngap: 20px;\nborder-radius: $kui-border-radius-30;\nborder: $kui-border-width-10 solid $kui-color-border;',
    ],
    ['build hero line numbers', buildLineNumbers(heroCodeLines) === '1\n2\n3\n4\n5'],
    [
      'flatten scss lines',
      flattenLines(scssLines).startsWith('display: flex;\npadding: $kui-space-70;'),
    ],
    [
      'build js line numbers',
      buildLineNumbers(jsLines) === '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12',
    ],
    ['plugin snippet includes transformPx', transformPluginLines[8][0][0] === '  transformPx'],
    ['plugin snippet starts with import', transformPluginLines[0][0][0] === 'import'],
  ]

  return checks.filter(([, pass]) => !pass).map(([name]) => name)
}

function toneClass(tone) {
  if (tone === 'key') return 'tok-key'
  if (tone === 'prop') return 'tok-prop'
  if (tone === 'var') return 'tok-var'
  if (tone === 'str') return 'tok-str'
  if (tone === 'num') return 'tok-num'
  return ''
}

function CodeCard({ title, lines }) {
  const gutter = buildLineNumbers(lines)

  return (
    <div className="code-card">
      <div className="code-card-head">
        <span>{title}</span>
        <span className="copy-glyph">⧉</span>
      </div>
      <div className="code-preview">
        <div className="code-gutter">{gutter}</div>
        <div className="code-content">
          {lines.map((line, index) => (
            <div key={index}>
              {line.map(([text, tone], partIndex) => (
                <span key={partIndex} className={toneClass(tone)}>
                  {text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PanelRow({ label, value }) {
  return (
    <div className="panel-row">
      <span className="panel-row-label">{label}</span>
      <span className="panel-row-value">{value}</span>
    </div>
  )
}

function HeroOverview() {
  return (
    <div className="overview-card">
      <div className="overview-head">
        <div>
          <div className="overview-title">TemPad Dev</div>
          <div className="overview-copy">
            Free and open source tooling for reading, reshaping, and carrying design context
            forward.
          </div>
        </div>
        <div className="overview-badges">
          <span className="overview-badge">free</span>
          <span className="overview-badge">open source</span>
          <span className="overview-badge">MIT</span>
        </div>
      </div>
      <div className="overview-grid">
        <div className="overview-item">
          <div className="overview-item-title">
            <Sparkles />
            <span>Inspect</span>
          </div>
          <div className="overview-item-copy">
            Code, variables, and practical tools, in a dedicated panel.
          </div>
        </div>
        <div className="overview-item">
          <div className="overview-item-title">
            <Bot />
            <span>Transform</span>
          </div>
          <div className="overview-item-copy">
            Output that can be shaped to match your own design system.
          </div>
        </div>
        <div className="overview-item">
          <div className="overview-item-title">
            <ExternalLink />
            <span>Connect</span>
          </div>
          <div className="overview-item-copy">
            The same context, made available to editors and coding agents.
          </div>
        </div>
      </div>
      <div className="overview-code">
        <div className="mini-code">
          <div className="mini-code-head">
            <span>SCSS</span>
            <span>Kong UI</span>
          </div>
          <div className="mini-code-body">{flattenLines(heroCodeLines)}</div>
        </div>
      </div>
    </div>
  )
}

function FigmaPropertiesPanel() {
  return (
    <div className="fig-panel">
      <div className="panel-top">Plugin--Card</div>
      <div className="panel-section">
        <div className="panel-section-head">
          <div className="panel-section-title">Component properties</div>
          <div className="panel-section-note">⧉</div>
        </div>
        <PanelRow label="Show Badge" value="true" />
        <PanelRow label="Show icon" value="true" />
        <PanelRow label="Title" value="Datakit" />
        <PanelRow label="Description" value="Datakit is a workflo..." />
      </div>
      <div className="panel-section">
        <div className="panel-section-head">
          <div className="panel-section-title">Layout</div>
          <div className="panel-section-note">⧉</div>
        </div>
        <PanelRow label="Flow" value="Vertical" />
        <PanelRow label="Width" value="Fill (269.33px)" />
        <PanelRow label="Height" value="Fill (214px)" />
        <PanelRow label="Radius" value={<span className="token-pill">border-radius-30</span>} />
        <PanelRow label="Border" value={<span className="token-pill">border-width-10</span>} />
        <PanelRow label="Padding" value={<span className="token-pill">space-70</span>} />
        <PanelRow label="Gap" value="20px" />
      </div>
      <div className="panel-section">
        <div className="panel-section-head">
          <div className="panel-section-title">Colors</div>
          <div className="token-pill">Hex</div>
        </div>
        <PanelRow label="Background" value="color-background" />
        <PanelRow label="Hex" value="#FFFFFF" />
      </div>
      <div className="panel-section">
        <div className="panel-section-head">
          <div className="panel-section-title">Borders</div>
          <div className="token-pill">Hex</div>
        </div>
        <PanelRow label="Width" value="1px" />
        <PanelRow label="Color" value="color-border" />
        <PanelRow label="Hex" value="#E0E4EA" />
      </div>
    </div>
  )
}

function TempadComparePanel() {
  return (
    <div className="tempad-panel">
      <div className="panel-top">Plugin--Card</div>
      <div className="panel-section">
        <div className="panel-section-head">
          <div className="panel-section-title">Code</div>
          <span className="select-chip">Kong UI</span>
        </div>
        <div className="code-stack">
          <div>
            <div className="code-block-title-row">
              <div className="code-block-title">SCSS</div>
              <div className="copy-glyph">⧉</div>
            </div>
            <CodeCard title="scss" lines={scssLines} />
          </div>
          <div>
            <div className="code-block-title-row">
              <div className="code-block-title">JavaScript</div>
              <div className="copy-glyph">⧉</div>
            </div>
            <CodeCard title="javascript" lines={jsLines} />
          </div>
        </div>
      </div>
    </div>
  )
}

function InspectSheet() {
  return (
    <div className="compare-stage">
      <div className="compare-grid">
        <div>
          <div className="panel-label">Figma properties panel</div>
          <FigmaPropertiesPanel />
        </div>
        <div>
          <div className="panel-label">TemPad Dev panel</div>
          <TempadComparePanel />
        </div>
      </div>
    </div>
  )
}

function TransformSheet() {
  return (
    <div className="focus-card">
      <div className="focus-card-head">
        <div className="focus-card-title">Plugin example</div>
        <div className="focus-card-note">from README</div>
      </div>
      <div className="focus-card-body">
        <p className="focus-card-copy">
          A plugin can reshape code blocks, variables, units, and component mapping so the output
          fits the system you already ship.
        </p>
        <div style={{ marginTop: 16 }}>
          <CodeCard title="plugin.ts" lines={transformPluginLines} />
        </div>
      </div>
    </div>
  )
}

function ConnectSheet() {
  return (
    <div className="focus-card">
      <div className="focus-card-head">
        <div className="focus-card-title">Agent ready</div>
        <div className="focus-card-note">MCP</div>
      </div>
      <div className="focus-card-body">
        <p className="focus-card-copy">
          Set it up once, then let agents and editors pull design context when they need it.
        </p>
        <div className="connect-tools">
          <span className="tool-pill">
            <Bot />
            <span>Cursor</span>
          </span>
          <span className="tool-pill">
            <Bot />
            <span>Claude Code</span>
          </span>
          <span className="tool-pill">
            <Bot />
            <span>VS Code</span>
          </span>
          <span className="tool-pill">
            <Bot />
            <span>Windsurf</span>
          </span>
        </div>
        <div className="utility-actions">
          <button className="utility-button">
            <Copy />
            <span>Copy config</span>
          </button>
          <button className="utility-button">
            <Copy />
            <span>Copy command</span>
          </button>
          <button className="utility-button">
            <ExternalLink />
            <span>Open docs</span>
          </button>
        </div>
        <div className="status-row">
          <span className="status-pill">
            <CheckCircle2 />
            <span>Connected</span>
          </span>
          <span className="status-pill">
            <CheckCircle2 />
            <span>Context ready</span>
          </span>
        </div>
        <div className="agent-card">
          <div className="agent-card-head">
            <span>Example conversation</span>
            <span>coding agent</span>
          </div>
          <div className="agent-thread">
            <div className="agent-message">
              <div className="agent-role">Prompt</div>
              <div className="agent-body">
                Build the pricing card from Figma in our React app. Reuse our Card and Badge
                components.
              </div>
            </div>
            <div className="agent-message">
              <div className="agent-role">Result</div>
              <div className="agent-body">
                Mapped the outer frame to <code>Card</code>, preserved spacing tokens, and kept the
                Badge composition aligned with the design source.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TempadLandingOpenV8() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const snippetFailures = runSnippetTests()
    if (snippetFailures.length > 0) {
      throw new Error(`Snippet tests failed: ${snippetFailures.join(', ')}`)
    }

    const onScroll = () => {
      const next = window.scrollY > 12
      setScrolled((prev) => (prev === next ? prev : next))
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="page">
      <style>{css}</style>

      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-wrap">
          <div className="nav-inner">
            <div className="brand-name">TemPad Dev</div>
            <div className="nav-links">
              <a className="nav-link" href="https://github.com/ecomfe/tempad-dev">
                Source
              </a>
              <a className="nav-link" href="https://discord.gg/MXGXwtkEck">
                Discord
              </a>
              <a
                className="nav-link strong"
                href="https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc"
              >
                Install
              </a>
            </div>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="hero-brand">TemPad Dev</div>
            <div className="hero-subtitle">Open handoff tooling on Figma</div>
            <h1 className="hero-title">Inspect, transform, connect.</h1>
            <p className="hero-copy">
              Free and open source. Built to make design handoff easier to read, adapt, and carry
              into implementation.
            </p>
            <div className="hero-actions">
              <a
                className="action-button primary"
                href="https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc"
              >
                <SiGooglechrome />
                <span>Add to Chrome</span>
              </a>
              <a className="action-button secondary" href="https://github.com/ecomfe/tempad-dev">
                <SiGithub />
                <span>Read the source</span>
              </a>
            </div>
            <div className="hero-note">MIT licensed</div>
          </div>

          <HeroOverview />
        </div>
      </section>

      <section className="section alt">
        <div className="container section-grid">
          <div className="section-label">Inspect</div>
          <div className="section-main">
            <h2 className="section-title">Read the output.</h2>
            <p className="section-copy">
              Figma already has the properties. TemPad Dev adds the output engineers actually read.
            </p>
            <div className="section-rule">
              <InspectSheet />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container section-grid">
          <div className="section-label">Transform</div>
          <div className="section-main">
            <h2 className="section-title">Fit your system.</h2>
            <p className="section-copy">
              Start with the default output, then bend it to the conventions you already use.
            </p>
            <div className="section-rule">
              <TransformSheet />
            </div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container section-grid">
          <div className="section-label">Connect</div>
          <div className="section-main">
            <h2 className="section-title">Use it in the editor.</h2>
            <p className="section-copy">
              Once connected, the same context can flow straight into your coding agent.
            </p>
            <div className="section-rule">
              <ConnectSheet />
            </div>
          </div>
        </div>
      </section>

      <section className="endbar">
        <div className="container endbar-row">
          <div>
            <h2 className="endbar-title">Inspect, transform, connect.</h2>
            <p className="endbar-copy">Open handoff tooling on Figma.</p>
          </div>
          <div className="link-actions">
            <a
              className="icon-link"
              href="https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc"
            >
              <SiGooglechrome />
            </a>
            <a className="icon-link" href="https://github.com/ecomfe/tempad-dev">
              <SiGithub />
            </a>
            <a className="icon-link" href="https://www.npmjs.com/package/@tempad-dev/plugins">
              <SiNpm />
            </a>
            <a className="icon-link" href="https://discord.gg/MXGXwtkEck">
              <SiDiscord />
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container footer-row">
          <div className="footer-brand">TemPad Dev</div>
        </div>
      </footer>
    </div>
  )
}
