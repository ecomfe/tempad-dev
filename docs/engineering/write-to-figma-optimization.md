# Write-to-Figma structural optimization

Status: global-to-detail review and accepted behavior-preserving changes verified, 2026-09-17.

## Scope and baseline

This pass covers `feat/write-to-figma` against its merge base with `origin/main`
(`29f1789fe7ec57e4492395028447a743ca087d6f`), applied to the current checkout at
`a71381c3c3e44bc1c116053041d201c5bd4b2023`. The earlier branch pass reviewed the
complete changed-file inventory and made local simplifications in ten source files.
Those edits and the fifteen existing release/documentation changes are retained.
This report addresses responsibility boundaries and repeated execution policy beyond
that first pass; file counts alone do not establish optimization completeness.

The task is behavior-preserving simplification. No public API, wire format, native
host protocol, connection setup, cancellation policy, resource deletion policy, or
visual authoring behavior is being redesigned. No dependency or commit is required.

## Global-to-detail progression

The review follows architecture and execution paths, then module internals and
implementation details. Finishing a selected batch is not the completion criterion;
each domain needs an implementation decision and evidence for retained boundaries.

| Stage                         | Required analysis and output                                                                                                                                                                                                   | Current status                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1. Global ownership and flows | Map entry points, source ownership, dependency direction, state lifetimes, and the complete request/feedback/asset paths. Identify authority duplicated across layers versus independent enforcement.                          | Complete; ownership map below                       |
| 2. Cross-module consolidation | Review task/operation lifecycle, request routing, resource discovery/resolution and Canvas normalization boundaries with all consumers. Record each supported consolidation and why retained boundaries differ.                | Complete; consolidation decisions below             |
| 3. Module internals           | Walk the implementation of each affected domain: persistent state, transitions, async ordering, caches, error paths, tree traversal, normalization, mutation and verification. Remove redundant concepts and unnecessary work. | Complete; internal review below                     |
| 4. Implementation details     | Review internal APIs and callers, duplicate expressions/tables, stale compatibility paths, naming and test organization. Migrate callers instead of retaining unnecessary internal shims.                                      | Complete; callers and coverage inventories migrated |
| 5. Integrated verification    | Review the complete accumulated change against the original branch objective, run required checks and account for every identified optimization or justified retention.                                                        | Complete                                            |

Each stage must produce evidence for the next. A list of filenames, a passing test
suite, or splitting a large file is not by itself evidence that a domain has been
fully simplified. Existing behavior remains the baseline; unresolved correctness
questions are recorded separately from behavior-preserving refactors.

## Stage 1: authority and execution map

### Tool execution

`cli.ts` connects the MCP transport to `hub.ts`. `AgentClients.owner` derives the
conversation owner from request metadata; `resolveDesignTarget` selects the exact
extension/session; `DesignTasks` checks the epoch, file lease and operation slot.
The broker (`service-worker.ts`) verifies the gateway and registered page route;
`bridge/content.ts` carries the request into `composables/mcp.ts`;
`PageDesignTasks.enter` enforces the final local fence before `runtime.ts` invokes
the tool. The response traverses those same registered channels, and
`extension-socket.ts` settles the matching request and operation.

These are three different responsibilities: Hub authority, registered transport
routing, and final execution authorization. They cannot be collapsed into one
shared mutable state machine. In particular, a missing socket does not establish
that the page finished its native transaction.

### Canvas and read pipelines

Canvas follows public-schema validation → catalog/native reference resolution →
local theme preparation → markup compilation or native-only input preparation →
scoped native preflight → mutation → structural verification within an undo
boundary. The two input forms ultimately produce `CanvasNodeSpec`, but currently
retain separate normalization paths in `markup.ts` and `reconcile.ts`: their
defaulting and preservation rules differ, as established in stage 2.

Reading follows exact-node/page selection → visible-tree snapshot and budget
preflight → variables/plugin/asset planning → collection → style preparation →
rendering → token processing and optional resolved rerender → bounded result.
The read path permits factual fallback and partial output where authoring must
reject an unresolved reference. Shared value helpers are appropriate only where
both consumers have the same failure and mode-selection rules.

