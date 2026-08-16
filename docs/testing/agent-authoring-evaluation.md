# Agent authoring evaluation loop

Use this runbook to forward-test or review changes to TemPad's Figma authoring
MCP, agent plugin, or authoring skill. Complement automated tests with a fresh
agent completing a realistic task through the installed runtime; do not treat
review of an implementation diff as an evaluation.

## Define a valid evaluation

Require every run to:

- use the intended skill, MCP, and extension builds;
- preserve the exact prompt, complete task, tool evidence, and final artifact;
- inspect representative screenshot pixels and relevant native Figma structure.

Apply these authoring boundaries:

- Treat one evaluation round as one fresh, uniquely named page in the already
  open signed-in Figma test-file tab. Keep that round's task, artifact, repairs,
  and evidence on that page. Do not create auxiliary, probe, retry, baseline,
  or forward-test pages inside the same round; any independent rerun starts the
  next round on its own single new page.
- Express ordinary information architecture, hierarchy, layout, spacing,
  typography, color, and appearance through Canvas HTML, Tailwind, and
  CSS-shaped composition. Keep the core design legible in markup and classes.
- Use typed native fields, resources, bindings, components, variables, masks,
  grids, media, and other Figma-only state only where the requested result or
  faithful reconciliation requires them. Do not make native DSL the primary
  creative language or reward a run merely for emitting more native state.
- Treat the supported Canvas subset as an implementation boundary, not a design
  boundary. When it blocks a well-grounded design, record the smallest missing
  web capability and prefer a bounded implementation extension with regression
  coverage over guidance that teaches agents to avoid the design. Seek the
  broadest dependable authoring surface, not full browser compatibility.
- Judge agent design quality separately from translation quality. Require
  TemPad to preserve design intent in editable native structure and require any
  Figma-native feature promised by the brief.
- Require failures to remain bounded, diagnosable, and recoverable. Preserve
  content, states, assets, and unaffected relationships through creation,
  updates, and repairs without overlap, clipping, or text and glyph cropping.
- Use components, variables, and styles when demonstrated usages contain
  decisions that should evolve together. Judge semantic boundary, coverage,
  responsibility, states, ownership, and coordination cost rather than counts
  or visual similarity alone.

Keep contextual design decisions at high freedom. Do not turn this loop into a
fixed visual style, product-domain rule, platform convention, component quota,
asset policy, or design process. Ground those decisions in the user request,
project evidence, targeted research, or an applicable professional skill.

## Establish a valid runtime

Follow the agent-plugin workflow in `AGENTS.md`. Record the source revision or
working-tree state and the runtime layers changed.

Refresh only the runtime layers affected by the change:

- Changes to the shared authoring skill, agent-plugin manifests, icons, or
  marketplace metadata require `pnpm agent-plugin:dev` and replacement of the
  installed cachebuster.
- MCP-only changes require the affected MCP build and a fresh agent task or
  plugin reload. When the generated manifest still points at the same
  working-tree command, they do not require agent-plugin regeneration or
  reinstall.
- Extension-side changes require the affected extension build, a reload of the
  target Figma tab, and confirmation that MCP reconnects. They do not require
  agent-plugin regeneration or reinstall.

Do not use CDP, Browser control, a shell wrapper, or a repository-local dispatch
script to change task permissions or manufacture a clean task. CDP may remain
an implementation detail of the supported plugin-reinstall helper, and Browser
control is the supported way to prepare the Figma tab; neither is the clean-task
dispatch mechanism.

Use this sequence, applying the conditional plugin steps only when the generated
agent plugin changed:

1. Build each affected runtime layer. When the generated agent plugin changed,
   run `pnpm agent-plugin:dev`, inspect the generated manifest, skill, and MCP
   command, then read the exact cachebuster:

   ```sh
   TEMPAD_DEV_VERSION=$(node -p "require('./.dev/plugins/tempad-dev-dev/.codex-plugin/plugin.json').version")
   ```

2. When the generated agent plugin changed, replace the active plugin through
   Codex Desktop's native plugin UI:

   ```sh
   pnpm agent-plugin:reinstall "$TEMPAD_DEV_VERSION" \
     --cdp-url http://127.0.0.1:9222
   ```

   Reuse the running host's CDP endpoint when it is already available. Add
   `--restart-codex` only when the helper cannot connect to any supported CDP
   endpoint and a host restart is actually required. Use the script's `--help`
   for non-default CDP or page selection.

3. Accept a replacement only when the helper confirms this complete
   transition for the checkout's exact MCP command paths:

   - CLI and Hub are both running before uninstall, or both absent for an
     explicit repair reinstall; a partial runtime is rejected;
   - Codex reports the plugin uninstalled, then its CLI count decreases; the
     machine-wide Hub stops only when no other working-tree MCP clients remain;
   - Codex installs the exact generated version, then a new CLI appears and a
     Hub is available.

   Stop and diagnose any timeout or stale host state. Never substitute a broad
   process-name kill.

