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

The main file routes by user intent and consequence: reuse an accessible design
system, compose directly, or author reusable resources only when explicitly
requested. Declarative desired state and stable identity remain hard
boundaries. Native schema, design-system, and visual-asset particulars remain
progressive references.

Unspecified visual direction uses evidence as subsidiary support. It frames
the product problem before searching, researches only unresolved material
decisions, creates contrast only when fixation risk matters, and validates the
visible canvas against one compact hypothesis. This avoids both common model
defaults and the opposite failure of performing a research ritual instead of
designing.

## Packaging and validation

- Keep `SKILL.md` frontmatter limited to fields that affect discovery or a real
  compatibility requirement.
- Keep `agents/openai.yaml` synchronized with the actual skill scope.
- Keep reference links one level from `SKILL.md` and state exactly when to read
  each file.
- Validate complete private-protocol examples against the public schema.
- Run the skill validator, generate the development plugin, and forward-test
  consequential revisions with clean task-local context.

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
