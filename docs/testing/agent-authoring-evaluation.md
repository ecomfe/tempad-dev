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

- Canvas HTML creates and updates the intended native structure predictably.
- Failures are bounded, diagnosable, and recoverable without corrupting prior
  state.
- Content, states, assets, and unaffected relationships survive creation,
  updates, and repairs without unintended overlap, clipping, or text/glyph
  cropping.
- The result uses Figma-native semantics rather than only resembling the
  intended pixels.
- When demonstrated usages contain decisions that should evolve together,
  components, variables, and styles coordinate them at a useful semantic
  boundary. Judge value and coverage, not resource counts.

Do not use this loop to standardize a visual style, product-domain UX rule,
platform convention, component count, asset source, or design process. Those
decisions come from the user, project evidence, an applicable domain skill, or
targeted research. Repetition and similarity are component evidence, not a
threshold; responsibility, states, ownership, expected evolution, and
coordination cost also matter.

## Establish a valid runtime

Follow the agent-plugin workflow in `AGENTS.md` for build, generation,
installation, and Figma refresh commands. Record the source revision or
working-tree state and which runtime layers changed.

Run the evaluation in a normal fresh UI task and establish that:

- the installed development plugin contains the intended cachebuster and skill;
- the task is served by the intended MCP runtime, not a stale CLI, detached Hub,
  or socket;
- TemPad tools are directly callable;
- the target Figma tab runs the refreshed extension and has reconnected to MCP.

A task that starts successfully but cannot prove these conditions is not a
valid evaluation.

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

## Review the complete run

Read the thread from the initial prompt through the final answer. Treat the
agent's retrospective as a lead, not as proof. Reconstruct consequential
decisions and failures from tool evidence, then inspect the delivered Figma
artifact directly.

Review the run along these transferable axes:

1. **Outcome and preservation:** Did the result satisfy the task and preserve
   supplied content, states, assets, and unaffected relationships?
2. **Native representation:** Did the chosen layout, text, paint, media,
   resource, binding, component, and instance semantics express the intended
   result rather than merely approximate its appearance?
3. **Rendered integrity:** Did visual inspection cover the representative
   composition and relevant states, including overlap, clipping, text/glyph
   bounds, and changes caused by recovery?
4. **System coherence:** Where task evidence established coordination value,
   did components and tokens model it with appropriate boundaries, contracts,
   instances, bindings, and usage coverage?
5. **Execution and verification:** Were calls scoped, identities stable,
   failures non-destructive, retries evidence-driven, and conclusions based on
   actual pixels and native structure rather than mutation counts or intent?

Separate observed facts from hypotheses. Record the earliest state that
violated an invariant, not only the final symptom. Different triggers may
expose the same identity, ownership, transaction, or serialization defect.

## Place the fix at the owning layer

Classify each confirmed finding before changing anything:

| Finding                                                                     | Owning response                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Parser, schema, transaction, identity, layout, or serialization defect      | Fix the implementation and add a behavior-level regression test.                                   |
| A valid mechanical contract is hard to discover or diagnose                 | Improve the tool schema, error, or focused protocol reference.                                     |
| Agents repeatedly miss a transferable workflow cue or verification boundary | Add the smallest useful branch or cue to the authoring skill.                                      |
| A stale plugin, MCP, Hub, extension, or Figma session affected the run      | Fix the test/runtime lifecycle; do not compensate in design guidance.                              |
| Product, platform, accessibility, content, or visual-design judgment        | Leave it to task evidence, research, or a relevant skill unless TemPad prevents the chosen result. |
| A one-off taste difference violates no evidence or contract                 | Record it without making it a platform requirement.                                                |

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

Conclude with a short record of the tested revision and runtime, prompt,
observed evidence, root cause and owning layer, change, automated checks,
forward-test result, and remaining uncertainty. Do not call a round successful
when runtime identity or screenshot pixels were not verified.