### Feedback and persistence

UI edits become broker drafts keyed by file, conversation and task. Submission
persists the delivery identity before the Hub adapter is invoked. `AgentClients`
checks task ownership/epoch; `CodexAppFeedback` serializes one conversation, records
a durable receipt, and delegates native queue or active-turn delivery. Broker
settlement clears only unchanged content from the matching draft round. Done
persists a closed-review fence with draft clearing; Stop independently fences
execution and removes pending delivery.

Draft snapshots, Hub receipts and native composer entries are different records:
unsent editable intent, delivery uncertainty, and host-owned scheduled work. A
single generic persistence abstraction would erase meaningful boundaries.

### State ownership and lifetime

| State                                   | Authority and lifetime                                                                   | Decision                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active extension and browser session    | Transport registry / broker; connection lifetime                                         | Defaults for taskless selection, never replacements for a bound task target.                                                                                   |
| Current task ID per file                | `DesignTasks.currentTaskIds`; persisted across restarts                                  | Already identifies the only task allowed to acquire or recover an active lease; occupancy now uses this authority instead of searching all historical records. |
| Historical tasks and Stop fences        | `DesignTasks.records`; durable review history                                            | Keep history for recovery, idempotent begin and taskless-write cancellation fences; do not use it as a second current-owner index.                             |
| Pending native operations               | `DesignTasks.operations`; live until definitive settlement or proven runtime replacement | Independent of task status and socket presence. Keep uncertainty tracking.                                                                                     |
| Page busy/revoked/stopped state         | `PageDesignTasks`; local runtime plus Stop persistence                                   | Final fence for a stale in-flight route; cannot be derived from the Hub snapshot.                                                                              |
| Review snapshots and UI projection      | Broker durable review + tab snapshot + displayed/dismissed controls                      | None grants a lease. Review persistence is separate from acknowledgement and anchor restoration.                                                               |
| Draft round and submission receipt      | `FeedbackDraftStore`; durable across page and worker replacement                         | Clear/Done now share the same atomic round-advance write; Done retains its closed-review fence.                                                                |
| Native receipt / per-conversation queue | `CodexAppFeedback`; durable receipt, process-local serial tail                           | One scheduler owns serialization; durable receipt states and tombstones remain necessary for uncertain writes.                                                 |
| Canvas resources and fonts              | One apply, with a separate bounded cross-call image cache                                | Keep strict resource identities; share node classification and preparation without changing mutation counting.                                                 |
| Code generation caches                  | One `handleGetCode` execution and its rerenders                                          | Removed the forwarding cache and redundant pipeline fields; language detection and shell collection remain explicit.                                           |

## Stage 2: cross-module decisions

