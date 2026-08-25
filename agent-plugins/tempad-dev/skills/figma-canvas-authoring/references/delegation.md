# Delegate bounded evidence work

Delegate evidence gathering or isolated production, never focal judgment. The
main agent synthesizes results and remains the only Canvas writer.

## Pass the delegation gate

Delegate only work that is:

1. **Separable:** has a stable objective independent of evolving design choices.
2. **Compressible:** needs only a compact task-local brief.
3. **Isolated:** is read-only or produces an isolated artifact without mutating
   Figma, design-system state, or another agent's files.
4. **Verifiable:** returns citations, importable asset references, exact facts,
   or a bounded defect list the main agent can inspect.
5. **Worth coordinating:** gains enough from parallelism, specialist capability,
   or independent review to justify handoff and synthesis.

Keep work local if any condition fails. Do not delegate for ritual, convenience,
or another unsupported aesthetic opinion.

## Write a complete handoff

Give each worker one objective and its relevance, only required task evidence
and constraints, permitted tools and sources, explicit exclusions including no
Canvas writes, and an exact output contract and stop condition. The main agent
must read required Canvas references and set safety boundaries; never delegate
interpretation of this skill. Prefer fresh or minimum-context workers, pass
source evidence rather than conclusions, and avoid overlapping assignments.

## Suitable tracks

### Research scout

After framing the design problem, delegate a bounded evidence question. Return:

```txt
open decision; exact source; applicable finding; relevance; authority boundary
```

The scout does not choose direction. Combine questions only when their search
space is shared; use multiple scouts only for independent spaces.

### Asset scout

After fixing asset requirements and import contract, return one importable
`imageUrl` or `assetHash` per asset plus MIME type, dimensions, provenance, and
factual description. Return no bytes, rejected candidates, or transcript. The
main agent owns selection and integration.

### Independent QA scout

After a representative composition exists, provide a fresh worker its
screenshot and frozen brief without creator rationale or suspected defects. Ask
for at most eight observations:

```txt
severity; screen/node or region; observed defect; visible evidence; violated constraint
```

The scout neither edits nor declares completion; the main agent checks findings
against the live canvas.

### Inventory scout

Use read-only inventory when independent volume warrants it, such as several
screens or icon candidates. Require exact findings and references, not a design
proposal.

## Orchestrate conservatively

- Default to one worker; use at most two concurrent non-overlapping workers.
- Keep a faster local critical path with the main agent.
- Only the main agent resolves intent and conflicts, chooses direction, calls
  `apply_canvas`, and accepts the result.
- Resolve conflicts from evidence, not voting; discard unverifiable or
  out-of-scope claims and stop when evidence is sufficient.

Never delegate interdependent page or component construction, component
authoring plus instance placement, concurrent updates to one root, final
composition, or final acceptance. These require one ordered mutation stream and
continuous awareness of the whole.
