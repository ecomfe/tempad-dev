# Agent skill quality model

## Purpose

This document records the maintenance model for TemPad Dev's
`figma-design-to-code` and `figma-canvas-authoring` skills. It is not runtime
instruction.

The objective is not to make a skill comprehensive. A skill is valuable only
when its marginal procedural guidance improves task outcomes more than its
context cost, instruction interference, and maintenance risk.

## Epistemic basis

### Keep the task focal

Michael Polanyi described knowing as an integration from subsidiary
particulars toward a focal whole. Applied here, the requested product result is
the focal object. Tool syntax, catalog entries, project conventions, examples,
and rules are subsidiary clues that should support judgment and then recede.

When the workflow makes agents optimize the checklist, maximize catalog reuse,
or explain every choice, those particulars have displaced the result. A good
skill therefore states the outcome and authority boundaries first, then loads
technical particulars only when the task encounters them.

### Codify cues and invariants, not an imaginary complete expertise

Polanyi's point is not merely that some knowledge has not yet been written
down. Skilled judgment depends on context-sensitive integration that rules
cannot fully replace. A skill should explicitly encode:

- fragile tool contracts and irreversible safety boundaries;
- perceptual and diagnostic cues that tell the agent which branch it is in;
- source-of-truth boundaries and stop conditions;
- a few complete examples where exact shape matters;
- feedback that lets the agent correct action in the real environment.

It should leave contextual synthesis, composition, and representation choices
open when several approaches can satisfy the evidence. More prose is not a
substitute for situated judgment.

### Let local practice carry collective knowledge

Project instructions, nearby code, existing components, tokens, Figma
resources, and current product language contain the team's practical
tradition. The skills read that local practice before applying general model
memory. This is more reliable than attempting to copy all possible framework,
design-system, or organizational knowledge into a universal skill.

### Organize cues in the order the model should reason

Inference does not update model weights or expose a controllable, deterministic
"parameter chain." Prompt tokens instead shape transient activations, attention,
and which learned patterns are useful for predicting the next token. We can
therefore design a cue topology, not select a known circuit: put the focal
problem and target artifact ontology first, keep competing implementation
vocabularies out of the decision context, and disclose exact syntax only after
the relevant branch is chosen.

For canvas authoring, use this sequence:

1. frame the intended experience, authority, and unresolved evidence;
2. choose the Figma-native concept that represents the decision;
3. load the reference for that Figma concept;
4. serialize the chosen structure through Canvas HTML and its Tailwind subset;
5. inspect the native and rendered result.

Organize optional native references by Figma semantics—components, variables,
styles, geometry, paints/effects/media, and rich text—because those concepts
match both the target artifact and the typed contract, and align the prompt with
the model's learned Figma vocabulary. Keep Canvas HTML/CSS in one separate
serialization reference. A CSS-first hierarchy would make browser concepts and
available utilities salient while representation is still undecided; one
undifferentiated Figma manual would load unrelated schemas and weaken branch
selection.

Keep MCP server instructions and tool descriptions at the mechanical layer:
session scope, evidence boundaries, tool affordances, identity, omission,
removal, and transport. The triggered skill owns task policy, representation
choice, design-system judgment, and verification. This separation prevents an
always-on tool description from competing with the task-specific reasoning
path while still making each call usable in isolation.

## Related research translated into design rules

- **Cognitive apprenticeship:** model fragile actions with complete examples;
  scaffold the core path; route advanced cases to focused references; verify
  in authentic project or Figma activity.
- **Cognitive load and expertise reversal:** remove explanation the model
  already knows, avoid split attention and duplicated rules, and disclose
  specialist branches only when their cues occur.
- **Design fixation:** frame requirements before naming a familiar source.
  Contrast alternatives when an early example could materially anchor the
  result, but do not turn anti-fixation into mandatory research ceremony.
- **Naturalistic decision making:** expose recognizable cues, expected state,
  anomalies, and workable next actions. Do not require exhaustive option
  scoring when local evidence already makes one path clear.
- **Agent Skills practice:** keep activation metadata discriminative, keep the
  main file on the universal execution path, move mutually exclusive and rare
  detail into directly routed references, and validate on representative tasks.

## Quality tests

Evaluate every instruction against these questions:

