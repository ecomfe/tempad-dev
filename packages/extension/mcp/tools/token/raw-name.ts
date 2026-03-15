import { canonicalizeVarName } from '@/utils/css'

export function getVariableRawName(variable: Variable): string {
  // Prefer WEB codeSyntax when it can be interpreted as a CSS custom property reference.
  // This keeps token canonical names aligned with getCSSAsync output when codeSyntax is set.
  const cs = variable.codeSyntax?.WEB
  if (typeof cs === 'string' && cs.trim()) {
    const canonical = canonicalizeVarName(cs.trim())
    if (canonical) return canonical.slice(2)

    // Some teams set WEB codeSyntax directly to an identifier like "kui-color-brand".
    // Only accept safe identifiers here; everything else falls back to variable.name.
    const ident = cs.trim()
    if (/^[A-Za-z0-9_-]+$/.test(ident)) return ident
  }

  const raw = variable.name?.trim?.() ?? ''
  // If the Figma variable name itself starts with "--", treat that as already being a CSS var name.
  if (raw.startsWith('--')) return raw.slice(2)
  return raw
}