4. After replacement, confirm with `codex plugin list` that
   `tempad-dev-dev@tempad-dev-dev` is installed and enabled at the generated
   version. Treat the listing and cache directory as installation evidence, not
   proof of the fresh task's runtime.
5. In the coordinating task, use Browser control with the already open,
   signed-in Figma test-file tab; do not open another Figma tab or use Computer
   Use for this setup. Reload the existing tab, reacquire it if needed, and
   confirm that the TemPad panel reconnects to MCP.
6. Through Browser control, create and select exactly one uniquely named, empty
   Figma page for the round, and record its page identity. Do not create a
   staging, probe, comparison, retry, or forward-test page in the same round,
   and do not leave an artifact on the new page that the evaluation agent can
   discover or copy.
7. Release or hand off the claimed Figma tab without closing it. From a Full
   access coordinating task, call Codex App's native task-creation tool directly
   and create a fresh, projectless task. Dispatch the evaluation prompt in that
   tool call, use the configured default model unless the evaluation explicitly
   targets another model, and record the returned task or thread ID. The result
   must appear in the App's task list and open independently.

   Confirm that this dispatch produced exactly that one fresh task. If another
   task with the same source prompt appears, stop both before either writes,
   reject the round, and diagnose task creation; never choose one to continue or
   let multiple tasks share the page.

   Do not navigate Codex UI with CDP or Browser control to set permissions or
   dispatch the task. Do not substitute a CLI, SDK, `codex app-server`, App
   Server thread API, custom dispatch script, shell wrapper, subagent, side
   conversation, hidden fork, or background process for the native task tool.
   A persisted rollout or JSONL file alone is not evidence that the App task was
   created.

   The fresh task must run with Full access and must not require per-call
   approval for authorized TemPad MCP writes. The coordinating task's access
   setting is not sufficient evidence by itself: confirm the fresh task's access
   through its direct TemPad write. If the task pauses for approval, reject the
   run instead of approving it or trying to repair permissions through CDP. Do
   not run the evaluation in the coordinating task.

8. Before accepting the result, confirm that the fresh task records the
   generated cachebuster in its skill path, uses the checkout's MCP CLI and Hub
   rather than a detached Hub or stale socket, can call TemPad tools directly,
   reaches the refreshed extension, and performs authorized TemPad writes
   without pausing for approval.

Do not add a probe task after every reinstall. The clean evaluation task is the
new-task pickup boundary and must provide the runtime evidence. Use a dedicated
probe only once when diagnosing the lifecycle.

Reject any run that cannot prove runtime identity. End that round, repair the
runtime, and start the replacement as the next round with exactly one new empty
page and fresh task. Do not reuse the rejected artifact. Starting the MCP CLI
manually or recreating stdio or
JSON-RPC transport does not restore missing direct tool exposure. Also reject a
run when a TemPad write pauses for approval: treat it as a task-lifecycle
failure, do not approve it mid-run, and fix the permission propagation or
explicit setup before the next single-page round.

## Choose a representative task

Choose a realistic, coherent task with enough goals, content, and constraints
to require design evidence rather than recall of a familiar template. Vary
recent runs in context, complexity, information volume, visual language,
market context, and delivery scope without creating fixed categories or style
mappings.

Default to common web or mobile product work that a product designer would
recognize without specialized domain knowledge: for example account settings,
team management, onboarding, search and filtering, dashboards, checkout,
booking, messaging, subscription management, or a standard commerce flow. Use
a niche industry, unusual interaction model, speculative device, or highly
stylized brief only when the capability under evaluation requires it and the
prompt supplies enough domain evidence.

The representative task is not a disguised unit test. Give it a normal product
goal, realistic content, multiple related states or screens, and enough layout
pressure to exercise the capability naturally. Do not center the brief on the
suspected defect, force a rare visual device merely to reach one code path, or
add arbitrary constraints that make the result less representative. A small
synthetic reproducer may support diagnosis after the run, but it cannot replace
the clean design task.

Prompt minimalism is part of evaluation validity. The prompt must remain a
normal design brief, not a second design skill or a copy of this runbook. In the
usual case, give the fresh task only:

- the instruction to use the installed Design in Figma skill on the prepared
  current page;
- what product or flow to design and the smallest useful scope;
- at most one coarse visual direction or a genuine task-local reference.

