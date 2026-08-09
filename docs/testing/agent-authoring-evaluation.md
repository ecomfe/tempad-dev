# Agent authoring evaluation loop

Use this runbook to forward-test or review changes to TemPad's Figma authoring
MCP, agent plugin, or authoring skill. It complements automated tests: the test
subject is a fresh agent completing a realistic task through the installed
runtime, not an agent reviewing an implementation diff.

## Evaluation boundary

Evaluate whether the MCP and skill form a dependable Figma authoring platform:

- Canvas HTML can create and update the intended native structure predictably.
- Failures are bounded, diagnosable, and recoverable without corrupting prior
  state.
- Rendered content remains intact: no unintended overlap, clipping, glyph
  cropping, asset substitution, or loss introduced by a repair.
- Reusable responsibilities are modeled at an appropriate semantic boundary,
  and their usages are native instances when components are part of the
  deliverable.
- Variables and styles express the design decisions that should remain
  coordinated, without manufacturing a token system from arbitrary literals.

Do not use this loop to standardize a visual style, product-domain UX rule,
platform convention, component count, asset source, or design process. Those
decisions come from the user, project evidence, an applicable domain skill, or
targeted research. Repetition and similarity are evidence for a component, not
a threshold; abstraction value also depends on responsibility, states,
ownership, expected evolution, and coordination cost.

## Establish a valid runtime

Before evaluating behavior, prove that the task is using the intended build.
Record the source revision or working-tree state and which of these layers
changed:

- For shared skill, manifest, icon, or marketplace changes, run
  `pnpm agent-plugin:dev` and reinstall the generated development plugin in the
  active host. A CLI installation outside a running Desktop app updates disk
  state but does not by itself prove that the app refreshed its plugin cache.
- For MCP changes, build or run the current working-tree MCP and start a fresh
  task or reload the plugin runtime. Confirm that no stale MCP CLI or detached
  Hub process/socket is serving the test.
- For extension changes, rebuild or use the watcher, refresh the target Figma
  tab, and wait for MCP reconnection. Agent-plugin reinstall does not reload an
  already-open extension page context.

Use a normal fresh UI task. Verify the installed plugin/cachebuster, a newly
started MCP runtime, direct availability of the TemPad tools, and the refreshed
Figma extension before counting the run. A task that starts successfully but
cannot call the intended tools is not a valid evaluation.

## Run a clean task

Give the test agent a realistic user request with only task-local context.
Do not reveal the suspected defect, intended fix, expected tool sequence, or
desired answer. Otherwise the run tests reconstruction of the maintainer's
reasoning rather than generalization.

Preserve the raw evidence:

- the exact user prompt and any supplied references;
- the full conversation, tool inputs and outputs, errors, retries, and recovery
  path;
- the final Figma structure and relevant native resources;
- representative screenshots whose pixels were actually opened and inspected.

Use a fresh task for each independent run. When retesting a fix, vary the
surface details while preserving the capability under test. Avoid leaving
prior test artifacts where a later agent could discover and copy them.

## Review the complete run

Read the thread from the initial prompt through the final answer. Treat the
agent's retrospective as a lead, not as proof. Reconstruct each consequential
decision and failure from tool evidence, then inspect the delivered Figma
artifact directly.

Review the run along these transferable axes:

1. **Outcome and preservation:** Did the result satisfy the task and preserve
   supplied content, states, assets, and unaffected relationships?
2. **Native representation:** Did the chosen Figma primitives, auto layout,
   text, paints, media, resources, bindings, components, and instances express
   the intended semantics rather than merely resemble the screenshot?
3. **Rendered integrity:** Did visual inspection cover the representative
   composition and relevant states, including overlap, clipping, actual glyph
   bounds, and changes caused by recovery?
4. **System coherence:** Where reuse or a local design system was in scope, did
   components and tokens coordinate the decisions that should evolve together?
   Judge semantic value and coverage, not raw counts.
5. **Execution quality:** Were calls scoped and efficient, identities stable,
   failures non-destructive, and retries based on new evidence?
6. **Verification integrity:** Did the agent inspect actual pixels and native
   structure, or infer success from mutation counts, validation messages,
   resource links, or its own intent?

Separate observed facts from hypotheses. Record the earliest state that
violated an invariant, not only the final symptom. Similar authoring-key,
layout, or component failures may share one ownership or transaction invariant
even when their immediate triggers differ.

## Place the fix at the owning layer

Classify each confirmed finding before changing anything:

| Finding                                                                | Owning response                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Parser, schema, transaction, identity, layout, or serialization defect | Fix the implementation and add a behavior-level regression test.                                   |
| Mechanical contract is valid but hard to discover or diagnose          | Improve the tool schema, error, or focused protocol reference.                                     |
| Agent misses a recurring workflow cue or verification boundary         | Add the smallest transferable cue or branch to the authoring skill.                                |
| Stale plugin, MCP, Hub, extension, or Figma session                    | Fix the test/runtime lifecycle; do not compensate in design guidance.                              |
| Product, platform, accessibility, content, or visual-design judgment   | Leave it to task evidence, research, or a relevant skill unless TemPad prevents the chosen result. |
| One-off taste difference without violated evidence or contract         | Record it, but do not encode it as a platform requirement.                                         |

Use low freedom only for fragile protocol and integrity invariants. Use concise
heuristics for workflow decisions with several valid paths, and preserve high
freedom for contextual design judgment. Prefer one root fix over accumulating
symptom-specific checkpoints. Remove or revise guidance that only succeeds on
the test specimen. When the owning layer is a skill, apply the quality tests in
`docs/skill/rationale.md`.

## Close the loop

For a confirmed issue:

1. Add or strengthen an automated regression test when the behavior is
   deterministic.
2. Make the smallest change at the owning layer and update current-state
   documentation rather than appending a history of incidents.
3. Run the checks required by `TESTING.md` and the relevant package guide.
4. Rebuild, regenerate, reinstall, or refresh only the affected runtime layers.
5. Repeat the clean task in a fresh thread and verify the live artifact again.

Conclude with a short record containing the tested revision and runtime,
prompt, observed evidence, root cause and owning layer, change made, automated
checks, forward-test result, and remaining uncertainty. Do not call a round
successful when the runtime identity or screenshot pixels were not verified.