| Domain and source evidence                                                                                           | Implemented consolidation                                                                                                                                                                       | Boundary retained after comparison                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task authority: `DesignTasks.begin`, `resume`, `recoverSessions`, `restore`, `restoreReview` and Hub binding callers | **G1:** occupancy derives from `currentTaskIds`; remove the redundant occupant check and repeated current-ID assignment after the resume guard.                                                 | History remains necessary for retry identity, reviews and cancelled taskless-write fences. `operations`, `ready` and `ending` represent dispatch uncertainty, page binding and deferred settlement, not duplicate task status. |
| Canvas model: `model.ts`, `markup.ts` node inference, `reconcile.ts` supported-node checks and update hints          | **G2:** one node classification owns shape, preserved and supported types. Infer supported/preserved unions from the same lists; share frame/intrinsic predicates.                              | Keep wrappers that narrow a live Figma node object separately from predicates over a type string. Do not broaden the supported native-node set.                                                                                |
| Canvas preparation: `prepareCanvasTheme`, `parseCanvasMarkup`, `applyResolvedCanvas`                                 | **G3:** carry the already parsed HTML tree from asynchronous theme hydration into compilation. Attach theme-bound fields while compiling each node instead of walking the completed tree again. | Hydration precedes live update hints; class normalization remains after those hints, with the same diagnostic boundary. Catalog normalization, static legality and asset validation retain their own ordering.                 |
| Broker persistence: `FeedbackDraftStore.request/closeReview`, `DesignReviews.save/close`                             | **G4:** one draft-round advance commits the empty snapshot and receipt fence; one review commit persists before publishing memory.                                                              | Done supplies its additional closed-review state to the same atomic storage write. Restore retains its existing initialization/failure semantics. Draft and review stores remain separate owners.                              |
| Code pipeline: `handleGetCode`, `finalizeRenderedOutput`, `rerenderResolvedOutput`, render/plugin consumers          | **G5:** remove duplicate node map/config/plugin fields from pipeline input; use the render context. Delete the context copier and explicitly reset language detection on a resolved rerender.   | Root-only shell collection and full collection differ. Token resolution must use the selected collected subset; render context still carries SVG and plugin facts. Preserve the first render's output language.                |
| Token cache: all imports under `code/tokens` and `token`, barrel tests and coverage inventory                        | **G6:** migrate to the existing shared token cache, remove the forwarding file/export and duplicate cache suite.                                                                                | Keep cache miss, cached-null and API-call assertions in the owning `token/cache` suite. UI codegen output remains distinct from MCP token IR.                                                                                  |
| Evaluation: rollout, identity and skill-catalog inspectors                                                           | **G7:** one JSONL reader retains parsed values and malformed-line evidence; authoring inspection and identity checks reuse that parse.                                                          | Identity treats malformed rows as invalid evidence; catalog extraction skips them. Preserve line numbers and issue order. The strict durable run-log parser remains separate.                                                  |

### What cannot be merged by shape alone

Structural markup and native-only updates both produce `CanvasNodeSpec`, but their
omission rules differ. Structural stroke/corner normalization fills missing sides
from uniform values and class/variable fallbacks. Native-only normalization leaves
unspecified fields absent to preserve live state. A single helper with mode flags
would hide this distinction. Shared node classification and prepared-tree reuse
remove actual duplication without introducing that policy switch.

Styles and variables also have distinct lifecycles. Style resolution caches direct
IDs/import keys and relies on native style-consumer queries for removal. Variable
resolution additionally owns collections, inherited modes, overrides and aliases;
removal must inspect pages, physical instance descendants, rich text, styles,
shaders, aliases and extended collections. Their similarly named local-index and
cache methods do not justify a generic resource store. Their common ordered phases
are shared at reconciliation's existing transaction boundary (initial item D).

## Stage 3: internal review

The internal review follows the same domains rather than treating large files as
opaque or exempt from simplification.