1. **Activation precision:** Does the description say what the skill does,
   when it applies, and adjacent tasks it excludes?
2. **Focal outcome:** Can the agent tell what successful work is before seeing
   procedures and prohibitions?
3. **Authority:** Does each evidence source have a bounded job, with conflict
   and uncertainty handling?
4. **Decision topology:** Does the main file contain only universal decisions,
   with branch cues that point directly to optional detail?
5. **Freedom calibration:** Are safety and private protocols exact while
   product and implementation judgment remain contextual?
6. **Actionability:** Can the agent perform every instruction with information
   and tools actually available in the current task?
7. **Failure quality:** Do deterministic errors change scope or inputs instead
   of causing blind retries, guesses, or destructive fallback?
8. **Feedback integrity:** Does verification observe the actual result, and
   does iteration require new evidence rather than taste-driven looping?
9. **Context economy:** Would deleting this sentence preserve behavior? Is the
   same rule repeated in server instructions, tool descriptions, or another
   loaded file?
10. **Transfer:** Does the skill succeed on varied realistic prompts without
    access to the maintainer's diagnosis or intended answer?

Treat these as tests, not headings that every runtime skill must repeat.

## Current architecture

### `figma-design-to-code`

The universal path is: establish the minimal project envelope, read one
trustworthy top-level design snapshot, separate facts from adaptations and
gaps, implement the smallest coherent change, then use the project's real
verification path.

Rare large-selection and connection recovery lives in
`references/recovery.md`. Asset and token translation lives in
`references/assets-and-tokens.md` and loads only when those facts are present.
This keeps normal UI work from paying the attention cost of every bad-weather
branch while retaining exact recovery procedures.

The skill preserves these invariants:

- project evidence governs implementation representation;
- TemPad `get_code` governs visible design facts;
- the user governs missing product intent;
- `get_structure` never substitutes for missing style truth;
- exact values are changed only by proven project-native equivalence;
- unevidenced states and behavior are not invented;
- the handoff reports only branches that actually occurred.

### `figma-canvas-authoring`

The main file keeps the intended result and evidence focal, forms the artifact
model in Figma terms, then routes by consequence: reuse an accessible design
system, compose directly, or author reusable resources only when explicitly
requested or established by the resolved, evidence-backed design plan.
Declarative desired state and stable identity remain hard
boundaries. Host-supplied MCP tools are also an integrity boundary: the skill
stops when they are absent instead of rebuilding the transport through a shell.
Decision and evidence references establish what must be represented;
Figma-semantic references define only the selected native concepts; the Canvas
HTML reference serializes the already selected ordinary layer structure and
appearance.

The skill is deliberately orthogonal to product-domain, platform,
accessibility, content, and visual-style requirements. When a material design
decision remains unresolved, it requires a compact evidence trace and validates
the visible canvas against the resulting task-specific brief. It prescribes no
universal UX checklist, source count, or design answer; those belong to the user,
project evidence, an applicable domain skill, or targeted research.
For consequential expert workflows, generic visual direction is not evidence
for domain conventions that shape safety, prioritization, terminology, or
decision order; those remain material until grounded by a professional skill or
targeted research.
That evidence must survive translation into the artifact: an established order
or prerequisite is part of the Figma model, so its visible hierarchy and shown
states cannot contradict it while citations remain superficially correct.
For net-new work without a concrete reference or representative established
screen or system, it treats the direction-defining visual language as material
instead of silently demoting it to a low-consequence assumption. It likewise
routes pictographic and image roles through asset-source reasoning before the
agent chooses a medium, without prescribing that medium.

