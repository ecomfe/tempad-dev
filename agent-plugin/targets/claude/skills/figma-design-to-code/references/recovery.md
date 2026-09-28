# Recover trustworthy design evidence

Read this reference only when TemPad is unavailable, a `get_code` call warns
or fails, or the requested selection cannot fit in one trustworthy response.

## Connection and target failures

For a transient transport failure, retry once. Do not blind-retry invalid
selection, hidden node, wrong file, deterministic budget, or depth errors.

If TemPad is active on the wrong file, call `list_design_sessions` and pass the intended
file's exact `sessionId` to `get_code` or another independent read. This does not change
the active MCP badge. If the intended file is not connected or TemPad is unavailable,
ask the user to enable MCP access in TemPad Dev **Preferences > Agent integration**
and keep the intended Figma tab open. The badge still chooses the default for reads
that omit `sessionId`.

Do not edit code while design evidence is untrustworthy.

## Incomplete `get_code` results

Preserve the largest trustworthy parent composition and narrow only the
missing evidence:

- **`remainingNodeIds`**: call `get_code` with those exact `nodeIds` and unchanged
  options. They are deferred roots, not failed or omitted children. Keep completed
  results and do not rediscover the live selection.
- **per-node `error`**: recover only that root using its exact `nodeId`; successful
  peers remain valid. Hidden, missing, and deterministic failures require correcting
  the reported condition before retrying.
- **`depth-cap`**: keep the returned top-level composition, then use returned
  `data-hint-id` values for targeted child `get_code` calls.
- **`token-resolution`**: some references remain in code even with
  `resolveTokens: true`. Treat those consumer values as unresolved; do not
  replace them with a collection default or claim all values were inlined.
- **`token-definition`**: definitions or mode labels are missing or ambiguous.
  Use the reported variable/node identity to narrow the affected evidence.
  Do not choose a variable by equal value or infer a missing alias target.
  Retry after the missing resource or naming ambiguity is corrected.
- **budget overflow or shell response**: keep the returned parent shell, then
  fetch omitted children separately. Use the smallest parent that still proves
  their shared layout. Plain string truncation is not evidence.
- **hierarchy, geometry, or overlap uncertainty**: call TemPad Dev's
  `get_structure` only to resolve that uncertainty or select a narrower retry
  target.

Never rebuild a missing parent from child metadata. If no trustworthy parent
shell can be recovered, stop the full implementation and ask the user to
narrow the selection or choose the highest-priority subtree.

If a budget error requires user action, report its consumption, limit, and
overage from the tool response.

## Resolve contradictions

Prefer the evidence source with authority over the disputed fact: project
evidence for implementation conventions, `get_code` for visible design, and
the user for product intent. Narrow the read once when the conflict may be a
scope problem. If the sources still disagree, stop rather than choose silently.

## Worked example

When a large frame returns a usable header-and-grid shell but omits three cards,
keep the shell as the parent layout, fetch only those card subtrees, and insert
them into the known grid. If the response contains cards but no trustworthy
grid shell, do not infer columns or spacing from `get_structure`; request a
narrower parent selection.
