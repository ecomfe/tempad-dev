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
issues together without changing the design to fit the error. A verification
failure is rolled back by TemPad; do not assume a partial successful edit.
For an unknown transport outcome, read the exact target before retrying a create
or removal so an uncertain response does not become a duplicate mutation.

Repair warnings where they occur. Replace a whole root only when an observed
structural defect requires it and the complete intended content can be
preserved. Reopen the affected composition after its last material write and
inspect its dependents; read back protected native facts when preservation
matters. Do not expand a local correction into an unrelated restyle.
