# Recover trustworthy design evidence

Read this reference when a `get_code` read is unavailable, targets the wrong
file, reports warnings or errors, or leaves requested evidence incomplete.

## Connection and target failures

For a transient transport failure, retry once. Do not blind-retry invalid
selection, hidden node, wrong file, deterministic budget, or depth errors.

If TemPad is active on the wrong file, call `list_design_sessions` and pass the intended
file's exact `sessionId` to `get_code` or another independent read. This does not change
the active MCP badge. If the intended file is not connected or TemPad is unavailable,
ask the user to enable MCP access in TemPad Dev **Preferences > Agent integration**
and keep the intended Figma tab open. The badge still chooses the default for reads
that omit `sessionId`.

## Incomplete `get_code` results

Keep completed root results and recover only the missing evidence. Within an
affected root, preserve any trustworthy parent composition:

- **`remainingNodeIds`**: pass these exact IDs as `nodeIds` to `get_code`,
  preserving the session/task scope and read options. Continue until all requested
  roots are read or a concrete blocker is identified. These are deferred roots,
  distinct from omitted children in a shell; do not rediscover the live selection.
- **per-node `error`**: recover only that root using its exact `nodeId`; successful
  peers remain valid. Hidden, missing, and deterministic failures require correcting
  the reported condition before retrying.
- **`depth-cap`**: keep the returned top-level composition, then use returned
  `data-hint-id` values for targeted child `get_code` calls.
- **`token-resolution`**: some references remain in code even with
  `resolveTokens: true`. Treat those consumer values as unresolved; do not
  replace them with a collection default or claim all values were inlined.
- **`token-definition`**: definitions or mode labels are missing or ambiguous.
  Pause decisions that depend on those facts; successfully resolved consumer
  literals remain usable under the [token fallback guidance](assets-and-tokens.md#tokens).
  Use the reported names or IDs to narrow the affected evidence. Do not choose a
  variable by equal value or infer a missing alias target. Retry after the missing
  resource or naming ambiguity is corrected.
- **budget overflow or shell response**: keep the returned parent shell, then
  fetch omitted children separately. Use the smallest parent that still proves
  their shared layout. Plain string truncation is not evidence.
- **hierarchy, geometry, or overlap uncertainty**: call TemPad Dev's
  `get_structure` only to resolve that uncertainty or select a narrower retry
  target.

If a required parent composition cannot be recovered, pause that composition
and dependent work; do not reconstruct it from child metadata. Ask for the
missing evidence or a scope decision while retaining independently usable roots.

If a budget error requires user action, use the tool's reported limit and
available size details to explain how to narrow the read.

## Resolve contradictions

Prefer the evidence source with authority over the disputed fact: project
evidence for implementation conventions, `get_code` for visible design, and
the user for product intent. Narrow the read once when the conflict may be a
scope problem. If the sources still disagree, pause the affected work and ask
for the unresolved decision.

## Worked example

When a large frame returns a usable header-and-grid shell but omits three cards,
keep the shell as the parent layout, fetch only those card subtrees, and insert
them into the known grid. If the response contains cards but no trustworthy
grid shell, do not infer columns or spacing from `get_structure`; request a
narrower parent selection.
