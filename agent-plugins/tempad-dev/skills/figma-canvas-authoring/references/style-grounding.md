# Ground unresolved design decisions

Use this reference only when a material design decision is not established by
the user, permitted project or Figma evidence, or a clearly applicable installed
skill. Skip exact reproduction, mechanical edits, and decisions already settled
by sufficient evidence.

This reference defines an evidence process, not a UX checklist or style guide.
It does not prescribe which product concerns must matter, how many sources to
inspect, or what conclusion to reach. Determine those from the actual task.

## Isolate the uncertainty

Before research:

1. inventory the requirements and evidence already available;
2. name only the unresolved decisions that could materially change the result;
3. separate missing evidence from low-consequence choices the agent can make and
   identify as assumptions.

Do not research a broad category when one decision is unresolved. Do not turn a
remembered convention, a tool affordance, or an example from this skill into a
requirement.

Broad qualitative words can state an intended effect without determining the
choices that produce it. When materially different interpretations remain
plausible, the decision is still unresolved.

For a net-new result without a concrete reference or representative established
screen or system, the direction-defining visual language is material. Giving the
agent creative latitude assigns that decision to the agent; it does not make the
decision low-consequence. This calls for the smallest evidence that resolves the
choice, not a survey of the category.

## Obtain sufficient evidence

For each unresolved decision, choose the nearest credible source whose authority
actually covers that decision. Project and current-file evidence usually has the
closest product context; external primary guidance may establish scoped
requirements; inspected products or visual artifacts may establish applicable
precedent. These are possible evidence roles, not a mandatory source list.

Start with the closest candidate and inspect one representative source or
artifact. Seek another only when the first leaves a material conflict or gap;
the objective is to settle the decision, not accumulate inspiration. Search
snippets and remembered summaries are discovery leads, not inspected evidence.
Record:

- the exact source or artifact identity;
- the requirement or principle it supports;
- why it applies here and where its authority stops;
- the resulting decision or remaining uncertainty.

Use as many distinct sources as the unresolved decision genuinely needs—no
fixed minimum or comparison ceremony. Stop when the material uncertainty is
resolved. If required evidence is unavailable or prohibited, ask the user when
the choice would materially change the deliverable; otherwise state the
assumption.

Match the evidence medium to the decision. Textual guidance, including generic
guidance from another skill, may establish a workflow or behavioral principle;
a direction-defining visual decision needs an inspected visual artifact or an
exact visual specification. Search results, product descriptions, and prose
about navigation do not by themselves establish composition, typography, color,
density, or imagery.

Judge sufficiency per decision. Evidence about an asset, isolated convention,
or tool constraint does not ground unrelated composition or visual-language
choices.

## Retain a compact decision trace

Keep a short working note before the first `apply_canvas` call:

```txt
Outcome: requested result and scope
Known: applicable user, project, and file evidence
Open decision -> source -> applicable finding -> decision
Assumptions: only unresolved low-consequence choices
Verification: result-specific evidence to inspect in Figma
```

Include only lines the current task needs. This note is not a deliverable or a
mood board.

## Apply and verify

Translate the decisions into one coherent composition. Judge the rendered
artifact against the task-specific trace, not against generic advice in this
skill. Correct concrete mismatches; do not add more research or continue tuning
without a remaining material uncertainty or observed defect.
