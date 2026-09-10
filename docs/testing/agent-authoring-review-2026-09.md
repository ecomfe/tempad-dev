# Design in Figma workflow review (2026-09-05)

Retain the core workflow: real evidence → independent design → declarative native
changes → visual inspection and repair. Reduce repeated instructions asking the
agent to justify its design judgment, and assign exact checks to tools and the
harness. This rewrite is a candidate awaiting live transfer testing; improved
design quality has not yet been demonstrated.

## Evidence scope

The review covered the current release plugin, generator, authoring skill and
its capability references, MCP tool registration, Canvas compilation and
validation, runtime preflight, rollout inspector, and run log. Changes already
present in the working tree were preserved. The existing asset-reference split,
inset verification, and plugin-reinstallation fixes are not new capabilities
introduced by this review.

The local `.dev/agent-authoring/authoring-runs.jsonl` contains 76 starts:
74 finishes and 2 abandonments. Of the finishes, 73 were originally recorded as
valid and 1 as invalid. Session and turn-context records from all 74 original
rollouts were reparsed; their actual settings were consistently
`gpt-5.6-sol / xhigh`. These are execution facts, **not 73 successful designs**.

Selected reviews were examined for diagnosis, and the original PNGs were
reopened for cabin baseline/candidate, podcast repair, Square partial refund,
photo culling, photo compare update, and bank reconciliation. This was not a
fresh visual acceptance review of every artifact. The current Figma file was
not reread to establish that historical native trees remain unchanged. Claims
about native structure and external research require the corresponding
historical traces and reviews; earlier author statements are not treated as
new independent proof.

The existing inspector identified 665 `apply_canvas` calls and 124 failures
across the 74 traces. These counts indicate the amount of serialization and
execution behavior worth investigating. They span different skill versions and
task types and cannot serve as design-quality scores or measures of the new
candidate's effectiveness. Image classification uses path heuristics, which can
miss other image-delivery mechanisms and cannot authenticate screenshots.

## Applying the theory