Leave research, professional-skill selection, design-system strategy,
composition, content elaboration, asset choice, Figma representation, tool
sequence, and verification method to the agent and the installed skill. Do not
embed a component or token quota, prescribe component families, enumerate
visual-quality rules, mandate particular external skill URLs, restate tool
guardrails, or reveal the capability or defect under test. Include exact
content, platform, accessibility, brand, or compliance constraints only when
they are authentic requirements of the representative product request.

When evaluating professional design quality, use a brief that leaves enough
room for the installed skill and agent to obtain credible design evidence or
appropriate professional expertise. Do not name a particular external skill in
the prompt unless a real user supplied it as task-local evidence. In review,
verify and record the provenance, scope, and fit of any external or community
skill the agent selected. Keep domain skills independent from TemPad; choose
the required design capability before inspecting what is installed, because
local availability is not evidence of task fit. Do not copy its domain rules
into TemPad.

Ground product, platform, regional, accessibility, content, and visual choices
in task evidence or professional guidance rather than stereotypes.

## Run a clean task

Give the evaluation agent only the minimal realistic brief described above and
task-local context. Do not reveal the suspected defect, intended fix, expected
tool sequence, quality rubric, or desired answer. Do not preload a research
plan or convert review criteria into generation constraints; those make the run
measure prompt compliance instead of the installed Design in Figma workflow.

Ask the fresh task to use the installed TemPad Dev Figma canvas authoring skill
and to work only on the prepared current page. Let that clean context discover
the skill instructions and call TemPad tools directly; do not preload it with
the coordinating task's investigation, rollout, implementation diff, or prior
artifact.

Preserve:

- the exact prompt and supplied references;
- the complete task, tool inputs and outputs, errors, retries, and recovery;
- the final Figma structure and relevant native resources;
- representative screenshots whose pixels were opened and inspected.

Use one fresh task and the round's one prepared page for each independent run.
When retesting a capability, make it the next round and vary surface details
while preserving that capability. Do not create a second page in the current
round or expose prior artifacts that a later agent could discover or copy.

When investigating cross-run visual convergence, change only the product brief
or coarse direction between clean runs. Do not counter-prompt with a growing
list of forbidden motifs, materials, colors, borders, shadows, or layout
patterns; that produces another prompt-shaped style. Compare the agent's
research and decision trace, selected expertise, and rendered results across
runs before attributing convergence to TemPad, the task prompt, or the model.

After dispatch, keep the coordinating task idle until completion. Do not
inspect or steer intermediate work, modify the repository, plugin, runtime, or
Figma state, or begin fixes in parallel. Observe completion on the independently
openable App task; polling a headless process or shell session is not a valid
replacement.

## Review the complete run

Reopen the task from the Codex App task list and read it from its initial prompt
through its final answer. Treat the agent's retrospective as a lead, not proof.
Reconstruct consequential decisions and failures from tool evidence, then
inspect the delivered artifact directly.

Review these axes:

1. **Outcome and preservation:** Satisfy the request and preserve supplied
   content, states, assets, and unaffected relationships.
2. **Authoring-language quality:** Carry ordinary composition and appearance in
   markup and classes; reserve native declarations for translation fidelity or
   explicitly required Figma capabilities.
3. **Reconciliation and native fidelity:** Preserve the desired editable
   layout, text, paint, media, resources, bindings, components, and instances
   rather than only approximating pixels or reshaping the design around native
   DSL convenience.
4. **Spatial rhythm and density:** Assess section grouping, macro whitespace,
   local gaps, control density, alignment, text measure, and vertical balance.
   Unequal spacing must communicate hierarchy rather than look accidental.
5. **Visual authorship and assets:** Assess typography, color, shape language,
   icon and image medium, brand expression, distinctiveness, evidence, and
   required fidelity. A coherent but generic default UI does not satisfy a
   brief that establishes a more specific product character.
6. **Rendered integrity:** Inspect representative compositions and states for
   overlap, clipping, text or glyph bounds, and recovery side effects.
7. **System coherence:** When the brief or selected authoring path establishes
   coordination value, assess component and token boundaries, contracts,
   instances, bindings, coverage, and final usage rather than accepting
   detached definitions.
8. **Execution and verification:** Require scoped calls, stable identities,
   non-destructive failures, evidence-driven retries, and conclusions based on
   pixels and native structure rather than intent or mutation counts.

Apply these evidence rules:

- Inspect the actual `apply_canvas` payload and the reconciled artifact. Treat
  payloads dominated by native declarations as a warning when ordinary
  composition could remain in HTML or Tailwind; identify whether the cause is
  skill guidance, schema discoverability, a translation gap, or a genuinely
  Figma-only requirement.
- Compare the intended HTML or Tailwind design with the payload and artifact.
  When unsupported web expression reduces fidelity, record the smallest missing
  capability, safe semantics, fallback and failure behavior, and required Figma
  representation. Do not score the workaround as an intrinsic design failure.
  In later rounds, verify that an extension restores fidelity without weakening
  determinism, editability, or transaction safety.
