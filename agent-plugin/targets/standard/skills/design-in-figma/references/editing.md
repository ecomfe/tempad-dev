# Edit an existing result

Use this reference for an update, removal, or change of editor context. Read the
exact target and recover managed keys from structured tool results when prior
call context is unavailable. Names are labels, not identity.

## Describe the desired change

Trace the requested change through its visible dependents: a changed selection
may affect the working surface, label, enabled action, and summary. Preserve
unrelated content and relationships. Preserving the source does not mean
retaining stale representations of its previous state.

Use the smallest owning target that can express the complete change:

- For native state on existing keys, target the exact managed root and send only
  `native`; omit markup to preserve topology.
- For structural changes, read `canvas-html.md`, keep `data-key` stable, and
  include the affected structure. Omitted existing fields and keyed elements
  retain their live state; omission is not deletion.
- `removeKeys` removes owned descendants. Top-level `mode: "remove"` removes an
  exact managed root or page. Do not remove manual/unkeyed content, unmanaged
  resources, or surviving external consumers.
- `mode: "activate"` requires `page.id` or `page.pageKey`, even for a
  selection-only change. It changes editor context, not document state. An
  exact off-current-page write does not require activation.

Respect instance boundaries. Change an instance root or its authorized
component definition, never a definition-derived sublayer. Select only the
native references needed for the intended change.

## Recover locally

Read the entire mutation result. For a rejected payload, correct all reported
issues together without changing the design to fit the error. An execution failure
requires inspecting its reported outcome before retrying. TemPad attempts rollback
after a failed write. Only an explicit no-write outcome (`CANVAS_APPLY_ABORTED` or
`EXTENSION_DELIVERY_FAILED`) skips file readback. Other diagnostics can originate
inside a mutation, especially with older extensions. Follow the returned readback
requirement: rollback checks cover only part of native state.
Automatic Undo can be skipped when this attempt has no confirmed remaining change.
Do not suggest manual Undo in that case: it could remove an earlier successful edit.

A timeout, lost result, or unverified rollback leaves the canvas outcome uncertain.
Do not replay the write. Wait for a pending operation to settle; reload a stuck
runtime only when the tool calls for it. Then read the affected surviving node with
`get_structure` or `get_code`, carrying the current task and epoch. If the node was
removed, use `get_structure` with its exact page ID. An empty page snapshot counts;
empty selection, failed-node-only results, screenshots, and resource catalogs do not
satisfy readback. Inspect the returned state before deciding on a repair or retry.
If the failed request also changed local variables or styles, inspect those affected
resources with `get_design_system`; a canvas read alone does not verify their state.
If it cannot establish a safe next change, ask the user to inspect the canvas.

Readback is also required after task resume or reconnection. A file's unknown-write
requirement survives Hub restarts, Stop, and a fresh task; none of those replaces the
read. A notice that readback is still required means the last read did not establish
usable canvas state. Stop cancellation remains in force independently of readback.

Repair warnings where they occur. Replace a whole root only when an observed
structural defect requires it and the complete intended content can be
preserved. Reopen the affected composition after its last material write and
inspect its dependents; read back protected native facts when preservation
matters. Do not expand a local correction into an unrelated restyle.