| Implementation area                            | Reviewed mechanism and disposition                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub/CLI and request transport                  | Request IDs, extension ownership, mutation timeout, disconnect and shutdown are separate outcomes. Initial F shares response lookup/timer cleanup; definitive operation settlement remains explicit. Hub process locking/stdio shutdown is retained: moving module state into a class would require a new process lifecycle API without eliminating a duplicated policy.                    |
| Task state and page fence                      | Only guarded begin/resume/recovery paths activate a task. Restore deactivates leases; an uncertain operation outlives socket loss. G1 removes the competing historical scan while preserving restart, Stop, same-file and epoch guards.                                                                                                                                                     |
| Native host delivery                           | Per-conversation tails, admission caps, durable pending/delivered receipts, cancellation tombstones and owner reload were compared. Initial E shares scheduling. Receipt rereads after pending deliveries are necessary: taking one earlier snapshot would miss a delivery that commits while cancellation waits. Canonical and legacy native histories remain active compatibility inputs. |
| Browser routing and feedback UI                | Registered page/document/session identities, broker serialization, draft rounds, review closure and UI projections have different lifetimes. G4 consolidates writes without moving authority into UI state. Failed persistence does not publish a successful save/Done fence.                                                                                                               |
| Catalog and reference resolution               | Catalog refs, component tags, CSS aliases and current-file native identities are separate namespaces. Existing bounded catalog LRU and conflict-safe alias generation remain. Deep native resolution preserves depth caps, own-property lookup and diagnostics; read fallback must not replace strict authoring resolution.                                                                 |
| Markup compilation and native-only preparation | Compare node inference, size defaults, strokes/corners, grids, text and instance preservation. G2 removes duplicate type tables/casts. G3 removes a second HTML parse and a post-compilation annotation walk. Static legality and resource-reference validation remain separate because they inspect different representations.                                                             |
| Reconciliation mutation and verification       | Inspect identity/adoption, protected nodes, preflight, creation, setters, deferred node-key references, manual/flow grid finalization, removal and undo. These passes run against different live states; combining them would change mutation and diagnostic order. Apply and verify intentionally share comparison helpers while retaining independent setter and assertion paths.         |
| Fonts, media and resource removal              | Initial B/C give caches narrow owners. Pending font promises, exact/portable face selection, bounded image reuse and ordered video imports remain. Collection removal orders descendants before parents and checks all retained consumers; repeated live checks cannot be replaced by the initial read snapshot.                                                                            |
| Read/codegen and plugin sandbox                | G5 removes redundant pipeline state and the field-copy adapter. Preserve early-shell budget preflight, per-request read caches, source-ordered bounded asset export, plugin batches and per-node token mode resolution. Worker isolation and timeout/recovery behavior remain unchanged.                                                                                                    |
| Evaluation and plugin generation               | G7 shares parsing while preserving evidence policy. Host message envelopes, timestamps and prompt validation remain distinct consumers. Release manifests and native packages continue to derive from their existing tracked source; no generator-input change is needed.                                                                                                                   |

No universal tree walker, transition engine, property-setter registry or generic
persistence framework was introduced. These would require policy flags for actual
semantic differences and increase the number of concepts needed to reason about a
write. The accepted changes remove duplicated authority, state, parsing or commits.

## Stage 4: details and caller migration

- `CanvasNodeTypeHints` now benefits from actual type predicates, replacing casts
  around repeated supported/preserved sets. The shape members remain identical.
- `PreparedCanvasTheme` carries the parsed tree and hydrated resources together.
  Direct synchronous markup compilation remains available for local inputs; the
  production asynchronous path reuses its preparation result. Theme normalization
  does not mutate the prepared tree or caller's bindings.
- `CompileState` is constructed at the compile boundary. Theme field annotations
  are attached after each node's children and validation, preserving the final
  property representation while eliminating the annotation-only traversal.
- Pipeline configuration, plugin code and node lookups now have one source. The
  resolved render explicitly clears `detectedLang`; it still uses the first render's
  selected language for serialization and the result.
- All three cache consumers and their mocks import `token/cache` directly. Four
  duplicate forwarding-cache cases are removed; the owner's three cases retain all
  behaviors and additionally assert Figma call counts. The removed barrel assertion
  only checked the deleted internal export.
- Rollout parsing preserves blank-line offsets, scalar/null rows and malformed-row
  evidence. Identity consumes parsed entries; all internal callers and tests are
  migrated without a second string/parsed compatibility path.
- Coverage inventories follow the code: remove the deleted forwarding cache and add
  the extracted rollout parser. Canvas model helpers are covered by the existing
  Canvas wildcard. Thresholds remain unchanged.

## Initial structural review (completed batch only)

