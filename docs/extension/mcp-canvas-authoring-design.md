# MCP canvas authoring

Status: implemented v1

## Decision

TemPad Dev exposes two canvas-authoring tools:

- `get_design_system` gives an external agent a compact set of real Figma components and variables.
- `apply_canvas` accepts one declarative desired result and applies it to the canvas.

The agent does not emit or call individual Figma Plugin API methods. It sends one result tree. The
trusted extension compares that tree with the live Figma nodes, skips unchanged values, and performs
the required Plugin API calls locally.

This keeps the public surface small:

```txt
project context + get_design_system
                  |
                  v
          one CanvasSpec result
                  |
                  v
live canvas -> reconcile -> validated Figma API calls -> live canvas
```

TemPad Dev is a connector and deterministic executor. It is not a second agent runtime, a planning
service, or a canvas operating system.

## Goals

- Create one native, editable Figma frame tree in one MCP call.
- Incrementally update an explicitly scoped existing subtree.
- Reuse existing components and bind existing variables by stable Figma identity.
- Preserve content the agent did not explicitly describe.
- Make a repeated identical result a no-op.
- Put safety, scope, and reversibility ahead of the absolute shortest API call sequence.
- Give the agent stable node IDs for later refinements.

## Non-goals for v1

- Deleting nodes.
- Creating or publishing variables, components, component sets, styles, or libraries.
- Detaching instances.
- Arbitrary JavaScript or raw Plugin API execution.
- File-wide synchronization or a persistent code-to-Figma database.
- Library-wide crawling.
- Native text, paint, effect, or grid styles.
- Inferring a project's design language from screenshots alone.
- Guaranteeing that a subjective design choice is good.

## Public tool 1: `get_design_system`

Input:

```ts
type GetDesignSystemInput = {
  query?: string
}
```

The optional query ranks results for a concrete task such as `settings form`, `primary button`, or
`数据表格`. Matching is Unicode-aware.

Output:

```ts
type GetDesignSystemResult = {
  page: {
    id: string
    name: string
  }
  components: Array<{
    id: string
    key: string
    name: string
    description?: string
    componentSetName?: string
    properties?: Record<
      string,
      {
        type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'SLOT' | 'TEXT' | 'VARIANT'
        defaultValue: string | boolean
        options?: string[]
      }
    >
    remote: boolean
  }>
  variables: Array<{
    id: string
    key: string
    name: string
    collectionName: string
    description?: string
    remote: boolean
    resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING'
    scopes?: string[]
  }>
  warnings?: string[]
}
```

### Discovery rules

Components include:

- local components on the current page
- main components of instances already used on the current page

Variables include:

- local variables in the current file
- remote variables currently bound to nodes on the current page

Remote collection names are resolved when Figma makes them available. Results are ranked
deterministically and capped at 40 components and 60 variables.

The tool deliberately does not scan every subscribed library. A known library key can still be used
by `apply_canvas`, which imports and validates it through Figma.

## Public tool 2: `apply_canvas`

Input:

```ts
type ApplyCanvasInput = {
  mode: 'create' | 'update'
  targetNodeId?: string
  root: CanvasNodeSpec
}
```

`CanvasNodeSpec` is a recursive result description:

