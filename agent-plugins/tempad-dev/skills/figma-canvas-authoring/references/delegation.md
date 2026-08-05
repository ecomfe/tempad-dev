# Delegate bounded evidence work

Treat design judgment as partly tacit: no handoff can fully encode the situated
whole formed from the user, product, canvas, references, and emerging
composition. Delegate subsidiary evidence and isolated production, never the
focal design judgment. The main agent remains the manager, synthesizer, and only
Canvas writer.

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

Keep the work local when any condition fails. Do not spawn merely to shorten the
main agent's reasoning, satisfy a workflow ritual, or obtain another aesthetic
opinion.

## Write a complete handoff

Give each subagent:

- one objective and why it matters to the composition;
- only the frozen product, audience, platform, visual, and resource constraints
  needed for that objective;
- permitted tools, sources, and artifacts;
- explicit exclusions and the no-Canvas-write boundary;
- an exact output contract and stop condition.

The main agent reads every required Canvas reference and establishes the
resource and safety boundaries itself; never delegate interpretation of this
skill. A worker may follow its own capability skill for its isolated task.

Use a fresh or minimum-context worker when the host supports it. Send raw
screenshots, reference links, or asset briefs instead of the main agent's
conclusion. Ask for evidence, not agreement. Avoid overlapping assignments.

## Delegate only suitable tracks

### Research scout

Delegate a bounded evidence question after the main agent frames the design
problem. Return only:

```txt
source; evidence role; transferable principle; relevance; authority/copying boundary
```

The scout does not choose the final direction. One scout may cover the required
behavioral and expressive roles when the questions are explicit; use two only
when the search spaces are genuinely independent.

### Asset scout

Delegate nontrivial image generation or source exploration only after the main
agent fixes the asset's layout role, subject, aspect ratio, palette/style,
important empty space, and negative constraints. Return one selected importable
`imageUrl` or `assetHash` per frozen asset role, MIME type, dimensions, and a
short factual description. Delegate a batch only when every role is fixed and
the total remains bounded. Do not return bytes, discarded candidates, or a
generation transcript. The main agent owns crop, placement, and final visual
judgment.

### Independent QA scout

After the representative composition exists, give a fresh worker its screenshot
and the frozen brief without the creator's rationale or suspected defects. Ask
for at most eight factual observations:

```txt
severity; screen/node or region; observed defect; visible evidence; violated constraint
```

The scout does not edit, redesign, or declare completion. The main agent checks
each observation against the live canvas and decides the correction.

### Inventory scout

Delegate a deterministic, read-only inventory only when it spans enough
independent material to save real time—for example, checking several supplied
screens for the same defect or verifying candidate icon coverage and licenses.
Return exact findings and references, not a new design proposal.

## Orchestrate conservatively

- Use one worker by default and normally no more than two concurrent workers
  with non-overlapping objectives.
- Keep the main agent productive while workers run; do not delegate the critical
  path when the main task can finish faster locally.
- Let only the main agent interpret ambiguous user intent, resolve conflicts,
  combine evidence, choose the direction, and call `apply_canvas`.
- Resolve conflicting worker results by inspecting their evidence, never by
  voting or averaging.
- Treat a worker result as an input, not a decision. Discard claims that exceed
  the assignment or cannot be independently checked.
- Stop spawning when sufficient evidence exists. More workers do not create a
  stronger design direction by themselves.

Never delegate interdependent page/component construction, component
authoring plus instance placement, updates to the same root, final composition,
or final acceptance. These require the main agent's continuous awareness of the
whole and a single ordered mutation stream.
