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

The main file keeps the requested native result focal: establish scope and
available evidence, research unresolved material decisions, choose the native
representation, then build, inspect, and repair. The current candidate replaces
an earlier composition checklist and screen-count extraction gates with
situated questions. Those former gates are not current skill requirements.

Direct is the default for a first net-new composition. Reuse requires the user,
selected source, or project evidence to establish an applicable system; resource
names or file presence alone do not establish relevance. Author applies when
reusable resources are requested or established by the resolved plan. A verified
Direct result is complete without an unsolicited component pass.

The progressive composition reference asks about the person's working object,
action, dependent states, attention, and scrolling model. It uses those
relationships to diagnose familiar shells, excess reading, misleading graphics,
or native layout defects without imposing a palette, density, motif, or fixed
quality checklist. The evidence reference separates product facts, visual
precedent, and professional judgment, and treats research attempts as distinct
from inspected sources.

A materially complete representative screen must be opened before expanding the
flow or extracting resources. Its rendered whole supplies feedback that a
skeleton, resource board, or concept image cannot. Follow-up screens preserve
resolved shared roles while adapting to their own work. A repair must preserve
established content, state, assets, and unaffected relationships; removing the
symptom by weakening the request is not completion.

When Author is selected, its reference maps each resource to its responsibility,
concrete consumers, and meaningful variation. Component strategy is judged at
the smallest usable native boundary; repetition, screen count, and visual
similarity alone do not decide it. Selected definitions must appear as native
instances or live bindings in every intended consumer. Property contracts are
exercised with actual content and states, and source definitions remain
inspectable without adding unrequested specimens or documentation.

Asset guidance resolves the selected visual job, medium, source, and import
route before production. It preserves subject identity, applicable usage rights,
and native semantics. An available vector path does not justify replacing an
image role with primitives, and icon-like characters do not become typography
merely because they sit next to words. Generated PNG/JPEG/GIF data URLs can be
composed programmatically into `upload_asset`; later canvas calls use the hash.

Declarative desired state, exact scope, stable identity, and host-supplied MCP
tools remain integrity boundaries. Native mechanics and serialization examples
load only for selected capabilities. Unknown outcomes require recovery before
another write. Tool verification proves only its checked conditions; material
visual claims require opened pixels and targeted native evidence. The candidate
remains provisional until materially different live tasks establish transfer,
as recorded in [the September review](../testing/agent-authoring-review-2026-09.md).

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
