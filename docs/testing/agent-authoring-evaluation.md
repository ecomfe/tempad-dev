# Agent authoring evaluation loop

Use this runbook to forward-test or review changes to TemPad's Figma authoring
MCP, agent plugin, or authoring skill. It complements automated tests: the test
subject is a fresh agent completing a realistic task through the installed
runtime, not an agent reviewing an implementation diff.

## Scope and freedom

A valid evaluation must:

- prove that the task used the intended skill, MCP, and extension builds;
- preserve the exact prompt, complete thread, tool evidence, and final artifact;
- inspect representative screenshot pixels and relevant native Figma structure.

Evaluate these outcomes in context:

- Canvas HTML and Tailwind carry the agent's primary design intent and create
  or update the intended native structure predictably through reconciliation.
- Failures are bounded, diagnosable, and recoverable without corrupting prior
  state.
- Content, states, assets, and unaffected relationships survive creation,
  updates, and repairs without unintended overlap, clipping, or text/glyph
  cropping.
- The reconciled result uses required Figma-native semantics rather than only
  resembling the intended pixels, without making Figma-native DSL the agent's
  primary creative language.
- When demonstrated usages contain decisions that should evolve together,
  components, variables, and styles coordinate them at a useful semantic
  boundary. Judge value and coverage, not resource counts.

Do not use this loop to standardize a visual style, product-domain UX rule,
platform convention, component count, asset source, or design process. Those
decisions come from the user, project evidence, an applicable domain skill, or
targeted research. Repetition and similarity are component evidence, not a
threshold; responsibility, states, ownership, expected evolution, and
coordination cost also matter.

## Authoring model under evaluation

Treat HTML, Tailwind, and CSS-shaped composition as the agent's primary design
language. General-purpose models have substantially stronger pretrained priors
for those representations than for a bespoke Figma DSL, so the agent should
express information architecture, grouping, hierarchy, layout, spacing,
typography, color, and ordinary appearance through Canvas markup and classes.
This is the reason TemPad takes the indirect HTML/Tailwind-to-Figma path: the
extension reconciles a representation in which the model can design well into
editable Figma structure.

Figma-native capabilities remain required as a translation and fidelity layer.
Use typed native fields, resources, bindings, components, variables, masks,
grids, media, and other Figma-only state when the requested result or faithful
reconciliation needs them. Do not use the availability, quantity, or novelty of
native fields as the creative grammar that determines the composition. The
extension should absorb Figma-specific reconciliation complexity rather than
forcing the agent to design by enumerating native node or Plugin API semantics.

Treat the currently supported Canvas HTML/Tailwind subset as an implementation
boundary, not a design boundary. When a well-grounded design must be simplified,
recomposed, or abandoned because the safe subset or reconciler cannot express
it faithfully, record the missing web capability and evaluate whether TemPad can
support it safely and predictably. Prefer extending the subset, parser, layout,
paint, typography, or reconciliation behavior with bounded semantics and
regression coverage over teaching the agent to avoid the design possibility or
recreate ordinary web composition through native DSL. The objective is not full
browser compatibility; it is the broadest dependable authoring surface that can
reproduce high-quality HTML/Tailwind design in editable Figma structure.

In evaluation, distinguish these two responsibilities:

- **Agent design quality:** judge the HTML/Tailwind desired result and the
  design decisions it expresses.
- **Translation quality:** judge whether TemPad reconciles that result, plus
  narrowly declared Figma-only requirements, into correct editable native
  structure without losing intent.

Do not reward a run merely for emitting more native DSL, resources, or bindings.
Do not penalize a strong markup-led design because its ordinary layout and
appearance were not conceived in Figma-native terms. Conversely, when the brief
requires a native feature, its correct delivered state remains mandatory; that
is evidence of translation fidelity, not evidence that native DSL should have
driven the design.

## Establish a valid runtime

Follow the agent-plugin workflow in `AGENTS.md` for build, generation,
installation, and Figma refresh commands. Record the source revision or
working-tree state and which runtime layers changed.

Use this Codex Desktop development-plugin and Figma setup sequence after an
affected change:

1. Uninstall the active `tempad-dev-dev` plugin through the running host's
   plugin-management surface. Wait until the checkout's MCP CLI and Hub have
   exited and their known listeners are closed. Resolve ambiguous or unrelated
   processes by full command line; do not kill by a broad name match.
2. Build each affected runtime layer. Run `pnpm agent-plugin:dev` to generate a
   new cachebuster, then inspect the generated manifest, skill, and MCP command
   before installation.
