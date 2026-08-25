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

Before adding a rule for an observed failure, map the failure to the narrowest
existing invariant. Strengthen that cue when the failure is another instance of
the same responsibility, evidence, representation, or safety boundary; keep
scenario examples in conditional references. Add a new invariant only when the
boundary itself is genuinely different. State the shared boundary with an
observable discriminator and a stop condition; a principle too abstract to
change the next action is not a usable cue.

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
9. **Semantic economy:** Does each phrase change understanding or action?
   Remove repetition, conversational framing, and explanation the agent already
   knows, but preserve every behavior-changing condition, discriminator,
   action, exception, stop condition, and safety boundary. Add necessary
   guidance regardless of net length, and reject compression that weakens
   clarity, discoverability, or force. Is the same rule repeated elsewhere?
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

The skill remains orthogonal to product-domain and style-specific answers, but
it owns a small portable composition floor so correctness does not depend on
which unrelated skills happen to be installed. That floor requires a testable
hierarchy, visual anchor, type/rhythm, material grammar, asset treatment, and
shared-responsibility trace before serialization; a progressive reference gives
perceptual discriminators for generic card mosaics and primitive content
substitution without prescribing a house style. Optional professional skills
may refine situated decisions but cannot be the sole source of baseline quality.
When a material design
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
screen or system, it treats direction-defining visual language as material while
preserving professional design freedom. Suitable expertise may resolve the
brief into an actionable visual thesis and test it in one representative
composition, but creative latitude does not demote that decision and broad mood
words do not close it until they become visibly testable choices. External
visual research is reserved for exact precedent, remaining material ambiguity,
or a mismatch exposed by that rendering. It likewise routes pictographic and
image roles through asset-source reasoning before the agent chooses a medium,
without prescribing that medium.

For net-new work without a proven existing system, Direct may be used only for
the representative composition while its resource boundary is provisional. Two
or more planned screens or materially distinct states trigger a broad comparison
of plausible shared responsibilities; a planned family of at least two concrete
consumers with the same content, control, or system responsibility triggers the
same gate within one composition. Responsibilities with stable anatomy and
supported content or state variation become positive Author candidates when at
least two concrete consumers share them; incompatible structure, behavior,
ownership, or contract cost can still keep them local. Screen, state, or family
count triggers comparison rather than a component quota. Candidate anatomy is
judged at the smallest subtree that owns the shared responsibility, so unrelated
screen or sibling differences cannot reject it. Fresh files, one-screen scope,
small scope, label changes, and modest width differences cannot justify primitive
copies when the family has a truthful supported contract.
Repeated appearance alone establishes no responsibility. The skill forbids
silently propagating a second primitive copy of a responsibility that passed
this coordination gate. A bulk payload does not defer the gate: the planned
content and final markup, not the components already imagined, supply the
complete record and control inventory. Every family is counted and ranked
before one call serializes several consumers; an omitted recurring family
reopens the gate.
An inner atom does not close the gate for a repeated parent record: when media,
content, action, and state form stable row or card anatomy, that responsibility
is evaluated independently from a reusable label, icon, or button inside it.
When several responsibilities qualify, it ranks coordination value rather than
letting implementation ease select the boundary. Net-new dependent screens are
not serialized until one requested representative screen has been opened and
corrected; an already-grounded one-root result remains valid without a separate
proof artifact. The skill reconciles selected resources through real instances
and bindings but does not recursively mine the final artifact for additional
components. Main definitions remain discoverable in a minimal source area
outside the product presentation, never a compulsory specimen, mood board, or
visual-thesis panel.

Component contracts preserve the same semantic boundary. Mutually exclusive
categorical state is one variant axis; independent Booleans remain for genuinely
independent optional content or behavior, so the API does not admit states the
real usages cannot produce. Text, swap, and slot contracts are exercised with
their most demanding real values, because Figma can render descendants beyond a
fixed instance root without making the native contract structurally sound; root
INSTANCE type and dimensions alone are not fit verification.

The representative composition is also a flow-wide visual contract rather than
a single showcase. Materially distinct dependent screens may change hierarchy
and asset quantity, but they must preserve the relevant media logic, rhythm,
material and shape grammar, and interaction or detail treatment. Retaining only
palette, typography, borders, or isolated motifs is failed propagation.

Visual correction is also evidence-preserving work. Removing a visible defect
does not pass verification when the repair shortens established content,
removes state, substitutes an asset, or otherwise weakens an unaffected
relationship. The final comparison treats that kind of concealment as a new
defect rather than a successful fix. It compares the final screenshots with the
retained task-specific decision trace, inspects edge-adjacent pixels explicitly,
and treats a noisy or composition-dominating outer-effect halo as rendered
evidence to repair without flattening an established material language.

The same boundary governs visible evidence and assets. Textual product guidance
cannot by itself establish visual language, and creative latitude or native
editability cannot establish a geometric image medium. The agent must inspect
evidence in the medium relevant to the decision and preserve content
distinctions: every content-bearing consumer must depict its claimed subject,
so one composite scene cannot substitute for several distinct record media.
The skill does not assume an image slot, require a visual asset, or prescribe a
source-selection tree. It encodes only the ordering invariant:
establish a distinct visual job from the brief or evidence, choose its medium,
then choose a source and import route. Depiction is a job rather than a synonym
for raster imagery, so the applicable evidence still governs whether its medium
is photographic, vector, diagrammatic, or something else. Search and generation
remain late acquisition mechanisms with no universal priority. Recognition-
dependent subjects make raster imagery a real candidate before the agent can
choose a convenient vector implementation. Generated PNG/JPEG/GIF data URLs can
reach the Hub through the bounded `upload_asset` tool and become ordinary
content-addressed IMAGE assets without entering prose. A remote asset
also requires established applicable usage rights and a recoverable source
before import; accessibility or host identity alone does not establish
permission. This preserves situated judgment while preventing tool availability
from inventing imagery, primitive geometry from silently substituting for an
image medium, or opaque SVG import from weakening an authored diagram's
editable semantics. The same medium boundary applies to icon-like characters
inside worded controls: adjacent prose does not turn a directional or action
glyph into typography, so the pre-serialization asset classification must catch
and route it as an icon.

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