For new work without a proven existing system or an already-established local
resource boundary, the skill keeps Direct versus Author provisional only until
real consumers are concrete. A desired-result plan may establish them before
the first write; otherwise one representative composition does. Dependent
consumers cannot be serialized while the path is still provisional, so a
complete one-root apply cannot silently bypass the decision. Explicit resource
requirements still select Author earlier. At the single whole-composition
checkpoint, the agent compares the still-local responsibility with the greatest
coordination cost against resources already authored. This keeps attention on
coherent future change instead of the last screen or most obvious repeated list
without turning the workflow into a candidate census. Drift remains evidence.
The agent either models the selected role or retains it for a concrete reason,
reported briefly when it remains local.
Selected component contracts must express their real differences through native
instances. A working map remains optional support for complex scopes, not a
mandatory candidate-classification pass. Repetition and structural similarity
are evidence rather than a threshold or default; the skill never prescribes
component counts or product-specific component types. When several candidates
exist, the comparison is by coordination value rather than implementation ease;
a convenient leaf resource cannot silently substitute for the boundary that
best controls shared state, evolution, or drift. Literal content differences are
treated as component inputs rather than structural divergence. The consumer's
ownership of a current state value likewise does not make shared anatomy local;
the contract may expose that value. A Local decision must instead be grounded
in responsibility, behavior, structure, ownership, expected evolution, or
abstraction cost.

Component contracts preserve the same semantic boundary. Mutually exclusive
categorical state is one variant axis; independent Booleans remain for genuinely
independent optional content or behavior, so the API does not admit states the
real usages cannot produce.

Visual correction is also evidence-preserving work. Removing a visible defect
does not pass verification when the repair shortens established content,
removes state, substitutes an asset, or otherwise weakens an unaffected
relationship. The final comparison treats that kind of concealment as a new
defect rather than a successful fix.

The same boundary governs visible evidence and assets. Textual product guidance
cannot by itself establish visual language, and creative latitude or native
editability cannot establish a geometric image medium. The agent must inspect
evidence in the medium relevant to the decision and preserve content
distinctions. The skill does not assume an image slot, require a visual asset,
or prescribe a source-selection tree. It encodes only the ordering invariant:
establish a distinct visual job from the brief or evidence, choose its medium,
then choose a source and import route. Depiction is a job rather than a synonym
for raster imagery, so the applicable evidence still governs whether its medium
is photographic, vector, diagrammatic, or something else. Search and generation
remain late acquisition mechanisms with no universal priority. This preserves
situated judgment while preventing tool availability from inventing imagery,
primitive geometry from silently substituting for an image medium, or opaque
SVG import from weakening an authored diagram's editable semantics.

## Packaging and validation

- Keep `SKILL.md` frontmatter limited to fields that affect discovery or a real
  compatibility requirement.
- Keep MCP server instructions and tool schemas on universal protocol facts;
  route task-specific workflow and design policy through the triggered skill.
- Keep `agents/openai.yaml` synchronized with the actual skill scope.
- Keep reference links one level from `SKILL.md` and state exactly when to read
  each file.
- Validate complete private-protocol examples against the public schema.
- Keep common examples mechanically minimal and avoid repeating one visual
  language across otherwise unrelated capability references.
- Run the skill validator, generate the development plugin, and forward-test
  consequential revisions with clean task-local context.
- Count a forward test only when the live Figma tab runs the matching extension
  bundle, the clean task loads the intended Skill and MCP build, and the host
  can display the returned screenshot pixels. A resource link, shell crop, or
  screenshot metadata alone is not visual inspection.

## Sources

- Michael Polanyi,
  [_The Tacit Dimension_](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html)
  (1966), especially the from-to structure of tacit knowing.
- Hadjimichael, Pyrko, and Tsoukas,
  [Beyond Tacit Knowledge](https://doi.org/10.5465/amr.2022.0289), _Academy of
  Management Review_ 49(4), 2024.
- Collins, Brown, and Newman,
  [Cognitive Apprenticeship](https://apps.dtic.mil/sti/pdfs/ADA178530.pdf),
  1987 report.
- Kalyuga, Chandler, and Sweller,
  [Levels of Expertise and Instructional Design](https://doi.org/10.1518/001872098779480587),
  _Human Factors_ 40(1), 1998.
- Klein,
  [Naturalistic Decision Making](https://doi.org/10.1518/001872008X288385),
  _Human Factors_ 50(3), 2008.
- Jansson and Smith,
  [Design Fixation](<https://doi.org/10.1016/0142-694X(91)90003-F>), _Design
  Studies_ 12(1), 1991.
- [Agent Skills specification](https://agentskills.io/specification) and
  [skill-creation best practices](https://agentskills.io/skill-creation/best-practices).
- Figma,
  [Create skills for the Figma MCP server](https://developers.figma.com/docs/figma-mcp-server/create-skills/).