Polanyi's account of tacit knowing suggests that explicit rules cannot exhaust
skilled activity. See [The Tacit Dimension](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html).
His distinction between subsidiary and focal awareness suggests attending from
clues to a meaningful whole, rather than permanently treating each clue as an
independent target. See [The Structure of Consciousness](https://www.polanyisociety.org/mp-structure.htm).

This informs the system design; it is not empirical evidence that an LLM has
human tacit knowledge. The practical implications are:

- **Keep the design itself focal.** The agent needs to inspect real products and
  its own result, beyond reading design principles. Relationships among
  controls, content, and states must hold in the artifact.
- **Make tools learnable and predictable.** Consistent syntax and recovery
  reduce the attention spent on operating the tool. Dialect details belong in
  conditional references, and local errors should provide actionable diagnosis.
- **Use explicit rules for concrete boundaries.** Identity, permission, source
  fidelity, references, native semantics, and serialization can be specified
  precisely. Palette, density, layout, and icon proportions require situated
  judgment.
- **Retain useful demonstrations.** Polanyi's account does not imply rejecting
  examples or expert guidance. Preserve a case's situation, consequences, and
  limits so it demonstrates how judgment develops without becoming a template.
- **Make judgment accountable.** Review the artifact before reading the earlier
  assessment, and allow disagreement. A model acting as both author and reviewer
  may share the same aesthetic biases; important conclusions should remain open
  to independent expert human judgment.

These choices align with the focused scope, clear triggers, and progressive
loading in [OpenAI's skill guidance](https://developers.openai.com/codex/skills),
and with the task-dependent degrees of freedom and real-execution validation in
[Anthropic's skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
Shorter instructions are not inherently better. The intended change removes
repeated demands on attention while preserving environment facts that affect
behavior.

## Findings and changes

### P1: Comparisons did not lock actual model settings or match review task IDs to sessions

Run notes and finish evidence previously omitted model and reasoning effort.
Comparison validation checked only the prompt, runtime, and skill catalog or
context. Runs using different models could therefore be treated as a controlled
comparison. A review needed only a nonempty task ID, and an additional user
instruction did not automatically invalidate the original prompt hash when a
delegated prompt was present.

Source-record identity checks now require new notes to freeze `agent.model`
and `agent.reasoningEffort`. Finish validation checks the session ID, actual
turn settings, exactly one original task prompt, its hash, and parsing issues.
Model or effort changes, additional prompts, incorrect task IDs, and malformed
JSON prevent a new run from being marked valid. New comparisons also check
model and effort. Missing values remain unknown rather than being inferred.

Historical records remain readable in their original format without
manufacturing retrospective proof. Reinspection found that the already-invalid
photo-duplicate run lacked an independent original task prompt; the other
73 rollouts passed the new identity-extraction checks.

### P1: Catalog exposure and image paths were described as stronger verification than they provide

The authoring locator in `buildRolloutEvidence` comes from the **presented
catalog**. It does not prove that the agent successfully read the complete
skill. A cachebuster path is also not a content digest. The old comparison
fallback could accept different context fingerprints when the catalog and
normalized locator matched.

New execution records require an exact match of the normalized supporting
context fingerprint. The fallback remains only for compatibility with historical
records lacking execution evidence. The runbook now states that content
attribution requires the candidate source revision or diff and evidence of
successful reads. Supporting skill files are not all snapshotted byte for byte,
so complete content authentication is not claimed.

Similarly, `lastApplyToOpenedScreenshotMs` only indicates that an image under
the TemPad asset path was opened after the final successful Canvas call. It does
not establish capture freshness, target-root identity, complete screen coverage,
or even that the image is a screenshot. Documentation and inspector limitations
now state these boundaries. Evaluating final visual verification requires the
screenshot call, target, capture order, and actual opened pixels.

### P2: Useful integrity boundaries were mixed with repetitive, always-loaded design guidance

The entrypoint and visual-composition/style-grounding references repeated
whole-first judgment, template avoidance, real research, icon selection,
independent source use, and repair. Processing an extensive set of instructions
about how to judge before each composition may draw attention away from the
design itself. The entrypoint also included resource extraction, editing
recovery, and an unnecessary follow-up question about component work.

The guidance is now organized by the decisions that require it:

| File                                        | Responsibility                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`                                  | Outcome, evidence boundaries, resource paths, build/inspect loop, essential mutation boundaries                      |
| `style-grounding.md`                        | Unresolved product and visual questions, source authority, research stopping conditions, optional visual exploration |
| `visual-composition.md`                     | Working objects and states, attention, representation, visual diagnosis                                              |
| `editing.md`                                | Local updates, omission preservation, dependent states, unknown outcomes, recovery after rollback                    |
| `visual-assets.md` → icons/images/typefaces | Source, medium, import, and fidelity after an asset role is selected                                                 |
| Native/resource references                  | Exact mechanics and examples loaded for the selected Figma capability                                                |

The entrypoint decreased from 1914 whitespace-separated words at the start of
this review to approximately 1080. This measures reading burden, not quality.
Direct/Reuse/Author remains intact: the Kitchen source case demonstrated why
unrelated components in the same domain cannot replace the user's established
system. That relevance boundary was preserved.

### P2: Repeated wording changes made attribution weaker than the apparent progression suggested

Reviews such as podcast transcript and wall color recorded a gap between
research-tool activity and actual product evidence. The generated room image in
wall color served as useful product content, but did not establish that the
agent had inspected a real visualization product. Source identity and the scope
of what a source can establish remain necessary distinctions. Actual research
alone still does not guarantee a strong design.

The cabin baseline/candidate PNGs retained similar warm-white, dark-green, and
matrix/summary treatments despite mandatory visual synthesis. The extra
wireframes did not produce a discernible improvement. This supports removing
that ceremony; it does not establish that another mandatory ceremony would work
or justify prohibiting green, matrices, or right-hand summaries.

The podcast repair graphic looked plausible for audio software but used
waveform-like bars to represent frequency distribution over time. The
representation did not carry the intended meaning. Photo culling showed a
selected Compare state alongside a grid workspace; the later update changed
both the working surface and related controls into a two-image comparison.
These cases support checking working relationships and dependent states, rather
than adding domain-by-domain visual prohibitions.

The revised runbook separates exploration from attribution. If several changes
are made between every run, a later success provides exploratory evidence.
Holding a candidate stable across different task conditions makes transfer
judgments more informative. Declared comparisons can include repetition when
stochastic variation is the question; one outcome need not become a general law.

## MCP: Preserve declarative authoring and improve diagnosis

The six exposed tools cover design evidence, structure, system discovery,
native authoring, asset upload, and screenshots. Shared schemas define the
contracts, the server handles exposure and transport, and the extension handles
compilation, reference resolution, validation, native reconciliation, and
verification rollback. This division supports reasoning about desired state
without adding an arbitrary Plugin API execution tool.

Canvas HTML's familiarity can also cause negative transfer: agents may assume
full Tailwind support, CSS inheritance, and browser layout behavior in a native
dialect. Repeated trace rejections are a tool-usability concern and cannot
simply be attributed to agents failing to read the skill. The implementation
already aggregates static errors across the tree. This review therefore avoids
a separate preflight parser or validation tool that could introduce a second,
inconsistent dialect implementation.

The recurring typography-on-div error now has an actionable explanation:
Canvas typography does not inherit, so text utilities belong on each span/TEXT
node. The diagnostic covers both static aggregation and the compilation
safeguard, retains the existing error code and rejection semantics, and has a
regression assertion. Shared schemas and the server protocol are unchanged.

Further MCP changes should follow independent evidence:

- If remaining failures cluster around common CSS expressions with unambiguous
  native mappings, consider extending the existing compiler and verifying
  Figma semantics instead of permanently expanding the skill's exclusion list.
- If whole-root screenshots obscure important details, evaluate target binding,
  regional screenshots, or freshness metadata. Paths and screenshot-call counts
  cannot substitute for actual visual coverage.
- Keep `get_design_system` factual and let the agent determine task relevance.
  Automatic style selection, a `grounded` boolean, or a design score would not
  resolve contextual questions about source authority.

### P1: Runtime preflight could inspect a different Codex installation than the desktop host

The preflight invoked `codex plugin list` through `PATH`. On this host, that
resolved to Codex CLI 0.139 even though the active desktop app bundles 0.153.3.
The older executable rejected the desktop host's valid token-budget
configuration, so preflight stopped before it could evaluate the TemPad
runtime. This was a harness identity failure, not evidence that the candidate
plugin or Figma connection was invalid.

On macOS, preflight now resolves the bundled CLI from the configured host app
(`CODEX_APP_PATH`, `--app-path`, or `/Applications/ChatGPT.app`), records that
executable in its evidence, and lets run-log start forward the same override.
Other platforms retain the PATH lookup. A focused regression covers host-path
resolution. With the browser extension reloaded and the intended Figma tab
reactivated, the real preflight completed with matching generated/installed
plugin versions, extension fingerprint, and no issues.

This repair makes the dispatch gate trustworthy; it does not show that the
authoring candidate produces better designs. Keep the candidate stable and use
the next materially different live task to evaluate design behavior.

## Verification and candidate status

Verification completed during this review:

- `pnpm typecheck`, `pnpm lint`, and `pnpm test:run` passed, including real
  Chromium sandbox checks.
- `pnpm test:coverage --maxWorkers=2` passed with 1460 tests, 93.66% line
  coverage, and 87.25% branch coverage. The initial default-concurrency run hit
  an existing media test's five-second timeout. Lower concurrency passed
  without changing that timeout or the media implementation.
- The new identity parser is included in repository coverage. Focused
  regressions cover model drift, additional prompts, damaged records, task-ID
  substitution, and historical-format compatibility.
- Runtime preflight now uses and records the configured desktop host's bundled
  Codex executable on macOS; the focused preflight and run-log tests passed, and
  a real preflight completed successfully against the refreshed Figma runtime.
- Identity reinspection of all 74 original rollouts and historical run-log
  integrity checks produced the expected results.
- Skill frontmatter, reference paths, and `git diff --check` passed. The
  development plugin was regenerated, Codex and Claude were confirmed to use
  the same working-tree MCP runtime, and release configuration remains
  `@tempad-dev/mcp@latest`.

These mechanical checks do not validate live design quality.

At the completion of this review, no independent live Figma transfer run had
been performed with the new candidate, and the review had not replaced the
installed plugin. Follow the main runbook to refresh the runtime, freeze model
settings and prompts, and create isolated pages and fresh native tasks. Useful
next questions include:

- A previously unseen, ordinary consumer task: does actual product evidence
  materially inform a new composition?
- A local update with an established source and protected neighboring content:
  does the agent change only the relevant relationships?
- When Author needs validation, a resource task with meaningful differences
  among real consumers: does the native contract serve those usages?

These are sampling questions, not component inventories, expected layouts, or
acceptance criteria supplied to the author. The historical 74 runs support this
diagnosis; they cannot establish that the untested candidate performs better on
Sol or another model.

## September 8 reassessment: retention is not a quality verdict

The user's question was whether repeated positive reviews meant that neither the
skill nor MCP needed further work. They do not. This reassessment reads the
recent Astra/medium run records and reopens completed artifacts, including the
magazine reader, bakery checkout and collector update, garden planner, photo
book, voice journal, subtitle editor, bedtime choice, tennis scorer, and
classroom plan. The subtitle product reference was also reopened. It does not
rerun tasks, repair their pages, or rewrite their frozen reviews. It is a
bounded retrospective, not a new independent authoring evaluation.

### What actually changed

The recent sequence contains concrete failures and changes:

- `2026-09-07-wedding-seating-spatial`: a native-only rename returned without
  changing the name. A regression also exposed missing text projection. The
  fix belongs to Canvas reconciliation; the following bakery run incidentally
  confirmed root renaming in the live runtime.
- `2026-09-07-recipe-video-mobile`: polished preview and sharing screens left
  the central clip-assembly work behind an Edit clips destination. This led to
  replacing the existing composition question about the depicted working state.
  The broad prompt admitted automatic assembly, so the change remains a
  hypothesis about better scope selection, not a universal timeline requirement.
- `2026-09-07-bakery-collector-update`: adding collection details enlarged a
  represented phone from 390 × 844 to 390 × 1080. This led to replacing existing
  wording about document growth and the represented viewport.
- `2026-09-08-classroom-seating-desktop`: native-only stroke and corner updates
  could return success without applying the requested geometry. The regression
  failed before the fix and passed afterwards; typecheck, lint, the repository
  test suite, and build passed in that round. The original page retains the
  failure. This latest fix has not yet been observed in a new live task.

Consequently, “no skill edit this round” has sometimes accompanied an MCP code
fix. It must not be summarized as “nothing needs improvement.” The log's
`valid` status concerns provenance, not design quality. The change from
Sol/xhigh to Astra/medium also prevents attributing the later sequence to skill
changes alone.

### Where the evaluator was too accommodating

The strongest correction concerns `2026-09-07-magazine-reading-mobile`. Its
original review noticed the large heading and deletion of an offscreen authored
paragraph, yet still led with a considered reading experience. Reopening the
phone makes the tradeoff more salient: a person resuming a 21-minute article
still spends substantial screen space on publication identity, article title,
metadata, a resumption label, and a section title before reaching the body.
The result is legible, but I would now describe it as a polished reading concept
with unresolved immersion and content continuation. Preserving a bounded phone
is a narrower success. The later larger-type preservation probe answers its
specific update question; it does not retroactively settle the original reading
experience. This is a revised judgment, not a newly discovered data-loss claim.

The classroom plan is useful, but its large introductory area and very subtle
secondary room and seat labels also deserve more weight than a count of pupils
and empty desks. The failed stroke update specifically weakens the selected and
vacant seat distinctions the author intended. Its overall usability cannot be
inferred from coherent arithmetic. Conversely, the subtitle editor visibly
connects the working row, text editor, preview, and timeline; the scorer puts
point entry beside large scores and Undo. Those remain credible positive
judgments. A retrospective should preserve such distinctions rather than
manufacture a defect in every artifact.

Warm paper, muted green, serif openings, and gentle editorial copy recur across
several outputs. They suit some of the sampled situations, particularly the
voice journal. The problem is not the palette itself. Reviews repeatedly
acknowledged conventional styling or spacious headers and then dismissed the
concern because content fit. That substitutes adequacy for a stronger judgment
about attention and interaction. The current composition reference already
asks about familiar shells, density, environment, and interaction economy;
adding another generic instruction to “be less generic” would duplicate it.
The evaluator must apply those questions more carefully before proposing more
skill text.

### What the sequence has not tested well

Recent update cases mainly adapt previous generated artifacts: the dispatch
board, bakery checkout, reader, photo book, and scorer. These demonstrate useful
local preservation and state propagation, but give limited evidence about
working within an independently established product system, with existing
components, variable modes, instances, or heterogeneous supplied content.
Blank-page theme variation cannot close that gap. This is a sampling limitation,
not evidence that resource reuse is currently broken.

Similarly, successful small static states do not establish how dense or growing
content affects the composition. This does not turn a design task into a demand
for a functioning application or every possible state. It means that a long
reading task, repeated expert workflow, or source-backed update should be judged
against the relevant content and relationships, rather than allowing the author
to choose an especially convenient amount of self-authored content and calling
that broad transfer.

Repeated recoverable Canvas validation failures also remain developer-experience
evidence. Garden, subtitle, bedtime, and tennis runs recovered from payload
problems, but recovery does not make the first failure cost disappear. These
records do not yet prove that the grammar should accept conflicting utilities.
Any change should first distinguish an unambiguous normalization opportunity
from a real contradiction, and target the parser, diagnostic, or local syntax
reference as appropriate. More general design prohibitions would not help.

### Next decisions

The next code investigation should audit the supported native-only fields from
normalization through reconciliation and read-back. The rename/text and
stroke/corner incidents share a projection path; fixing just the newly observed
field each time leaves an obvious question about the rest of that contract.
Use deterministic public-handler regressions for applied values, explicit
clearing, omitted-value preservation, and no-op behavior where relevant. This
retrospective has not established another failing field and does not claim that
such an audit is already complete.

The next independent authoring question should concern an ordinary update to an
external, established product design, with supplied content that creates a real
layout or reuse decision. Choose a source the author can actually inspect and
keep the request concise. Do not disguise a desired layout as the test brief.
This is more informative now than the previously queued blank-page menu theme.

Keep the current authoring skill provisional while answering those questions.
The central-work and viewport changes have compatible subsequent examples, but
no controlled attribution. A comparison is warranted only if a concrete choice
about retaining or simplifying the wording remains unresolved; running more
unrelated attractive screens cannot settle that choice. Report future judgments
with the main product weakness or success first and the reason for the next
action next. Runtime proof can remain in the evidence record. No additional
quality score, checklist, or automatic promotion rule is needed.

## September 8 native-only update audit

The follow-up audited `CanvasBindingSchema` and `CanvasFigmaPropertiesSchema`
against native-only normalization, preflight, application, deferred references,
and verification. This was a deterministic code investigation, not another live
Figma run. No authoring-skill change or shared-schema expansion was needed.

Four classes of defect were reproduced and repaired:

- **Missing execution context:** Auto Layout's native spacing and reverse
  stacking properties reached the request but `applyLayout` returned because
  the synthesized spec had no layout. Native updates now project the existing
  linear layout mode without resetting padding, wrapping, alignment, or node
  topology. Counter-axis updates require an existing wrapping container;
  explicit zero, false, and synchronized `null` remain meaningful.
- **Missing validation:** native-only requests bypassed the markup compiler's
  node-type and property-capability checks. A Frame could receive Text, shape,
  section, group, Boolean-operation, component, or slot declarations and report
  success while applying only a sibling field such as its name. Unsupported
  Text corner/individual-stroke geometry and an exact font combined with a Text
  style also lacked the corresponding rejection. Validation now rejects these
  requests before mutation. A valid style-only update, followed by explicit
  unlinking and an exact font, remains supported and idempotent.
- **Lost component context and order:** adding a component property and binding
  an existing sublayer to it in the same native update failed preflight because
  the child's context saw only the old definition. Native specs now follow
  ancestor-before-descendant scope order, and preflight receives the supplied
  owner's desired property definition. The regression deliberately puts the
  sublayer entry before the component entry in the request.
- **Lost parent during deferred application:** a vector network with a
  canvas-key Pattern reference receives a later geometry pass. That pass omitted
  the live parent, so a requested matrix translation overwrote Auto Layout's
  translation. Passing the parent through deferred resolution preserves
  layout-owned translation while applying the requested transform axes and
  actual Pattern source identity.

The checked paths and their evidence boundaries are:

| Native state                                                            | Audit result                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, locking, aspect-ratio state                                       | Name projection was fixed earlier; shared layer setters consume locking directly. Capability validation now rejects missing native properties before application. Existing geometry/locking tests remain applicable.                                                   |
| Transforms                                                              | Both immediate and deferred passes were inspected; the new Pattern regression covers the lost-parent failure.                                                                                                                                                          |
| Auto Layout                                                             | New public-handler tests cover changed values, zero/false, synchronized spacing, omission, topology preservation, no-op repetition, and incompatible live layouts.                                                                                                     |
| Text                                                                    | Existing font/vertical-alignment projection and direct paragraph, case, list, hyperlink, and range setters were traced. New tests cover exact-font/style contradiction and explicit style unlinking. Existing whole-text and range regressions exercise their setters. |
| Shapes, strokes, corners                                                | Type declarations now match the actual node. The previous native-only stroke/corner regression remains intact; new negative tests cover unsupported Text geometry. Existing shape/vector tests exercise normalized geometry.                                           |
| Fills, strokes, effects, grids, guides                                  | These already consume direct native stacks; verification reads their retained values. The existing public native-only image test and stack/style replacement, omission, and clearing regressions remain applicable.                                                    |
| Components, instances, sections, groups, Boolean operations, slots, SVG | Each explicit declaration is checked against the live node type. Existing metadata/instance/container/import setters were inspected. The new component-property regression covers an owner and its existing sublayer in one update.                                    |
| Variables, styles, modes                                                | Native bindings already reach the shared binding setters and reference verification. The new style test checks application, unlinking, and repetition through the public native-only path.                                                                             |
| Masks and structural removal                                            | These remain outside native-only updates; the existing structural-operation boundary is retained.                                                                                                                                                                      |

This is field-path coverage, not a claim that every cross-resource transaction
or every Figma runtime normalization has been exhaustively tested. In particular,
the owner/sublayer regression does not establish arbitrary simultaneous changes
to definitions and separate instances. Mock-based read-back also does not replace
future live evidence about the design experience.

The new public-handler regressions reproduced the reported failures before their
respective fixes. There are 17 added test cases; all 229 Canvas tests pass.
Repository typecheck, lint, test:run, and build:ext pass, including the Chromium
sandbox checks. Verification is recorded in
`.dev/agent-authoring/2026-09-08-native-update-audit/`, together with the original
source snapshots, failing/passing logs, and a patch isolating this round from
previous working-tree edits. No original Figma evaluation page was repaired.

Before the next authoring dispatch, refresh the installed runtime and extension.
Keep the authoring skill unchanged, and use independently established product
content for the next update question. These code regressions justify the runtime
repairs; they do not promote the skill candidate or establish better visual
judgment.