| Layer                                    | Existing responsibility                                                       | Finding and decision                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts                         | Tool inputs/results, native Canvas declarations, browser protocol             | `mcp/tools.ts` contains 2,546 lines; the contiguous Canvas contract accounts for over 2,000. Separate that contract while preserving existing exports and schema objects (A).                                           |
| Server routing and pending calls         | Tool metadata, extension ownership, request settlement                        | Hub registration and extension dispatch have different consumers and must stay separate. Resolve/reject in `request.ts` repeat the same ownership/timer/map policy; consolidate that exact policy (F).                  |
| Host integration                         | Conversation binding, lifecycle projection, native feedback, durable receipts | Admission and cancellation independently maintain the same per-conversation promise chain in `codex-feedback.ts`. Centralize scheduling (E), while retaining receipt fencing and host-specific delivery.                |
| Browser gateway and review UI            | Session selection, permissions, feedback drafts and task controls             | Existing bridge/broker separation and broker serial queue already provide appropriate boundaries. Do not unify them with Node host delivery: persistence, cancellation and concurrency limits differ.                   |
| Canvas resolution                        | Catalog aliases, local identities, type checks, preflight                     | Styles and variables look similar but differ in error categories, lazy initialization, imported-key caching, and extended collection semantics. Keep distinct resolvers; a generic registry would hide these contracts. |
| Canvas mutation                          | Reconciliation, loading, mutation bookkeeping, verification, undo             | The 7,407-line reconciler owns unrelated font and media caches. Extract each with a narrow state contract (B/C), then consolidate exact common resource phases in structural and native-only writes (D).                |
| Read/code generation                     | Semantic snapshots, token extraction/resolution, output budgets               | Token value/mode utilities already share common rules. Read fallback semantics differ from strict authoring resolution. Retain separate read/write pipelines and UI/MCP codegen boundaries.                             |
| Skills, plugin generation and evaluation | Portable release source, derived native packages, runtime evidence            | Preserve generator ownership, progressive skill references, and runtime identity checks. No generator input changes are justified by this refactor.                                                                     |

The main improvement is fewer places to understand and modify a policy. Extracting
files without narrowing dependencies would only move complexity. Conversely,
combining operations with different error, lifetime, or ordering semantics would
make the code shorter while weakening the design.

## Completed initial work

### A. Separate the Canvas contract from general tool contracts

Current evidence: `packages/shared/src/mcp/tools.ts` places `CanvasDesignReference`
through `ApplyCanvasResult` between design-system and asset tools. Structure results
also refer to Canvas types, and structure parameters use `CanvasStableKeySchema`.
The Canvas block depends on shared constants and task schemas, not general tool
registration.

Move the Canvas declarations and stable-key schema into `mcp/canvas.ts`. General
tools import their needed Canvas types/schema and re-export the module, preserving
both package exports and existing direct `tools` imports. Avoid a reverse import
from Canvas into tools. Do not rewrite refinements, defaults, limits, descriptions,
or validation order. Add the new module to package and root coverage inventories.

Verification: shared contract tests and strict shared coverage, downstream typecheck,
server formatter tests, and extension parser/reconciler tests. This is structural
separation, not a schema migration.

### B. Give font resolution and loading its own state

Current evidence: `loadFont`, `loadFonts`, `resolveFamilyFont`, and
`resolvePortableFont` use only `fontLoads` and `availableFonts` from the broad
`ApplyState`. They serve resource preflight, text styles, whole-node text and ranges.

Move these operations, face matching, and current-text font inspection to
`canvas/fonts.ts`. Give each apply one `CanvasFontState`; callers pass that state
rather than mutation/ownership state. Preserve pending-promise deduplication,
failed-load caching, font listing laziness, candidate order, tie-breaking, exact
family matching, and the single Figma readiness retry. Keep consumer-mode variable
resolution in reconciliation, where it depends on live nodes.

Verification: existing portable/exact-font, text range, variable-font, missing-face,
and transient-readiness regressions through `applyCanvas`.

### C. Give media import its own state and bounded cache

Current evidence: image URL, asset and video loading use assets, URL inventories and
hash maps, but no node ownership or mutation bookkeeping. The cross-call image
cache validates a Figma hash before reuse and evicts at 256 entries.

Move import policy to `canvas/media.ts` with one per-apply media state. Keep the
cross-call cache module-local. Expose one import operation with the current order:
URL images, supplied image bytes, then video URLs. Preserve fetch credentials,
timeout, bounded streaming, error codes/messages, first-usage reporting and cache
invalidation. SVG placement and ownership remain in the reconciler; source SVG
resolution remains in `assets.ts`.

