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

Use this sequence after an affected change:

1. Build each affected runtime layer. Run `pnpm agent-plugin:dev`, inspect the
   generated manifest, skill, and MCP command, then read the exact cachebuster:

   ```sh
   TEMPAD_DEV_VERSION=$(node -p "require('./.dev/plugins/tempad-dev-dev/.codex-plugin/plugin.json').version")
   ```

2. Replace the active plugin through Codex Desktop's native plugin UI:

   ```sh
   pnpm agent-plugin:reinstall "$TEMPAD_DEV_VERSION" --restart-codex
   ```

   Keep `--restart-codex` so the helper can restart Codex only when CDP is
   unavailable. Use the script's `--help` for non-default CDP or page selection.

3. Accept the replacement only when the helper confirms this complete
   transition for the checkout's exact MCP command paths:

   - CLI and Hub are running before uninstall;
   - Codex reports the plugin uninstalled, then both process sets stop and any
     known listeners close;
   - Codex installs the exact generated version, then both process sets run.

   Stop and diagnose any timeout or stale host state. Never substitute a broad
   process-name kill.

4. Confirm with `codex plugin list` that `tempad-dev-dev@tempad-dev-dev` is
   installed and enabled at the generated version. Treat the listing and cache
   directory as installation evidence, not proof of the fresh task's runtime.
5. In the coordinating task, use Browser control with the existing signed-in
   Figma test-file tab; do not use Computer Use for this setup. Reload the tab,
   reacquire it if needed, and confirm that the TemPad panel reconnects to MCP.
6. Through Browser control, create and select a uniquely named, empty Figma
   page. Do not leave an artifact that the evaluation agent can discover or
   copy.
7. Release or hand off the claimed Figma tab without closing it. Create a fresh
   projectless Codex UI task that instructs the agent to work on the current
   page. Do not run the evaluation in the coordinating task.
8. Before accepting the result, confirm that the fresh task records the
   generated cachebuster in its skill path, uses the checkout's MCP CLI and Hub
   rather than a detached Hub or stale socket, can call TemPad tools directly,
   and reaches the refreshed extension.

Do not add a probe task after every reinstall. The clean evaluation task is the
new-task pickup boundary and must provide the runtime evidence. Use a dedicated
probe only once when diagnosing the lifecycle.

Reject any run that cannot prove runtime identity. Reinstall the intended
cachebuster, prepare another empty page, and dispatch another fresh task. Do not
reuse its artifact. Starting the MCP CLI manually or recreating stdio or
JSON-RPC transport does not restore missing direct tool exposure.

## Choose a representative task

Choose a realistic, coherent task with enough goals, content, and constraints
to require design evidence rather than recall of a familiar template. Vary
recent runs in context, complexity, information volume, visual language,
market context, and delivery scope without creating fixed categories or style
mappings.

When evaluating professional design quality, supply credible design evidence
or an appropriate professional skill. Otherwise treat the run as evidence of
authoring mechanics only. Keep domain skills independent from TemPad; for any
external or community skill, verify and record its provenance, scope, and fit.
Do not copy its domain rules into TemPad.

Ground product, platform, regional, accessibility, content, and visual choices
in task evidence or professional guidance rather than stereotypes.

## Run a clean task

Give the evaluation agent only a realistic request and task-local context. Do
not reveal the suspected defect, intended fix, expected tool sequence, or
desired answer.

Preserve:

- the exact prompt and supplied references;
- the complete task, tool inputs and outputs, errors, retries, and recovery;
- the final Figma structure and relevant native resources;
- representative screenshots whose pixels were opened and inspected.

Use a fresh task for each independent run. When retesting a capability, vary
surface details while preserving that capability. Remove prior artifacts that
a later agent could discover or copy.

After dispatch, keep the coordinating task idle until completion. Do not
inspect or steer intermediate work, modify the repository, plugin, runtime, or
Figma state, or begin fixes in parallel.

## Review the complete run

Read the task from its initial prompt through its final answer. Treat the
agent's retrospective as a lead, not proof. Reconstruct consequential decisions
and failures from tool evidence, then inspect the delivered artifact directly.

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
4. **Design quality:** Assess information architecture, hierarchy, typography,
   spacing, density, alignment, visual language, asset medium, evidence, and
   required fidelity.
5. **Rendered integrity:** Inspect representative compositions and states for
   overlap, clipping, text or glyph bounds, and recovery side effects.
6. **System coherence:** Where evidence establishes coordination value, assess
   component and token boundaries, contracts, instances, bindings, and usage.
7. **Execution and verification:** Require scoped calls, stable identities,
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
- Do not equate quality with decoration, imagery, shadows, gradients, depth, or
  a named style. When evidence establishes a specific asset role or medium,
  reject an unrelated primitive substitute.
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
5. Repeat the clean run in a fresh task and verify the live artifact.

For cross-run convergence, retest with materially different design evidence.
Require the authoring path to carry distinct, well-grounded directions; do not
require every result merely to avoid a prior style.

Conclude with a short record of the tested revision and runtime, prompt,
observed evidence, root cause and owning layer, change, automated checks,
forward-test result, and remaining uncertainty. Do not call a round successful
without verified runtime identity and screenshot pixels.
