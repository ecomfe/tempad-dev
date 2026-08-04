# Recover trustworthy design evidence

Read this reference only when TemPad is unavailable, a `get_code` call warns
or fails, or the requested selection cannot fit in one trustworthy response.

## Connection and target failures

For a transient transport failure, retry once. Do not blind-retry invalid
selection, hidden node, wrong file, deterministic budget, or depth errors.

If TemPad is unavailable or active on the wrong file, stop and ask the user to:

1. enable MCP access in TemPad Dev **Preferences > Agent integration**;
2. keep the intended TemPad Dev and Figma tab active;
3. use the MCP badge in the panel to activate the intended file when multiple
   Figma tabs are open.

Do not edit code while design evidence is untrustworthy.

## Incomplete `get_code` results

Preserve the largest trustworthy parent composition and narrow only the
missing evidence:

- **`depth-cap`**: keep the returned top-level composition, then use returned
  `data-hint-id` values for targeted child `get_code` calls.
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