Verification: existing URL import deduplication, content-addressed image reuse,
first-usage error, streamed/declared video limits and import-failure rollback tests.

### D. Share the resource phases of structural and native-only updates

Current evidence: both final orchestration paths repeat variable reconciliation,
style preparation/preflight, media import, style application, resource removal,
and the same ordered layout-warning families. They differ in scope validation,
page modes, topology, removal, and verification traversal.

Extract only identical ordered phases and layout-warning collection. Keep their
call positions and asynchronous boundaries explicit in both paths. Do not combine
the two operation handlers or introduce a configurable transaction framework.
Resource definition/preflight still precedes node changes; deferred node-key links
still follow node creation; removals still precede final verification.

Verification: existing native-only and structural resource tests, idempotent updates,
warning assertions, resource-consumer removal rejection, and rollback tests.

### E. Centralize native per-conversation scheduling

Current evidence: `CodexAppFeedback.enqueue` and `cancelQueued` independently read a
promise tail, ignore an earlier rejection, append work, register the new tail, and
delete it only if it is still the latest. The conditional deletion prevents an old
operation from erasing newer pending work.

Use one private scheduler for both callers. Keep enqueue admission limits and Steer
rejection at their current call site. Keep cancellation's immediate task fence and
its wait for current delivery before receipt discovery. Do not merge queue and steer
payloads, receipt states, uncertain-write handling, or lifecycle subscriptions.

Verification: existing native feedback tests plus a focused ordering regression if
current tests do not cover removal followed by a later submission to that same
conversation. Test error recovery and independence across conversations through
public behavior, not private promise maps.

### F. Unify pending-result ownership checks

Current evidence: `request.resolve` and `request.reject` duplicate pending lookup,
wrong-extension rejection, timer cleanup and result-specific logging. Shutdown and
disconnect have different iteration and error creation behavior.

Share response lookup/ownership validation and settlement cleanup without changing
public functions or warning text. Preserve timeout behavior, including the
warning-only timeout for mutations that require a definitive result. Keep shutdown
and disconnect loops explicit rather than folding every exit into a generic event
state machine.

Verification: existing request tests for wrong sender, unknown/late response,
normal success/failure, warning-only timeout, disconnect, and shutdown.

## Constraints to preserve during deeper review

- `withUndoBoundary` remains the sole native transaction wrapper. It has already
  consolidated rollback; page-removal context restoration is an additional duty,
  not a duplicate generic transaction.
- Variable async preflight and synchronous application remain separate. Application
  must use preflighted resources; an async resolver or generic recursive evaluator
  would obscure when native reads/imports are allowed.
- Authored node keys, style keys and variable keys retain their current scope and
  diagnostics. Similar map operations do not establish equivalent semantics.
- Canvas traversal distinguishes physical descendants, authoring boundaries and
  instance protection. A universal walker would require hidden policy switches.
- Native canonical and legacy turn-history projections remain supported because
  actual host snapshots/patches use both. Their names alone are not evidence of
  obsolete migration code.
- Queue receipts and cancellation tombstones remain durable. In-memory deduplication
  cannot prove whether an uncertain native write committed after disconnect.
- Component properties, layout/grid finalization, native setters and verification
  stay together for this pass. They share live topology and mutation tracking;
  splitting them requires a larger domain API, not merely moving functions.
- Existing large behavioral suites remain intact. Mechanical test splitting would
  add fixture boundaries without removing duplicated assertions; no assertions are
  weakened or removed to make refactoring pass.

## Initial batch results

The six initial items are implemented and verified. Their completion does not
establish completion of the requested global-to-detail review. The constraints
above preserve behavior; they do not exempt the surrounding modules from deeper
analysis or implementation-level simplification.

