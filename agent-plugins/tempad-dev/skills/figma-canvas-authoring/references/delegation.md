# Delegate bounded evidence work

Design judgment is partly tacit: no handoff fully encodes the user, product,
canvas, references, and emerging composition. Delegate evidence and isolated
production, never focal judgment. The main agent synthesizes and remains the
only Canvas writer.

## Pass the delegation gate

Spawn the smallest useful number of subagents only when every condition holds:

1. **Separable:** the work has a stable objective and does not depend on an
   evolving design decision.
2. **Compressible:** the relevant context fits in a compact task-local brief
   without recreating the main conversation.
3. **Isolated:** the work is read-only or produces an isolated artifact; it
   never mutates the shared Figma canvas, design-system state, or another
   agent's files.
4. **Verifiable:** the result can return as citations, an importable asset
   reference, exact facts, or a bounded defect list that the main agent can
   inspect.
5. **Worth coordinating:** parallelism, specialized capability, or an
   independent perspective materially outweighs handoff and synthesis cost.

Keep work local when any condition fails. Do not delegate for ritual,
convenience, or another unsupported aesthetic opinion.

## Write a complete handoff

Give each subagent:

- one objective and why it matters to the composition;
- only the frozen product, audience, platform, visual, and resource constraints
  needed for that objective;
- permitted tools, sources, and artifacts;
- explicit exclusions and the no-Canvas-write boundary;
- an exact output contract and stop condition.

The main agent reads required Canvas references and sets resource and safety
boundaries; never delegate this skill's interpretation. Use a fresh or
minimum-context worker when possible, send source evidence rather than the main
agent's conclusion, and avoid overlapping assignments.

## Delegate only suitable tracks

### Research scout

Delegate a bounded evidence question after the main agent frames the design
problem. Return only:

```txt
source; evidence role; transferable principle; relevance; authority/copying boundary
```

The scout does not choose the direction. One may cover behavioral and
expressive roles when both questions are explicit; use two only for independent
search spaces.

### Asset scout

Delegate generation or source exploration only after fixing the asset's role,
subject, aspect ratio, palette/style, empty space, and exclusions. Return one
importable `imageUrl` or `assetHash` per role, with MIME type, dimensions, and a
factual description. Return no bytes, discarded candidates, or transcript. The
main agent owns crop, placement, and judgment.

### Independent QA scout

After the representative composition exists, give a fresh worker its screenshot
and the frozen brief without the creator's rationale or suspected defects. Ask
for at most eight factual observations:

```txt
severity; screen/node or region; observed defect; visible evidence; violated constraint
```

The scout does not edit, redesign, or declare completion. The main agent checks
each observation against the live canvas.

### Inventory scout

Delegate read-only inventory only when enough independent material makes it
worthwhile, such as checking several screens or icon candidates. Return exact
findings and references, not a design proposal.

## Orchestrate conservatively

- Default to one worker and at most two concurrent, non-overlapping workers.
- Keep the main agent productive; do not delegate a faster local critical path.
- Only the main agent interprets ambiguous intent, resolves conflicts, chooses
  the direction, and calls `apply_canvas`.
- Resolve conflicts from evidence, not voting. Discard unverifiable or
  out-of-scope claims, and stop when evidence is sufficient.

Never delegate interdependent page/component construction, component
authoring plus instance placement, updates to the same root, final composition,
or final acceptance. These require the main agent's continuous awareness of the
whole and a single ordered mutation stream.
