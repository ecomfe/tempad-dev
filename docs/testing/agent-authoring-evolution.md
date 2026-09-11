# Evolving agent authoring by trustworthy judgment

This is the runbook for improving the live Figma authoring experience. Use it
when preparing, running, reviewing, or asking someone to test an end-to-end
authoring task.

The process is intentionally small:

> experience the result, judge the whole, investigate what matters, make the
> smallest justified change, then learn from a materially different task.

Runtime proof and a thin run log make the experience trustworthy. They do not
replace judgment and must not grow into a second product-quality rubric.

## Why this process exists

Authoring quality is not a list of independently measurable parts. A useful
page is experienced as a coherent whole: the hierarchy, content, interaction,
visual language, and editability make sense together. We can inspect pixels,
layers, tool calls, and timing, but their meaning comes from how they contribute
to that whole.

This follows Michael Polanyi's distinction between focal and subsidiary
awareness in [The Structure of
Consciousness](https://www.polanyisociety.org/mp-structure.htm): we attend from
particular clues to an integrated object. Pulling every clue into focal
attention can destroy the meaning we were trying to understand.

Applied here:

- **Focal:** Would this authored result serve the person who requested it?
- **Subsidiary:** The screenshot, native layer structure, variables,
  components, effects, tool trace, timing, and runtime identity that support or
  challenge that judgment.
- **Diagnostic:** One subsidiary clue becomes focal temporarily when a concrete
  defect needs an explanation.

This yields a five-part framework for both the authoring skill and its
evaluation:

| Layer               | What belongs there                                                                             | Guidance form                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Intended experience | The person, situation, product behavior, and coherent authored result                          | One outcome, held focal                                       |
| Evidence            | Brief, code, real-product pixels, source artifacts, professional knowledge, rendered result    | Clues to integrate, not boxes to tick                         |
| Judgment            | Synthesis, composition, interaction, visual language, representation, and stopping             | High freedom with situated questions                          |
| Integrity           | Scope, permission, identity, provenance, native semantics, serialization, and observed defects | Explicit boundaries and deterministic checks                  |
| Evolution           | Transfer across representative tasks and the smallest general correction                       | Evidence-driven replacement or removal, not rule accumulation |

The framework is deliberately asymmetric. Integrity can often be stated and
tested explicitly. Design judgment cannot be reconstructed by enumerating all
of its particulars; instructions should help the agent attend to the right
reality and own the synthesis, not attempt to contain the finished design in
prose.

This is a design heuristic inspired by Polanyi's account of human knowing, not
an empirical claim that an LLM has human tacit knowledge. Its value must be
established by actual authoring outcomes.

Use explicit constraints for concrete invalid outcomes and precise mechanics
for selected tools. Use short questions where they change what the agent
notices. Concrete demonstrations can also teach a difficult distinction:
preserve their situation, evidence, consequence, and limits so they do not turn
into a preferred visible answer. A syntax example belongs beside its mechanic;
a historical design case belongs in evaluator evidence, not the always-loaded
skill. Avoid making a sentence classification system another compliance task.

The evaluator's judgment is personal but not arbitrary. They must own it,
describe what they experienced, point to the evidence that mattered, and remain
open to correction. Automated graders can assist with exact properties, but
must be checked against expert human judgment rather than treated as the source
of taste; see OpenAI's guidance on [graders and grader
hacking](https://developers.openai.com/api/docs/guides/graders#grader-hacking).

## First principles

1. **Start with the user-visible whole.** Do not begin by filling a rubric.
2. **Use evidence to answer questions.** Do not collect evidence merely because
   it is available.
3. **Automate truth, not taste.** Runtime identity, chronology, prompt identity,
   and artifact references are exact. Product quality is contextual.
4. **Preserve discovery.** An open run may surprise us. It does not need a
   predicted winner or a predeclared list of acceptable findings.
5. **Compare only to resolve a decision.** A controlled pair is an instrument,
   not the default shape of evaluation.
6. **Change the owning layer.** Fix tools and product behavior in code. Change a
   skill only when the missing behavior is general agent guidance.
7. **Protect variation.** Never turn one good output into a mandatory template.
8. **Prefer transfer over repetition.** The next materially different task is
   stronger evidence than repeatedly polishing the same prompt.
9. **Match specificity to risk.** Keep creative and product decisions at high
   freedom; use exact instructions only for permissions, integrity, fragile
   mechanics, and observable correctness.
10. **Diagnose relationships before motifs.** A visible symptom matters through
    its effect on product use, attention, representation, or coherence. Its
    opposite is not automatically a general solution.

Official eval guidance similarly recommends representative tasks rather than a
demonstration set detached from real use; see [Working with
evals](https://developers.openai.com/api/docs/guides/evals).

## The loop

### 1. Choose the question

State one plain-language intent for the run. Examples:

- "See whether a fresh request becomes a useful, coherent editable page."
- "Find out whether the agent can reuse an existing component without losing
  the requested hierarchy."
- "Resolve whether the bounded skill change improves transfer to a new
  dashboard brief."

Choose the lightest evidence situation that can answer it:

- **Open run:** Observe the whole product experience. This is the default live
  run.
- **Probe:** Isolate a specific capability or failure mechanism. Use this after
  a holistic judgment gives a reason to inspect something narrower.
- **Comparison:** Run the same fresh task twice only when an unresolved choice
  really requires a baseline and candidate.

These are descriptions, not lanes, maturity levels, or gates. A run can reveal
something outside its original intent.

Do not run live Figma merely to validate deterministic infrastructure. Schemas,
runtime fingerprints, bridge rejection, parsers, and log integrity belong in
automated tests.

### 2. Author a fresh task

For a net-new open run, choose the platform as part of representative sampling,
then use its stable request wrapper:

```txt
Desktop: Use the current blank Figma page to design a native, editable desktop application result for {simple product situation}. Research relevant real products and choose a fitting visual direction, then create an independent design. Complete it yourself with the connected TemPad Dev MCP tools.

Mobile: Use the current blank Figma page to design a native, editable mobile application result for {simple product situation}. Research relevant real products and choose a fitting visual direction, then create an independent design. Complete it yourself with the connected TemPad Dev MCP tools.
```

Change only the platform and product situation unless a probe or comparison needs
one additional constraint. Describe one central user situation in plain
language; do not turn the theme into a compact feature checklist or enumerate
the expected controls, content, states, layout, component policy, verification
steps, or visual prohibitions. The agent owns figuring out the product,
interaction, and visual direction through research and judgment. Add one short
broad direction only when the question specifically concerns it. Routinely
chaining restrained adjectives such as calm, precise, warm, or quietly
confident covertly samples the same house tone even when the product nouns
change. Do not prescribe dimensions or require exactly one screen. The agent
must choose the smallest complete screen or flow and decide whether the
application uses natural document flow, a fixed viewport shell with owned
scrolling regions, or a hybrid, based on how the real product's content and
interactions behave.

Vary the platform or form factor, product archetype, central interaction,
content medium, and intended experience through the theme, not only the
fictional domain or nouns. Do not let the stable wrapper make desktop the
default sampling platform. Before freezing a task, glance at recent notes.
Changing from one data-rich workflow to another while retaining the same
inspect/compare/decide structure is not a materially different task. If the
same shell, selected-object relationship, decision flow, density, or restrained
house tone would still satisfy the request after swapping the content, choose a
different theme. Diversity is a property of the sampled tasks over time, not a
quota inside one artifact. The stable wrappers keep evaluator brief-writing
from becoming the hidden designer; they are not a suite of expected answers.

Keep open-run sampling centered on representative web and app design when those
are the product's primary use cases. Prefer ordinary product work before novel
fictional domains, and vary the way people work rather than merely swapping the
subject matter. Sample both occasional consumer journeys and frequent expert
work; judge the latter against inspected evidence of real expert products,
including their density and interaction economy, rather than a generic app
shell. Posters, editorial artifacts, and other edge formats can test transfer
occasionally; they do not substitute for evidence from ordinary product screens
and flows. Net-new blank-page work is only one mode: regularly test a concise
update request against supplied product code, pixels, or an established design
system as the nearest evidence.

For ordinary design work, let the agent research visual styles and interaction
patterns suited to the product context before choosing a direction. Do not trade
that grounding away for a faster run, and do not make the evaluator prescribe
the resulting aesthetic. Research is still not permission to reproduce a
benchmark's composition, copy, component inventory, or decorative devices. Ask
what underlying user need or relationship a reference serves, then let the
agent solve the new request independently.

An open run does not need an expected page name. Add one only when exact naming
is part of the request. A comparison freezes the same prompt and comparison
subject for both arms. It does not freeze a desired visual answer.

Create a small note immediately before dispatch:

```json
{
  "schemaVersion": 1,
  "id": "2026-08-29-control-room",
  "createdAt": "2026-08-29T09:15:00.000Z",
  "kind": "open",
  "agent": { "model": "gpt-5.6-sol", "reasoningEffort": "xhigh" },
  "intent": "See whether the request becomes a coherent editable control room.",
  "task": {
    "prompt": "Use the current blank Figma page to design a native, editable desktop application result for a regional rail dispatcher coordinating service during a storm. Research relevant real products and choose a fitting visual direction, then create an independent design. Complete it yourself with the connected TemPad Dev MCP tools."
  }
}
```

Freeze the actual intended model and reasoning effort in `agent`; the values
above identify the historical Sol Extra High series, not a global model default.
New starts require both fields. Dispatch with those settings and verify the
rollout's actual turn contexts. A model or effort change is a new experimental
condition, even when the skill and prompt are identical.

For a comparison only:

```json
{
  "kind": "comparison",
  "comparison": {
    "id": "comparison-2026-08-29",
    "arm": "candidate",
    "subject": "bounded hierarchy guidance"
  }
}
```

### 3. Establish a trustworthy runtime

Before every live dispatch:

1. Build the affected packages and generate the development plugin when any
   generator input changed:

   ```sh
   pnpm build
   pnpm agent-plugin:dev
   ```

2. Replace the installed `tempad-dev-dev` plugin rather than assuming a fresh
   task reloads it:

   ```sh
   pnpm agent-plugin:reinstall
   ```

   This is the normal replacement path. Do not add `--restart-codex`
   preemptively: it is a recovery option only after the plain command reports
   that the Codex CDP endpoint is unavailable. A reachable endpoint with a
   missing or ambiguous page target must be fixed without restarting Codex.

3. Reload the development browser extension and the intended Figma tab. Keep
   one intended live Figma tab and file active.
4. Confirm the extension is connected to the same checkout's Hub.
5. Start the run. This executes preflight, freezes the note, and appends both to
   the run log atomically:

   ```sh
   pnpm agent-eval:log start \
     --note /absolute/path/to/note.json \
     --log /absolute/path/to/authoring-runs.jsonl
   ```

The start command rejects stale or partial checkout processes, multiple Hubs,
an inactive or mismatched extension, and an installed development-plugin
version different from the generated cachebuster. It stops before page creation
on failure.

For diagnosis, preflight can also run alone:

```sh
pnpm agent-eval:preflight \
  [--checkout /absolute/path/to/checkout] \
  [--app-path /Applications/ChatGPT.app]
```

On macOS, preflight queries the configured desktop app's bundled Codex CLI
(`CODEX_APP_PATH` or `/Applications/ChatGPT.app` by default), so plugin identity
comes from the host under evaluation rather than an unrelated `codex` on `PATH`.

Do not edit the frozen note. Abandon it with a plain reason if the run can no
longer proceed:

```sh
pnpm agent-eval:log abandon \
  --note-id <id> \
  --reason "what prevented a trustworthy run" \
  --log /absolute/path/to/authoring-runs.jsonl
```

### 4. Dispatch without steering

1. Create an isolated evaluation page in the intended Figma file with
   `apply_canvas({ mode: "create", page: { pageKey, name } })`. Use a unique
   stable key and name derived from the fresh task. Then call
   `apply_canvas({ mode: "activate", page: { pageKey }, selection: [] })` so
   page creation and editor context are both explicit MCP operations. Require
   the returned page context to prove that the page is active with zero children
   and an empty selection; do not use browser automation for this setup.
2. Leave it empty for net-new work. For an update task, seed only the source
   artifact named by the frozen task, record its node identity, and do not
   improve or pre-solve it.
3. Complete every reload, page navigation, and selection needed for dispatch,
   then prove the context the unscoped task will receive:
   - For an update, make one unscoped current-selection read and require it to
     return the intended source root or containing fixture on the intended
     page. Re-read the exact source identity and every deliberately protected
     sibling or root only after that proof. Exact node-ID reads establish those
     nodes' state, not what an unscoped task will receive.
   - For a net-new empty page, keep it empty. Record the page name and ID, call
     `get_structure({ pageKey })`, and require its page context to report
     `active: true`, `childCount: 0`, and `selectionCount: 0`. Then require the
     unscoped read to reject with `INVALID_SELECTION`. Do not create a disposable
     proof node merely to make the read succeed.

   This final check is the baseline: an earlier screenshot does not prove
   dispatch context. If the page, selection, or fixture is wrong, do not
   dispatch; recreate it on a fresh page or abandon the run.

4. Create a new native Codex task from the main app window, using the frozen
   model and reasoning effort. A task inherits the
   host's automatically invokable skill catalog. Before dispatch, remove an
   unintended overlap at its owning skill policy or use an isolated host
   profile; a broad auxiliary trigger that also matches Figma application work
   is a test confound, not product evidence. Do not add counter-instructions to
   the frozen prompt to suppress it. After dispatch, fingerprint the presented
   catalog with `pnpm agent-eval:skills <rollout.jsonl>` and record any
   unexpected loaded skill in the review.
5. Send the frozen prompt once.
   The dispatched task must complete the work itself. If it creates, forks,
   hands off, or messages another native task to continue the work, task and
   prompt identity have changed; quarantine the touched page and finish the run
   as invalid.
6. Do not coach, repair, or add hidden requirements while the task is running.
7. Record the Codex task ID and resulting Figma page ID.

Keep every operational identifier visible to the dispatched task semantically
neutral. Use the product theme plus an opaque uniqueness suffix for its native
task title, projectless working directory, `pageKey`, and page name; do not put
`eval`, `evolution`, round numbers, comparison arms, or desired outcomes in
them. Task metadata, the working directory, and Canvas page context are part of
the agent's evidence and can otherwise leak into product names or copy. Keep the
run identity in the frozen note and run log instead.

Unknown, duplicated, or apparently failed dispatches may still execute. Treat
the outcome as unknown until the task identity and target page are confirmed.
Never immediately resend the same authoring request. Quarantine any page touched
by an unknown run and start again with a fresh note and prompt.

If the evaluator intervenes, changes the brief, or repairs the page, mark the
run invalid. The intervention can still teach us something, but the result is
not independent evaluation evidence.

### 5. Experience the result before dissecting it

Review the page at a realistic zoom and ask:

> Does this feel considered for this request, or merely acceptable after its
> product name and content were swapped, and why?

Write the answer in ordinary language. There is no required number of findings,
no score, and no fixed set of axes. A short judgment is acceptable when the
answer is clear; a longer one is warranted when the experience is mixed.

Judge against the standard of a strong contemporary product design, not the
average of recent runs. Completeness, legibility, domain-specific copy, clean
geometry, and improvement over a weaker result are necessary clues, but they do
not by themselves make a design considered.

Experience the artifact as an application, not a filled frame. When page extent
matters, ask whether its natural flow, full-viewport shell, or hybrid scrolling
model follows the actual work and would remain coherent as the window or
content changes. Exact alignment with the captured frame edge is not evidence
of completeness.

Only then inspect enough evidence to support or challenge the judgment:

- Render the target page or important regions when visual hierarchy, density,
  overflow, legibility, or craft matters.
- In the rollout inspection, a non-null `timing.lastApplyToOpenedScreenshotMs`
  indicates that an image under the TemPad asset path was opened after the
  final successful Canvas call. This path/timing heuristic does not establish
  screenshot provenance, capture freshness, target coverage, or good judgment.
  Confirm the screenshot call, target, capture order, and actual opened pixels
  when final visual verification matters.
- Treat a passed structural verification as evidence only for the condition it
  checked. It does not prove spacing quality: inspect whether rendered content
  preserves its intended insets and rhythm, especially where fixed-size parents
  can consume declared padding without crossing their bounds.
- Inspect native structure when editability, reuse, layout behavior, variables,
  or component use matters.
- Inspect rollout and tool evidence when attribution, discovery, runtime, or
  failure mechanism matters.
- Compare two artifacts side by side only for a declared comparison.

A research call proves an attempt, not grounding. When a claimed precedent
matters, confirm that the task actually received and inspected the relevant
product state, implementation, or specification. A subject or content image
establishes only what it depicts; it cannot by itself establish the surrounding
application or page behavior, composition, interaction economy, or visual
language. Connection errors, interstitials, screenshots that were never emitted
or opened, and textual help pages do not establish a visual precedent. Then ask
what material expectation the evidence created and where it bears on the
artifact. If nothing consequential changed or was confirmed, record attempted
research rather than a grounded precedent; a reasoned product-specific departure
remains legitimate.

Do not inventory every component, variable, effect, timing field, or tool call.
Their presence is not a quality quota. Ask instead how a particular clue affects
the usefulness of the whole.

Treat descriptions such as "no icons," "too many colors," "large rounded
buttons," or "only text and boxes" as observations, not proposed skill rules.
Ask whether the representation supports recognition and interaction economy,
whether attention follows task importance, whether spacing expresses the
intended relationships, and whether inspected evidence actually shaped the
result. Different visual styles can satisfy those relationships. Evaluation
should expose the mismatch without prescribing its visible inverse.

### 6. Separate judgment from diagnosis

A useful review makes the relevant parts of this account clear in prose:

- What was the overall experience?
- What evidence most affected that judgment?
- What explains the important success or problem, if explanation is needed?
- What should happen next?

These are prompts, not required sections or axes. Omit anything that adds
nothing. There is no required quantity of evidence or findings.

When a defect matters, trace it narrowly:

1. Identify the visible or structural symptom.
2. Find the earliest point where the agent could have acted differently.
3. Decide whether the cause is product behavior, tool capability, missing
   context, skill guidance, runtime failure, or simply legitimate variation.
4. Stop inspecting once the evidence discriminates between plausible causes.

Runtime validity is a prerequisite, not a quality judgment. A beautiful result
from an unprovable runtime is an invalid run, not a passing one. A valid runtime
does not make a weak result good.

### 7. Complete the thin run record

Write a review file:

```json
{
  "schemaVersion": 1,
  "noteId": "2026-08-29-control-room",
  "status": "valid",
  "assessment": "The page ...",
  "nextAction": "Keep the behavior and test a denser planning task.",
  "artifacts": {
    "taskId": "...",
    "pageId": "...",
    "pageName": "...",
    "evidence": ["/absolute/path/to/page.png", "native structure for page ..."]
  }
}
```

Then append the result with the task rollout:

```sh
pnpm agent-eval:log finish \
  --note-id <id> \
  --review /absolute/path/to/review.json \
  --rollout /absolute/path/to/rollout.jsonl \
  --log /absolute/path/to/authoring-runs.jsonl
```

A new valid finish checks that the rollout began after the note was frozen,
contains one original task prompt, matches the session task ID and frozen
model/effort, and has matching extension/runtime and presented TemPad skill
locator evidence. Every successful `apply_canvas` result must carry runtime
identity. Malformed JSON, additional task prompts, missing settings,
and changes within the recorded execution fail this integrity check. An invalid
finish may omit rollout and artifacts if dispatch identity is unknown.

Keep these proof boundaries explicit:

- A presented skill locator proves catalog exposure, not that the skill was
  loaded completely or that its bytes match a past source snapshot. Inspect
  successful reads and retain the candidate source revision/diff when attribution
  depends on skill content. A cachebuster alone is not a content hash.
- Page IDs and evidence strings in a review are retained reviewer assertions;
  the log does not independently authenticate their pixels or native contents.
- The execution inspector recognizes native host message envelopes. Unrecognized
  formats or external intervention require manual investigation, not guessed
  settings or fabricated evidence.
- Existing records without `agent`/`execution` remain readable under their old
  checks, including legacy comparison catalog matching. They gain no new proof
  retroactively. Reinspect their original rollouts for model or prompt claims;
  never rewrite old records to imply checks ran at dispatch.

`valid` means trustworthy enough to review under those checks, not a good design,
compliance with every skill instruction, or evidence that a candidate improved.

The log is useful for provenance and memory. It is not a ledger of merit. Its
summary reports only run status and kind:

```sh
pnpm agent-eval:log check /absolute/path/to/authoring-runs.jsonl
pnpm agent-eval:log summary /absolute/path/to/authoring-runs.jsonl
```

Do not aggregate prose judgments into pseudo-precise success rates, quality
scores, percentiles, or promotion rules. Read the artifacts and reviews.

### 8. Choose the smallest justified change

Possible outcomes include:

- keep the current behavior and learn from a different task;
- fix a deterministic product or tool defect;
- improve missing context or observability;
- make one bounded skill change;
- run a narrow probe because the cause is still unclear;
- run a controlled comparison because a real choice remains unresolved;
- make no change because the result is legitimate variation.

Do not force every run to produce a change. "No change" is often the correct
conclusion.

## Skill-change guardrails

The authoring skill shapes an open-ended creative process, so skill changes have
a higher bar than ordinary bug fixes. A skill edit is justified only when all of
the following are true:

1. The observed issue is important to the user's result.
2. Runtime and tool failure have been excluded.
3. The agent had the capability and context to succeed.
4. The missing behavior generalizes beyond the observed prompt or visual style.
5. A small instruction can express the principle without prescribing the
   artifact.
6. The change does not duplicate guidance already present.
7. The instruction remains valid across materially different legitimate visual
   styles. If reversing its named motif could also be correct for another brief,
   move that choice to task evidence instead of the general skill.
8. The instruction improves what the agent notices, preserves, or verifies
   without supplying the design answer it is supposed to discover.

Prefer principles, questions, decision boundaries, and stop conditions. Avoid:

- naming the source task, benchmark, screenshot, or favored composition;
- mandating particular components, sections, colors, effects, or counts;
- adding a new rule for every observed symptom;
- converting examples into universal requirements;
- repeating one instruction in several reference files;
- fixing a tool limitation by telling the agent to work around it forever.

For every skill edit:

1. State the general behavior it changes and why code is not the owning layer.
2. Search for overlap and simplify or replace existing text before adding text.
3. Explain the decision the text changes. Keep exact constraints, orienting
   questions, selected mechanics, or a necessary contextual demonstration;
   remove text that merely restates generic expertise or earlier instructions.
4. Reverse-test visible advice: if its opposite can be right for another
   legitimate brief, replace it with the relationship or question that decides
   between them.
5. Prefer the smallest edit that changes the decision boundary.
6. Record `skillChangeRationale` in the review.
7. Regenerate the development plugin and inspect synchronized tracked output:

   ```sh
   pnpm agent-plugin:dev
   ```

8. Test transfer on a materially different fresh task before claiming behavioral
   improvement. Keep a mechanically verified but untested rewrite explicitly
   provisional. Do not validate solely by replaying the source prompt.
9. Revert or simplify the instruction if it reduces legitimate variation,
   causes formulaic output, or merely moves the failure elsewhere.

The desired trajectory is often fewer, sharper instructions—not a monotonically
growing skill.

## Comparison discipline

Use a baseline/candidate pair only when ordinary judgment and a probe cannot
resolve a specific decision. Both arms must use:

- the same newly authored prompt and comparison subject;
- the same model and relevant settings;
- the same supporting skill context, with only the intended skill content
  varied; normalized locator equality does not establish supporting file-byte
  equality, so preserve those snapshots when a content change is plausible;
- the same checkout runtime and active extension identity;
- separate isolated pages and native Codex tasks;
- no mid-run steering.

Review both completed artifacts as wholes before inspecting traces. Describe the
tradeoff in prose. A pair can inform judgment, but it cannot establish a general
law; transfer still requires a different task.

## Learn without converting the archive into a template

Read successful and unsuccessful cases as situated examples. Start with the
artifact and brief before reading the earlier verdict. Preserve disagreements
with that verdict in prose. Choose contrasts that explain a real decision:
source adaptation versus system substitution, meaningful visualization versus
plausible decoration, or a state change propagated versus merely relabeled.
Do not present historical winners to the authoring agent as desired answers in
an independent run.

A novel product noun does not make every run a transfer test. Vary the work,
source conditions, platform, and resource responsibilities when selecting the
next question. Freeze a candidate long enough to learn from distinct tasks;
if several instructions change between every run, treat the sequence as
exploration and do not attribute a later success to one sentence. Representative
repeats are justified when stochastic variation is the unresolved question;
use a declared comparison under the existing prompt-identity rule rather than
quietly repeating an open run.

Keep the case archive and any retrospective analysis outside the distributed
skill. The [September 2026 review](agent-authoring-review-2026-09.md) records
one such analysis, its evidence limits, and provisional changes.

## Finishing one evolution round

A round is complete when:

1. the question was answered with the lightest sufficient evidence;
2. deterministic checks ran at the owning layers;
3. any needed live run has trustworthy provenance and reviewable artifacts;
4. the product judgment and next action are stated plainly;
5. any change is minimal, placed at the owning layer, and verified;
6. a skill change, if any, has a transfer plan that protects variation.

End the round by asking whether the process helped us see the product more
clearly. If the record-keeping took more effort than experiencing and explaining
the result, simplify the process before adding another field.