| Item | Completed implementation                                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | [Canvas contracts](../../packages/shared/src/mcp/canvas.ts) now own the authoring dialect. General [tool contracts](../../packages/shared/src/mcp/tools.ts) shrink from 2,546 to 489 lines and retain all 122 named exports through re-export. Schema declarations and stable-key validation match the preserved baseline exactly. |
| B    | [Canvas fonts](../../packages/extension/mcp/tools/canvas/fonts.ts) own font listing/loading state. Extracted function bodies are unchanged apart from exports and the narrowed state type.                                                                                                                                         |
| C    | [Canvas media](../../packages/extension/mcp/tools/canvas/media.ts) own image/video import state and the existing bounded image cache. Extracted import bodies retain their original logic.                                                                                                                                         |
| D    | [Reconciliation](../../packages/extension/mcp/tools/canvas/reconcile.ts) shares resource preparation, application, removal and ordered layout-warning collection across both write paths. Its top-level state now delegates fonts and media to their respective state objects.                                                     |
| E    | [Native feedback](../../packages/mcp-server/src/agent-clients/codex-feedback.ts) uses one scheduler for delivery and removal. Two added cancellation-order regressions passed before and after refactoring.                                                                                                                        |
| F    | [Pending requests](../../packages/mcp-server/src/request.ts) share response ownership checks, diagnostics and timer cleanup; success/error settlement and shutdown semantics remain explicit.                                                                                                                                      |

The incremental change touches 13 files, including this report, coverage configuration
and tests. The 23 previously modified files outside the two overlapping source
files remain byte-for-byte unchanged. The earlier edits in those two overlapping
files were retained in the extracted code or reconciliation logic. No commits were
created, and no generated plugin source was edited.

Validation completed:

- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm test:run`: 2,134 tests passed, including extension/site browser tests;
  Worker and release-plugin Chromium sandbox probes passed.
- `pnpm test:coverage`: passed; statements 92.60%, branches 87.52%, functions
  95.52%, lines 94.04%. Coverage inventories include the moved Canvas contract.
- `pnpm -C packages/shared test:coverage`: 230 tests passed; all four coverage
  dimensions are 100%. Thirty added cases protect operation-scope diagnostics,
  resource bounds, result identities, grid bindings and vector-loop edge cases.
- `pnpm -C packages/shared build` and `pnpm build:ext`: passed.
- The 252-test Canvas suite passed after each Canvas batch. The focused server
  batch passed all 74 tests. Formatting and `git diff --check` passed.

Live Figma authoring was not run: these are deterministic refactors. This result
makes no new host-compatibility or visual-quality claim.

## Stage 5: integrated result

The original branch inventory review, the initial structural batch and this
follow-through cover the domain map above. All accepted items A–F and G1–G7 are
implemented. Retained implementations are accounted for by their ownership,
defaulting, error, lifetime or ordering semantics; they are not excluded solely
because a file is large or an existing test passes.

The follow-through changes 26 paths: 18 implementation files (including one removed
forwarder and one new parser), six test files, the coverage inventory and this report.
Of the 36 paths modified before this follow-through, 33 remain byte-for-byte
unchanged. Only this report, the markup compiler and reconciler overlap; their earlier
changes remain present. Existing release documentation and generated plugin files
were preserved. No commits were created.

Final verification:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed after correcting import order in the migrated cache consumers.
- `pnpm test:run`: 2,130 tests passed: extension 1,614, MCP server 272, shared 230,
  plugins 6 and site 8. Browser tests and Worker/release-plugin sandbox checks passed.
- `pnpm test:coverage`: passed, with unchanged thresholds. Statements 92.61%,
  branches 87.53%, functions 95.53%, lines 94.04%.
- `pnpm build:ext`: passed, including rewrite and README generation.
- Focused verification passed during the work: task authority/recovery/client tests
  67; Canvas parsing/theme/resolution/reconciliation tests 514; broker tests 76;
  code/token tests 258; script/evaluation tests 84.
- Formatting, complete incremental-diff review, removed-API caller searches and
  `git diff --check`: passed.

The four-test difference from the initial batch is the removed forwarding-cache
suite. Its distinct behaviors remain covered in the owning cache suite; no expected
behavior or coverage threshold was relaxed. No live Figma run was required for these
deterministic refactors, so this report makes no new visual or host-support claim.