3. Reinstall `tempad-dev-dev@tempad-dev-dev` with the Codex CLI bundled with
   the running Desktop app. Confirm that the installed root has the generated
   cachebuster.
4. In the coordinating task, use Browser control with the existing signed-in
   Figma test-file tab; do not use Computer Use for this setup. Reload the tab
   so the page context uses the rebuilt extension. Reacquire the tab after a
   reload if needed, then confirm the TemPad panel has reconnected to MCP.
5. Still through Browser control, use Figma's **Add new page** control to create
   a page with a unique task-specific name, then explicitly switch to that new
   page. Confirm that it is the current page and is empty. Do not leave a prior
   artifact where the test agent can discover or copy it.
6. Release or hand off the claimed Figma tab without closing it. Only then
   create a normal fresh projectless UI task whose prompt tells the agent to
   work on the current page. Do not continue the evaluation in the task that
   performed the runtime and page setup.
7. Confirm that the fresh task's recorded skill path contains the generated
   cachebuster and that its MCP CLI and Hub come from the intended checkout
   before accepting any result from it.

Do not create a separate probe task after each reinstall. The clean evaluation
task in step 6 is itself the new-task pickup boundary and must supply the
runtime evidence in step 7. A dedicated probe may establish this lifecycle
once while diagnosing the harness, but repeating it in later rounds adds no
evaluation evidence.

This uninstall, reinstall, page-setup, and new-task sequence refreshes the
development plugin without restarting Codex Desktop and gives the test agent a
known clean Figma target. `codex plugin list` and the cache directory are useful
installation evidence, but the fresh task's recorded skill path and live MCP
processes are the runtime proof.

Run the evaluation in a normal fresh UI task and establish that:

- the installed development plugin contains the intended cachebuster and skill;
- after reinstall, the fresh task's recorded skill source resolves to that
  cachebuster; a current cache directory or CLI install listing alone does not
  prove that the new task received the updated plugin;
- the task is served by the intended MCP runtime, not a stale CLI, detached Hub,
  or socket;
- TemPad tools are directly callable;
- the target Figma tab runs the refreshed extension and has reconnected to MCP.

A task that starts successfully but cannot prove these conditions is not a
valid evaluation. Discard a stale-plugin run, reinstall the intended
cachebuster, prepare another empty Figma page, and dispatch another fresh task.
Do not treat the stale task's artifact as a forward test.
Shell-launching the MCP CLI or manually recreating its stdio or JSON-RPC
transport does not repair missing direct tool exposure and cannot make that run
valid.

## Choose a representative task

Choose a realistic, coherent task with enough user goals, content, and
constraints for the agent to establish design evidence rather than guess from
a familiar template. Keep recent tests varied in context, complexity,
information volume, visual language, market context, and delivery scope. Use
later tasks to correct recurring sample bias without creating fixed categories,
quotas, or style mappings.

When a run is meant to evaluate professional design quality rather than Figma
execution alone, give the agent credible design evidence or pair TemPad with an
appropriate professional skill. Without either, the run may still evaluate
authoring mechanics, but it is weak evidence about design judgment.

TemPad remains orthogonal to product domains and regional design conventions.
When a task benefits from specialized design judgment, combine the authoring
skill with an appropriate professional skill. If none is installed, a test may
use a well-regarded community skill after checking its provenance, scope, and
fit. Keep that skill independent; do not copy its domain rules into TemPad.
Ground regional variation in task evidence, local references, or professional
guidance rather than stereotypes.

## Run a clean task

Give the test agent a realistic user request with only task-local context. Do
not reveal the suspected defect, intended fix, expected tool sequence, or
desired answer. Otherwise the run tests reconstruction of the maintainer's
reasoning rather than generalization.

Preserve the raw evidence:

- the exact user prompt and supplied references;
- the full conversation, tool inputs and outputs, errors, retries, and recovery
  path;
- the final Figma structure and relevant native resources;
- representative screenshots whose pixels were actually opened and inspected.

Use a fresh task for each independent run. When retesting a fix, vary the
surface details while preserving the capability under test. Do not leave prior
artifacts where a later agent can discover and copy them.

After dispatching the evaluation task, the coordinating task must remain idle
until it completes. Do not inspect or steer intermediate work, modify the
repository, plugin, runtime, or Figma state, or begin fixes in parallel. Start
the review only after the complete task result is available.

## Review the complete run

Read the thread from the initial prompt through the final answer. Treat the
agent's retrospective as a lead, not as proof. Reconstruct consequential
decisions and failures from tool evidence, then inspect the delivered Figma
artifact directly.

Review the run along these transferable axes:

1. **Outcome and preservation:** Did the result satisfy the task and preserve
   supplied content, states, assets, and unaffected relationships?