- Verify retained native-state claims, including masks, IMAGE paints, layout
  grids, and frame guides, through live `get_structure` read-back with
  `options.native: true`. Apply input and mutation summaries prove desired
  state, not retained state.
- Inspect both pixels and layer types for every material icon and visual asset.
  Reject a Unicode or emoji TEXT node standing in for an interface icon, and
  reject a primitive collage standing in for an asset whose intended medium is
  SVG, image, illustration, or an existing component. A plausible silhouette
  is not medium fidelity.
- When a local design system is required or authored, verify live component
  definitions, INSTANCE consumers, and representative variable or style
  bindings. A detached component board, repeated FRAME copies, shared literal
  values, or an agent's claim that it made a system is not usage evidence.
- Review spatial rhythm at both levels: compare page margins and major section
  allocation, then inspect repeated row heights, control padding, inter-item
  gaps, and text-to-container relationships. Do not demand equal whitespace;
  demand that differences have a visible grouping or hierarchy purpose.
- Do not equate quality with decoration, imagery, shadows, gradients, depth, or
  a named style. When evidence establishes a specific asset role or medium,
  reject an unrelated primitive substitute. Conversely, do not excuse a bland
  result merely because it is restrained: judge whether it carries the brief's
  established character through a coherent combination of type, color,
  spacing, shape, assets, and state treatment.
- Separate facts from hypotheses and record the earliest state that violated an
  invariant, not only the final symptom. Check whether different triggers share
  an identity, ownership, transaction, or serialization defect.
- Compare completed artifacts across independent runs. Treat unexplained
  convergence in composition, color, typography, asset medium, or primitive use
  as a portfolio signal. Investigate task distribution, professional guidance,
  example fixation, tool affordances, and capability gaps before creating a
  skill rule.

## Place the fix at the owning layer

Classify each confirmed finding before changing anything:

| Finding                                                                      | Owning response                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser, schema, transaction, identity, layout, or serialization defect       | Fix the implementation and add a behavior-level regression test.                                                                                                       |
| The safe HTML/Tailwind subset prevents faithful expression of a sound design | Extend the smallest owning parser, model, or reconciliation boundary with explicit semantics and regression coverage; do not turn the limitation into design guidance. |
| A valid mechanical contract is hard to discover or diagnose                  | Improve the tool schema, error, or focused protocol reference.                                                                                                         |
| Agents repeatedly miss a transferable workflow cue or verification boundary  | Add the smallest useful branch or cue to the authoring skill.                                                                                                          |
| A stale plugin, MCP, Hub, extension, or Figma session affected the run       | Fix the test/runtime lifecycle; do not compensate in design guidance.                                                                                                  |
| Product, platform, accessibility, content, or visual-design judgment         | Leave it to task evidence, research, or a relevant skill unless TemPad prevents the chosen result.                                                                     |
| A one-off taste difference violates no evidence or contract                  | Record it without making it a platform requirement.                                                                                                                    |

Use low freedom for fragile protocol, safety, and integrity invariants; use
concise heuristics when several workflows are valid; preserve high freedom for
contextual design judgment.

Promote a finding into a guardrail only when it is a stable invariant, recurs
across tasks, prevents a hard-to-detect or hard-to-recover failure, or can be
stated as a concise transferable cue. Otherwise prefer an implementation fix,
regression test, or evaluation record. When the owning layer is a skill, apply
the quality tests in `docs/skill/rationale.md`.

## Close the loop

For a confirmed issue:

1. Add or strengthen an automated regression test when behavior is
   deterministic.
2. Make the smallest change at the owning layer. Update current-state
   documentation instead of appending incident history.
3. Run the checks required by `TESTING.md` and the relevant package guide.
4. Rebuild, regenerate, reinstall, or refresh only affected runtime layers.
5. Record the fix as the input revision for the next round's fresh task and
   single new page.

A complete evaluation-optimization round contains one clean evaluation on one
new page, evidence review, root-cause placement, and any justified owning-layer
change. A fresh post-fix forward test is the next independent round, not a
second page or task appended to the current round. Its prompt should use another
ordinary web or mobile scenario that exercises the same capability naturally;
change its product surface and content so success cannot come from copying the
prior artifact. Do not reuse the prior task, page, or context.

For cross-run convergence, retest with materially different design evidence.
Require the authoring path to carry distinct, well-grounded directions; do not
require every result merely to avoid a prior style.

Conclude with a short record of the tested revision and runtime, prompt,
observed evidence, root cause and owning layer, change, automated checks,
relationship to the prior round, next-round forward-test target, and remaining
uncertainty. Do not call a round successful without verified runtime identity
and screenshot pixels.
