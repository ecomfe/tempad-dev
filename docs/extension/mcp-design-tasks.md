# Design tasks, client integration, and feedback

Product terminology follows [Design comments](../product-description.md#design-comments).
A design task binds one agent conversation to an exact Figma file and runtime. A
turn ending pauses work; it does not complete the requested design or close its review.

## Ownership

| Layer                                                  | Responsibility                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/shared/src/mcp/design-task.ts`               | Task, epoch, client, action, and draft contracts                |
| `packages/mcp-server/src/design-tasks.ts`              | File leases, routing, operation draining, recovery, and results |
| `packages/mcp-server/src/agent-clients/`               | Host identity, native lifecycle, capabilities, and delivery     |
| `packages/extension/mcp/design-task.ts`                | Final page execution fence and native anchor                    |
| `packages/extension/composables/mcp.ts`                | Tab state, restoration, and actions                             |
| `packages/extension/components/DesignTaskStatus.vue`   | Task status and anchored controls                               |
| `packages/extension/components/DesignTaskFeedback.vue` | Comment editing and submission                                  |
| `packages/extension/mcp/broker/`                       | Registered page routing and durable drafts/reviews              |
| `agent-plugins/tempad-dev/clients/`                    | Installed Claude lifecycle hooks and hook transport             |

The Hub owns task records; the page enforces the last write fence. The latest task
owns a file's displayed state. An older task's update cannot replace its controls,
reset its editor, or regain ownership after a newer task releases the file.

Runtime metadata establishes conversation identity. Codex supplies thread/turn IDs
per request; the CLI handshake describes its own process, independently of the
process that started the shared Hub. Claude's exact `claude-code` client identity
and installed hooks identify Claude. Task titles, display names, and focused windows
never determine routing. Without a conversation identity, ownership stays with the
MCP transport. Reconnection can reclaim an inactive task only for its exact conversation.

`AGENT_CLIENTS` distinguishes integration support from live capabilities. Codex App and
host-reported Codex conversations retain comments and drafts while native delivery is
unavailable. Claude, Codex CLI, and other clients get status, Locate, and Stop/Done,
without mounting feedback UI or loading or deleting previously saved drafts.
The persisted `unknown` kind behaves like `other`. Old `continue` submissions remain
readable to preserve drafts; current delivery uses Queue or Steer.

## Task lifecycle

- Badge activation chooses the default Figma session. `list_design_sessions` exposes
  exact choices; `begin_design({ title, requestId, sessionId? })` reserves the file
  and requires its page to acknowledge the session, file, page, and epoch. Reuse a
  request ID only for the same begin request.
- Carry `taskId` and the returned lease epoch as `taskEpoch` on task work. Hub,
  broker, and page verify the route. Exact node/page operations can address another
  page in the file; implicit operations reject a changed current page. Explicit
  activation updates the task's page context.
- Only task work renews the five-minute idle lease. Pings, status reads, capability
  checks, and UI activity do not. `get_design_task` supplies recovery state without
  renewing ownership.
- `resume_design({ taskId, epoch })` resumes a paused, expired, interrupted, or
  completed task only while it is the current task and its review is open. It
  repeats the page acknowledgement, increments the epoch, and requires a successful
  `get_structure` or `get_code` read before writing. Preserve the anchor and page
  binding; reconstruct changes from current native state instead of replaying writes.
- `end_design({ taskId, taskEpoch?, outcome, summary? })` completes or abandons the
  design pass. Completion waits for the current operation, releases ownership, and
  leaves the same review open for comments. It does not act as the user's Done.
- Figma **Stop** immediately fences subsequent page operations and cancels pending
  feedback. A running transaction drains consistently through `stopping`, then the
  task becomes permanently `cancelled`. A delayed lifecycle event, reconnect,
  higher epoch, or taskless write cannot revive it. Applied changes remain.
- **Done** closes the review, persists its closure, and clears this round's saved
  comments and unsaved buffers before dismissing controls. It waits for pending
  storage/delivery work; a failed clear remains retryable. Neither elapsed time,
  refresh, disconnection, nor viewing the result counts as Done.

Respect Stop without automatically replacing its task. Further requested or necessary
work may explicitly begin a fresh task after the running operation drains; no separate
Figma unlock or additional user turn is required. Another task can acquire a file after
idle expiry, leaving the previous task permanently superseded.

The Hub serializes operations per file across connected tabs. Independent reads can
run between operations; taskless writes still obey file occupancy and Stop fences.
A timeout or lost socket is not proof that native execution stopped. Occupancy remains
until the exact page reports idle, a fresh tab inventory proves closure, or a changed
document ID proves reload. Missing registry entries alone are insufficient. Disabling
integration during execution keeps its result channel open until settlement. A stuck
runtime may require reloading that executing tab. This coordinates the Hub's sessions,
not human editing, other devices, or unrelated services.

## Persistence and recovery

The Hub atomically stores task identity, current-file ownership, results, and Stop/Done
fences under `~/.tempad-dev/state/`. Reviews have no idle eviction. On restart it restores
metadata with fresh epochs and inactive leases; it never restores transport authority,
running operations, or advertised capabilities. The exact conversation must reconnect,
resume explicitly, and reread before writing.

The original browser tab can recover its current task when browser identity, extension
origin, tab ID, and file match, the old session is absent, and a new document ID proves
replacement. An interrupted task receives a fresh epoch and acknowledgement; paused,
expired, and completed tasks retain their status. No alternative tab is selected by
elimination. A live original session wins over a copied or stale tab snapshot.

The tab keeps its task, acknowledged IDs, anchor, and toolbar offset in session storage.
An unacknowledged snapshot restores controls but never authorizes execution. Running
snapshots appear interrupted until confirmed by the Hub. Wrong-file, malformed, missing,
or unavailable storage cannot attach unrelated state. The page includes its saved review
in its enable handshake; the broker retains the latest review per file and synchronizes
matching claims through session inventory. A saved tab may recover a missing review with
an inactive lease only if no newer task owns the file.

Done persists a closure fence before clearing drafts. It propagates through reconnects
and worker restarts, and notifies other tabs locally even without a Hub. Late messages,
autosaves, and delivery receipts cannot reopen or clear a later round. Stop preserves
drafts; cancelled controls dismiss after pending work and local saves settle. This is
local persistence, not cross-device history.

## Host integration

Normal setup is the browser extension plus the agent host plugin and its trust prompts.
The runtime owns discovery, conversation binding, and reconnection. Manual control URLs,
environment edits, helper processes, and agent-driven connection setup do not establish
host support. Protocol tests verify mechanics; live claims require the installed plugin
against the actual host.

`pnpm agent-plugin:dev` produces native release and development packages from the portable
source. These omit the root portable manifests and use each host's native marketplace
layout. Codex registers no hooks. Claude retains its lifecycle hook definitions.

### Claude lifecycle hooks

The hook client connects only to the existing TemPad Hub. Its versioned private requests
carry host session/turn identity and, after successful begin/resume, task identity.
Subagent events are excluded. Events are `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Stop`, and `SessionEnd`.

Hooks carry lifecycle identity and one-time Figma Stop notices only. They never carry
comments, advertise feedback capabilities, block turn completion to deliver a review,
or acknowledge comment delivery. Updated plugin clients suppress comment batches offered by
older Hubs instead of emitting their context.

Host Stop and SessionEnd pause the matching design task. Turn IDs fence late
events. Figma Stop is permanent cancellation: its installed-hook notice is delivered once
at a tool boundary, independently of the immediate local write fence. Immediate host
interruption is not enabled for Claude.

### Native Codex lifecycle and Stop

Codex binds each MCP request using host-supplied thread/turn metadata. Old installed
Codex hook callbacks are ignored. The Hub follows the exact local conversation owner
through `thread-stream-following-changed` and versioned `thread-stream-state-changed`
broadcasts. It retains only turn IDs and statuses from legacy or canonical history.
Content deltas are ignored after decoding. Lifecycle patches update a minimal projection
of turn IDs and statuses, publishing only after the whole batch succeeds. The native API
still sends a full initial snapshot; revision gaps, unsupported lifecycle patches, and
reconnection require a fresh snapshot. Unknown versions, timeouts, disconnection, and owner loss clear
the observed state and retry discovery. Reconnection never resumes a cancelled task.

Terminal turn states pause the matching design lease. A subsequent design turn must
resume and reread before writing. Other conversations and stale stream revisions cannot
pause it. Status subscription never loads or navigates an absent conversation.

Figma Stop cancels the task and pending comments locally before requesting
`thread-follower-interrupt-turn` with `expectedTurnId`. The owner checks that the exact
turn is still active; it cannot stop a newer turn. The response must identify the same
owner and interrupted turn, or confirm that the turn has ended. Failure to confirm host
interruption does not undo the local write fence. There is no hook fallback.

### Codex feedback: native Queue and Steer

Queue admits comments into Codex's local native queue and settles after the host
acknowledges storage. The Hub serializes submissions per conversation, reads the
latest committed `queued-follow-ups` snapshot from Codex home without modifying
that file, and submits the complete merged list through native IPC. Existing messages
and all their fields are preserved. This is best-effort read/merge/set: the host has no
revision precondition, so a simultaneous composer edit can race the replacement.
See [Codex desktop IPC research](../engineering/codex-desktop-ipc.md#native-queues)
for the storage evidence and separate, feature-gated app-server queue. Ordering between
those two queues has not been verified.

The adapter discovers existing current-user Unix sockets under Codex home or the host's
temporary directory. On Windows it connects to the host's fixed local named pipe,
`\\.\pipe\codex-ipc`, using Windows pipe access control instead of Unix inode checks.
Remote and arbitrary pipe names are rejected. It identifies itself as `tempad-dev`, discovers
the exact conversation owner, and requires `supportsUntrustedAppInput`. It does not alter
host/model/approval settings.

Only an explicit submission can load an absent conversation: on macOS or Windows an exact
`no-client-found` response opens its `codex://threads/<id>` link through the registered OS
handler, then retries discovery for up to five seconds. Capability polls never navigate.
Other failures retain drafts and
return their error. Stop, Done, and replacement are checked again before dispatch.
Submission discovery allows the host router's ten-second client-discovery window to finish
before deciding that the conversation is absent; capability polls keep a short timeout.
Discovery failures occur before comment dispatch and must not be reported as uncertain delivery.
After opening, short repeated discovery queries observe the owner as it loads; a query begun
before loading can otherwise wait for the router's entire window without noticing the new owner.

Queue uses `thread-follower-set-queued-follow-ups-state` v1. The message ID is the
stable feedback ID; composer context holds the review prompt and empty attachment lists.
The original conversation snapshot supplies its working directory. The task ID remains
untrusted `writingBlockAdditionalContext`; the owner derives workspace roots, model, and
permissions. Its selected-owner `{ ok: true }` receipt confirms native admission without
waiting for a turn to end. No legacy untrusted-App-input flags are stripped to bypass validation.

When the local store or native snapshot is unavailable, Queue retains the bounded Hub
waiting path: `thread-follower-start-turn` with the review as user input and the original
task ID in paired tool-response items. Nonempty app context preserves the pre-creation busy
check. A known busy rejection retries with cancellation checks for at most five minutes.
An explicit Steer submission uses this Start path for an idle conversation.
The host's pre-creation guard decides whether it is idle;
the design task's status is not a substitute for conversation state. After a known busy
rejection, Steer calls `thread-follower-steer-turn` v1 on that same owner, retaining the
receipt and user-message identity. The review remains user input; the task ID is separate
untrusted additional context. The owner selects the active turn and applies its native
turn-ID precondition. Its acknowledgement must name the owner and the steered turn.
If the active turn ends before delivery, drafts remain available for an explicit retry;
uncertain delivery is never replayed. Steer never waits behind a pending native delivery.
Switching an already queued batch to Steer remains unavailable.
Comments never fall back to hooks.

Before sending, a durable receipt reserves conversation/file/comment identity. Native
queue acknowledgement or the selected owner's Start/Steer turn ID confirms admission.
For uncertain queue writes, the adapter rereads committed state: presence of the stable
message ID confirms admission; absence remains uncertain because the host may already
have consumed it or the user may have deleted it. Neither a retry nor a Hub restart restores
an absent uncertain message. Acknowledged receipts never enqueue again. Receipts retain
content hashes and routing/message identities, not comment text.

Stop and Done fence pending submissions and remove only this task's native message IDs
from a fresh complete queue. Stop's local fence and host interruption do not wait for that
cleanup. Failed cleanup remains fenced and retries during capability refresh, including
after a Hub restart. Cancellation tombstones remain after an empty-queue check, so a
late commit from a disconnected writer is removed on subsequent reconciliation.
Ordinary transport disconnects do not remove admitted messages.
Already consumed input cannot be recalled. Acknowledgement confirms admission, not
execution or completion of design changes.

The private protocol was inspected against Codex App 26.908.70816, and the busy-owner
Steer path and paused native queue admission/removal were verified against that macOS host.
Automatic queued execution and the refreshed plugin/Figma UI flow remain live verification
items. Windows endpoint selection, handshake,
URL loading, and rejection of unexpected pipe names have regression coverage; native
Windows host verification is still required. Incompatible or unavailable hosts keep drafts
until native delivery becomes available. Fixtures alone
cannot establish support across host versions or platforms.

## Canvas controls and comments

The stable design anchor is an existing Frame chosen through `set_design_anchor`, or the
first created top-level Frame after its actual position is known. Beginning a task needs
no speculative geometry. Reads, selections, updates, and later creates never change the
anchor. The tool does not modify nodes or move the viewport. Exact task/file/node identity
is restored without navigation; a newer anchor, Done, or cancellation wins over stale reads.

The canvas bar shows the agent-reported name, activity from existing read/write signals,
comments, and Stop/Done. The panel status locates that same anchor. With no usable anchor,
task controls remain in the panel while canvas/comment/Locate controls are unavailable;
drafts are retained. Paused, expired, interrupted, and completed open tasks retain comments
when anchored. Stopping and cancelled tasks hide them. Only active work shows the outline.

The bar's drag offset is stored relative to its anchor in canvas coordinates, scoped to
that task/file/anchor. It follows movement and zoom; double-click resets it. Button actions
remain separate from drag, and cancellation/blur releases capture. Locate frames both the
anchor and bar while preserving the offset. Pan clips the bar at the canvas edge; page
changes hide it. No canvas action implicitly changes the user's page, viewport, or selection.

All overlays share one animation-frame snapshot of canvas, viewport, page, and selection.
Native geometry determines projection; control sizes remain in screen pixels. Transparent
wrappers and pointer-travel regions are passive. Feedback popovers sit above the main panel;
the panel stays above canvas task controls. Markers stay below native floating layers,
hide under overlapping tooltips, and cannot intercept clicks while occluded. Old lease DOM
nodes are replaced. Editors constrain/flip within the canvas and keep their exact target
when selection changes. Feedback failures cannot fail a canvas transaction. Motion respects
reduced-motion preferences, and the scheduler stops when its last observer leaves.

During an open anchored review, entering a selected element reveals its comment entry.
Saved comments become numbered markers in saved order. Editing hides only that marker;
closing restores it. Delete renumbers remaining comments. The status count includes saved
element comments only; a general comment has no marker and can be sent alone.

- In the element editor, Enter or click saves the current comment without sending.
  Command/Ctrl+Enter or Command/Ctrl+click saves the current edit, then queues the whole batch,
  including saved element comments and general guidance. A failed save prevents submission.
- In the general composer, Enter or click queues the whole batch. Command/Ctrl+Enter or
  Command/Ctrl+click requests Steer for the same batch. Empty general guidance can submit saved
  element comments; an empty batch cannot submit. These choices do not depend on observed agent
  activity or cached capabilities.
- Submit buttons keep their icon-only presentation. Tooltips identify Save comment / Save & Queue
  in the element editor and Queue comments / Steer now in the general composer, updating while
  Command/Ctrl is held. The actual input event determines the action. Shift+Enter inserts a
  newline in either editor; IME confirmation never submits.
- Escape discards the current element edit without deleting its saved comment. An unchanged
  editor closes on outside click; an unsaved edit first signals a warning, then a second
  outside click discards it. Further typing resets the warning.
- The review lists saved comments and a general composer. Outside click/Escape closes it
  without clearing drafts. Unavailable/off-page targets remain readable and deletable.
- Populated submit controls remain actionable when disconnected. Click saves and asks the
  delivery layer to verify current capability. Unsaved element edits, incomplete draft loads,
  and conflicting storage work report their blocking condition. Repeated clicks never
  duplicate an in-flight request. Comment submit controls retain their arrow/check icons during
  saving, sending, and queueing; the sending spinner belongs to the status-bar comment entry.
- Acceptance closes the submitting popover and unlocks the status-bar comment entry. Only
  confirmed delivery clears submitted revisions and animates their markers away. The entry keeps
  its spinner until native admission, with a tooltip naming the agent it is waiting for;
  enabling review does not imply that the host has received the comments. Reopening a
  pending batch allows review; editing, deletion, and resubmission remain blocked until
  the final admission receipt. Native queue admission clears submitted revisions and
  permits a new batch while the host still has earlier comments queued for execution.
  Failures retain comments and use one native toast per failed request.
  Initial draft-load failures retry with bounded backoff; scope changes and Stop cancel retries.

| Feedback state                            | Status-bar entry                         | Submitted batch                                                  |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Draft / failed request                    | Enabled, comment icon                    | Editable; explicit retry retains delivery identity               |
| Sending, before acceptance                | Disabled, spinner, “Sending comments…”   | Editing and duplicate sends blocked                              |
| Accepted, waiting for native delivery     | Enabled, spinner, queued/waiting tooltip | Read-only                                                        |
| Confirmed delivery                        | Enabled, comment icon                    | Clear only acknowledged revisions, then reload drafts            |
| Transport timeout without a final receipt | Enabled, comment icon                    | Retain drafts and identity; a late receipt can still settle them |

Hub acceptance is not proof of native admission. A final receipt that arrives before the
initial request resolves immediately ends its submission state. It takes precedence over a
late acceptance or transport error; the old request cannot reset a newer batch's pending state. Acceptance after a transport
timeout locks the unchanged submitted batch, but never freezes newer saved edits. Unrelated task/batch and
control receipts cannot settle the feedback batch. Disconnect does not prevent review.
Stop/interruption clears pending UI authority; a late acceptance cannot
restore it. Task/epoch changes fence callbacks and receipts from the previous scope.

Drafts use extension-local storage keyed by task, file, client kind, and conversation, not
page, tab, lease, or focus. Registered matching-file pages can read/write the exact scope
without a live Hub. A new task starts empty; navigation or reconnect does not send anything.
Unsaved element text is not persisted. General guidance autosaves after typing pauses and
flushes before submission. Legacy conversation-wide drafts are not assigned to new tasks.

The broker serializes storage updates. It records submission identity before dispatch and
clears only matching submitted revisions, even after the originating tab closes. Later
edits, other tasks, and newer rounds survive late receipts. Editing invalidates the saved
retry snapshot; a separate in-flight receipt can still settle already-sent revisions. Done
advances a durable round marker and fences late autosaves before clearing the round.
Limits are 20 element comments, 8,000 characters per comment, and 32,000 total per batch.

## Delivered review

Feedback is a follow-up instruction with a target, not a generated report. Preserve the
user's words, identify each target exactly, and keep delivery bookkeeping outside the prose.
A general-only comment is sent verbatim. When elements are included, append a numbered
Markdown list in marker order. Each item has one link using the captured element name and
then the user's comment, indented as the list item's body. User lists, emphasis, code blocks,
and paragraphs remain Markdown; comments are not wrapped in blockquotes.

For example:

```markdown
Make the overall layout more compact.

1. [Heading](https://www.figma.com/design/FILE?node-id=1%3A2&page-id=0%3A1)

   Increase the contrast.

2. [Button](https://www.figma.com/design/FILE?node-id=1%3A3&page-id=0%3A1)

   Keep the label on one line.
```

The link carries the exact file, node, and page identities, including the page ID needed
for an unloaded page. Captured names are escaped link labels, not instructions or matching
keys. Page names and containing-frame metadata remain in drafts for UI context. Do not add
a review title, category headings, separate ID lines, batch IDs, timestamps, or instructions
about how to acknowledge each comment. Do not sort or regroup comments.

Codex App 26.908.70816's native response annotations represent text selected from an earlier
assistant message. Their source consists of a message ID and text offsets; there is no
Figma-node source in that contract. Reusing its envelope would describe the wrong source
and add annotation-reply directives without providing native Figma navigation. Use ordinary
feedback and real Figma links instead. This limitation concerns response annotations, not
the native Queue and Steer transports.

General guidance applies to the task's design region; each element comment applies to its
captured target in that context. Read the whole review before editing. Scope does not
establish priority: conflicting requests need clarification. Reread exact targets and report
missing nodes by number rather than matching names or substituting the current selection.
Native delivery sends the same review body through Queue and Steer, with the original task ID
in separate context. Hooks never carry the review. A conversation can own multiple design
tasks, so recovery must identify the task that received these comments. Task lifecycle rules
remain in server instructions, the authoring skill, and runtime guards; each batch does not
repeat them. Queue/Steer changes timing only.

This follows [GitHub's batch review model](https://docs.github.com/en/pull-requests/get-started/reviewing-pull-requests-quickstart),
[Figma's exact comment targets](https://developers.figma.com/docs/rest-api/comments-types/), and
[separation of instructions and context](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices).
These precedents do not establish improved model outcomes; tests verify content preservation
and native delivery. Agents return results and Figma links through the original conversation;
there is no separate result card. Retained result IDs and summaries support recovery, while
further work still rereads native state.

## Verification

Shared/server tests cover bounds, isolation, leases, epochs, draining, recovery, host lifecycle,
capability fallback, and delivery. Playwright covers browser controls. Bridge versions advance
together when peers cannot interpret new routes or state; compatible changes do not force a
restart. Live evaluation follows [the authoring runbook](../testing/agent-authoring-evolution.md).

Protocol references: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Codex app server](https://learn.chatgpt.com/docs/app-server), and
[Claude plugin hooks](https://code.claude.com/docs/en/plugins-reference#hooks).