2. **Authoring-language quality:** Did the markup and Tailwind/CSS-shaped
   desired result carry the composition, hierarchy, layout, spacing,
   typography, color, and ordinary appearance? Were native declarations kept
   to Figma-only translation, fidelity, or explicitly requested capabilities,
   rather than used as the primary creative grammar?
3. **Reconciliation and native fidelity:** Did TemPad translate the desired
   result into the intended editable layout, text, paint, media, resource,
   binding, component, and instance semantics rather than merely approximate
   its pixels? Did native translation preserve the design instead of reshaping
   it around what was easiest to express in Figma DSL?
4. **Design quality:** Are the information architecture, hierarchy,
   typography, spacing, density, alignment, visual language, and asset medium
   deliberate, coherent, and grounded in task evidence or professional
   guidance? Is the work resolved to the fidelity the task requires?
5. **Rendered integrity:** Did visual inspection cover the representative
   composition and relevant states, including overlap, clipping, text/glyph
   bounds, and changes caused by recovery?
6. **System coherence:** Where task evidence established coordination value,
   did components and tokens model it with appropriate boundaries, contracts,
   instances, bindings, and usage coverage?
7. **Execution and verification:** Were calls scoped, identities stable,
   failures non-destructive, retries evidence-driven, and conclusions based on
   actual pixels and native structure rather than mutation counts or intent?

During audit, inspect the actual `apply_canvas` payload as well as the final
artifact. A strong payload should leave the core design legible in its markup
tree and class vocabulary. Treat a payload dominated by native declarations as
a warning when ordinary composition could have remained in HTML/Tailwind; then
determine whether the cause is skill guidance, schema discoverability, an
extension translation gap, or a genuinely Figma-only requirement.

Also compare the intended HTML/Tailwind design with both the submitted payload
and the reconciled artifact. If the agent reduced fidelity because a class,
layout mode, paint, effect, typographic feature, responsive relationship, or
other web-native expression was unsupported, do not score the workaround as an
intrinsic design limitation. Capture the smallest missing capability, its safe
semantics, fallback and failure behavior, and the Figma representation needed to
preserve it. Use later rounds to test whether extending that boundary unlocks
the design without weakening determinism, editability, or transaction safety.

When a claim depends on a mask, real IMAGE paint, layout grid, or frame guides,
require live `get_structure` read-back with `options.native: true`. The apply
input and a successful mutation summary are desired-state evidence, not proof
of the retained Figma state.

Do not equate quality with decoration, photographic imagery, shadows,
gradients, visual depth, or any named style. Flat color, geometric illustration,
and poster-like composition can all be valid when the task evidence supports
them. If a role is established as photography, a content image, or another
specific asset medium, however, do not accept an unrelated primitive
approximation merely because it is easy to author.

Separate observed facts from hypotheses. Record the earliest state that
violated an invariant, not only the final symptom. Different triggers may
expose the same identity, ownership, transaction, or serialization defect.

Compare each completed artifact with recent independent runs. Repeated,
unexplained convergence in composition, color treatment, typography, asset
medium, or reliance on simple primitives is a portfolio-level signal even when
each style is individually permissible. Investigate task distribution, missing
professional guidance, example fixation, tool affordances, and capability gaps
before turning that pattern into a skill rule.

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

Use low freedom only for fragile protocol, safety, and integrity invariants.
Use concise heuristics when several workflows are valid, and preserve high
freedom for contextual design judgment.

Promote a finding into a long-lived guardrail only when it expresses a stable
invariant, recurs across tasks, prevents a hard-to-detect or hard-to-recover
failure, or can be stated as a concise transferable cue. Otherwise prefer an
implementation fix, regression test, or evaluation record. When the owning
layer is a skill, apply the quality tests in `docs/skill/rationale.md`.

## Close the loop

For a confirmed issue:

1. Add or strengthen an automated regression test when the behavior is
   deterministic.
2. Make the smallest change at the owning layer and update current-state
   documentation instead of appending an incident history.
3. Run the checks required by `TESTING.md` and the relevant package guide.
4. Rebuild, regenerate, reinstall, or refresh only the affected runtime layers.
5. Repeat the clean task in a fresh thread and verify the live artifact again.

For a cross-run convergence finding, retest with materially different design
evidence. Success means the authoring path can carry distinct, well-grounded
directions—not that every result avoids the previously observed style.

Conclude with a short record of the tested revision and runtime, prompt,
observed evidence, root cause and owning layer, change, automated checks,
forward-test result, and remaining uncertainty. Do not call a round successful
when runtime identity or screenshot pixels were not verified.