```ts
type CanvasNodeSpec = {
  key: string
  nodeId?: string
  type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'INSTANCE'
  name?: string
  visible?: boolean
  position?: {
    x?: number
    y?: number
  }
  size?: {
    width?: number
    height?: number
    horizontal?: 'FILL' | 'FIXED' | 'HUG'
    vertical?: 'FILL' | 'FIXED' | 'HUG'
  }
  layout?: {
    mode?: 'HORIZONTAL' | 'NONE' | 'VERTICAL'
    gap?: number
    padding?:
      | number
      | {
          top?: number
          right?: number
          bottom?: number
          left?: number
        }
    primaryAlign?: 'CENTER' | 'MAX' | 'MIN' | 'SPACE_BETWEEN'
    counterAlign?: 'BASELINE' | 'CENTER' | 'MAX' | 'MIN'
  }
  appearance?: {
    fill?: `#${string}` | null
    stroke?: `#${string}` | null
    strokeWeight?: number
    cornerRadius?: number
    opacity?: number
  }
  text?: {
    characters?: string
    fontFamily?: string
    fontStyle?: string
    fontSize?: number
    lineHeight?: number
    letterSpacing?: number
    alignHorizontal?: 'CENTER' | 'JUSTIFIED' | 'LEFT' | 'RIGHT'
    alignVertical?: 'BOTTOM' | 'CENTER' | 'TOP'
  }
  component?: {
    id?: string
    key?: string
  }
  componentProperties?: Record<string, string | boolean>
  variables?: CanvasVariableBindings
  children?: CanvasNodeSpec[]
}
```

Design-system references require at least one real `id` or `key`. Component references are allowed
only on `INSTANCE` nodes. Text properties are allowed only on `TEXT`; layout and children are
allowed only on `FRAME`.

`CanvasVariableBindings` maps `fill`, `stroke`, `width`, `height`, `gap`, four padding fields,
`cornerRadius`, `opacity`, and the five font fields to the same `{ id?, key? }` reference shape.

### Create mode

- `root.type` must be `FRAME`.
- Existing `nodeId` values and `targetNodeId` are rejected.
- Figma creates one frame tree on the current page.
- If neither root coordinate is supplied, the root is centered in the current viewport.

### Update mode

- `targetNodeId` is required.
- The live target must have the same type as the desired root.
- Existing nodes may be matched by explicit `nodeId` or stable `key`.
- Every referenced existing node must be the target or its descendant.
- Omitted fields remain unchanged.
- Omitted children remain in Figma; v1 never deletes them.
- Supplied children are reconciled in their supplied order. A node is moved only when its current
  parent or index differs.

Output:

```ts
type ApplyCanvasResult = {
  rootNodeId: string
  nodeIdsByKey: Record<string, string>
  createdNodeIds: string[]
  updatedNodeIds: string[]
  mutationCount: number
  warnings?: string[]
}
```

The agent should retain `nodeIdsByKey` and reuse those IDs during later updates.

## Identity

Names are presentation, not identity. The reconciler never finds a target by node name.

Identity uses:

1. `nodeId` when the agent supplies one
2. otherwise the stable `key` stored as shared plugin data on generated or adopted nodes

Keys must be unique within a result. Node IDs must also be unique. If a key already identifies a
different live node, the write fails instead of guessing.

No identity database or background synchronization service is needed. Figma node IDs plus local
shared plugin data are enough for the first version.

## Reconciliation

The extension performs the diff against current live Figma state at call time:

1. Parse and validate the complete input.
2. Resolve the explicit update scope, if any.
3. Index stable keys inside that scope.
4. Walk the desired tree.
5. Reuse a matching live node or create the requested native node.
6. Move it only when its parent or supplied index differs.
7. Compare each supplied property and write only changed values.
8. Resolve components and variables by live ID or importable key.
9. Return stable identities and the actual mutation count.

Component and variable lookups are cached within the call. Repeated identical input against
unchanged live state produces zero mutations.

When both a literal field and a variable binding describe the same property, the variable binding
wins. The executor does not repeatedly overwrite a binding with its literal and then bind it again.

This is a safe-minimal patch, not a graph-search problem. The executor avoids unnecessary writes,
but it will not trade away validation, scope checks, deterministic ordering, or rollback just to
reduce the API-call count.

## Safety floor

### Explicit write capability

Canvas writes have a separate session-only toggle under Agent integration. It defaults to disabled
and is reset when MCP access is disabled or unavailable. Read tools remain usable without enabling
writes.

### Editor and schema checks

- Authoring runs only in Figma Design files.
- One result contains at most 100 nodes.
- A result is at most 12 levels deep.
- Colors use `#RRGGBB` or `#RRGGBBAA`.
- Unknown input fields are rejected.
- Only the six supported native node types can be authored.

### Scope and concurrency

- Update mode requires one explicit root.
- Existing targets outside that root are rejected.
- Only one `apply_canvas` call runs at a time in the active extension instance.
- No delete operation exists.

### References and fallback

- Missing components, variables, fonts, or component properties fail the call.
- The executor does not redraw a missing component from primitives.
- It does not replace a failed variable binding with a literal.
- Mixed-font text is preserved when font fields are omitted. Replacing mixed fonts requires both
  `fontFamily` and `fontStyle`.

### Undo and failure behavior

The extension starts a Figma undo boundary before mutation and commits one boundary after success.
If an operation fails, it triggers Figma Undo before returning the error. If automatic rollback is
not available, the error says so and directs recovery through Figma Undo.

The actual editor mutation remains the final edit-permission check: a read-only or otherwise
unsupported Figma context rejects the write and returns a coded failure.

## Agent workflow

The intended flow is short:

```txt
1. Read the repository's design-system rules and nearby implementation.
2. Call get_design_system with the concrete task.
3. Prefer returned components and semantic variables.
4. Send one apply_canvas result.
5. Inspect the result with get_code or get_structure when useful.
6. Send one updated result only if refinement is needed.
```

Repository evidence supplies high-level principles. Figma supplies native identities and live canvas
state. TemPad Dev should not invent a design language when neither source provides one.

## Implementation map

- Shared contracts and coded errors: `packages/shared/src/mcp/`
- MCP tool definitions and agent instructions: `packages/mcp-server/src/`
- Runtime routing: `packages/extension/mcp/runtime.ts`
- Design-system discovery: `packages/extension/mcp/tools/design-system.ts`
- Canvas reconciliation: `packages/extension/mcp/tools/canvas.ts`
- Session write toggle: `packages/extension/components/sections/AgentIntegrationSection.vue`

Both authoring tools are in the extension's node-coverage scope, with behavioral tests for their
contracts, reconciliation, and safety boundaries.

Do not add more tools merely because the Plugin API has more methods. Extend this surface only when a
real authoring task cannot be expressed safely. Prefer extending the same discovery-and-apply model
unless the workflow is genuinely different.
