# Author reusable components

Use this reference to run the required shared-responsibility gate or after
selecting a reusable local component. It explains representation, not library
strategy. New local components need no `get_design_system`; use catalogs only
for discovery or normalized library props, and exact returned IDs for newly
authored components.

## Shared-responsibility gate

Run this gate for two or more screens or states, or before a second consumer of
the same content, control, or system responsibility. Repeated appearance alone
does not qualify.

Before markup can create the second consumer:

1. List every recurring semantic family: shell, navigation, actions, rows,
   cards, and other record families. Bound each at the smallest subtree that
   owns the complete responsibility.
2. Identify stable anatomy and real differences. Copy, media, availability,
   state, labels, visibility, swaps, and bounded slot content are contract inputs,
   not reasons to duplicate.
3. Rank candidates by consumer spread and coordination cost. Author the
   highest-ranked qualifying family first. A label, icon, or button component
   does not close its repeated parent row or card.
4. Keep a candidate Direct only for a concrete structural, ownership, behavior,
   or contract incompatibility. Narrow an incompatible boundary once before
   rejecting it. Different screens, siblings, labels, destinations, or small
   width changes are not incompatibilities.

Ranking sets order, not scope. Before final markup, resolve every recurring
family as Author or Direct with a concrete incompatibility. One authored shell,
navigation, control, or nested child never exempts repeated rows, cards, or
records.

Keep one ranked trace:

```txt
rank -> responsibility + consumers -> stable anatomy + differences -> Author or Direct + incompatibility
```

Build it from planned content and final markup. Scan recurring sibling families,
cross-screen roles, and patterned `data-key` groups. An unlisted recurring
family reopens the gate. In the first payload that could contain a candidate's
second consumer, bind every included Author consumer as a native instance or
omit the second consumer. Planned later conversion and a nested or lower-ranked
component do not close the gate.

This is a comparison gate, not a quota. Author nothing when no responsibility
qualifies. If one representative usage must stabilize first, replace that
primitive with an instance before adding another consumer. Use the exact
returned `rootNodeId` or `nodeIdsByKey` entry for every usage; never leave
primitive lookalikes as final consumers.

Before propagation, create the smallest real definition, instantiate it once,
and verify the exact reference. Stop component authoring if the ID is missing,
the instance fails, or the definition is empty, default-sized, or loses
properties. Do not substitute primitives or claim completion. Continue only
independent Direct work, report the degraded component result, and remove a
temporary definition only when unused and safe. Re-read a corrupt definition
and its intended usage; never rebuild it in place or remove one with instances.
Recreate only when unused.

Before handoff, reconcile the named candidates with actual consumers. Each
qualifying family must have native INSTANCE consumers or a recorded concrete
incompatibility. Inspect the most demanding instance through its descendants;
root type and size do not prove wrapping, slots, media, or state content fit.
Revise the contract or boundary when real content breaks it.

Markup-only updates preserve keyed components, sets, instances, and shapes.
Restate native bindings only when changing native state; new native nodes still
need declarations or component references.

Copy a complete recipe and change its design facts. Do not infer TemPad's
component shape from raw Plugin API calls.

## Contents

- [Define the contract from real usages](#define-the-contract-from-real-usages)
- [Keep source definitions discoverable](#keep-source-definitions-discoverable)
- [Component and properties](#component-and-properties)
- [Consume an authored component directly](#consume-an-authored-component-directly)
- [Variant set](#variant-set)
- [Slots and instances](#slots-and-instances)

## Define the contract from real usages

Compare every intended usage. Separate stable anatomy from varying content,
state, or nested substitution; map differences to the smallest supported Text,
Boolean, Instance Swap, variant, Slot, or nested-composition mechanism. Treat a
field as invariant only when real usages agree.

Size the contract from real extremes: test the longest wrapping text, widest
label, largest nested swap, and materially different slots. Compare descendant
bounds with the INSTANCE root; screenshots can still paint invalid overflow.
If content exceeds the root, enlarge the definition, add a truthful size
variant, or move the varying region outside a smaller stable boundary.
If consumer-specific media cannot be expressed by the available instance
contract, keep that media direct and componentize the stable surrounding
responsibility; never freeze one image into every instance to retain a larger
component boundary.

When stable anatomy should evolve together, expressible state differences
support a shared contract. Keep it local only when divergence or contract cost
outweighs coordinated change.

If the contract cannot express a meaningful difference, revise it or keep the
responsibility local. Never force usages to share placeholder content or an
accidental default merely because outer geometry repeats.

Model each mutually exclusive categorical concern as one variant axis; do not
replace it with Booleans that allow impossible combinations. Reserve Booleans
for independently optional content or behavior.

Expose one choice through both a variant and independent property only when real
usages vary them independently. Keep each source variant's visible state
truthful; instance overrides do not repair accidental source defaults.

## Keep source definitions discoverable

Keep main components and sets visible at natural bounds in a clearly named
source area separate from screens. Never hide, clip, make transparent, or
invisibly nest them. For several families, use a top-level SECTION with
`contentsHidden: false`, discoverable definition children, and content-sized
bounds.

Keep each real definition once, without redundant specimens. Before handoff,
use `get_structure` to verify every definition is visible and every intended
consumer is an INSTANCE. Inspect distinct source variants at readable scale;
names, content, and styling must encode the same state.

Keep the source area operational and visually subordinate: use the smallest
content-sized container that exposes the definitions, outside the consumer
board or screen sequence. Do not turn it into a branded artboard, mood board,
visual-thesis panel, token showcase, or documentation page unless the user asks
for that deliverable. Product screenshots and presentation framing should stay
focused on the requested experience.

## Component and properties

This complete call creates a component with TEXT and BOOLEAN properties and
connects both properties to its label layer.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"button\" class=\"flex flex-row items-center justify-center w-[160px] h-[48px] px-[20px] bg-[#2563EB] rounded-[8px]\"><span data-key=\"button/label\" class=\"w-fit h-fit text-[16px] font-semibold text-[#FFFFFF]\">Continue</span></div>",
  "native": {
    "button": {
      "figma": {
        "name": "Button",
        "component": {
          "type": "COMPONENT",
          "properties": {
            "label": {
              "type": "TEXT",
              "name": "Label",
              "defaultValue": "Continue"
            },
            "show-label": {
              "type": "BOOLEAN",
              "name": "Show label",
              "defaultValue": true
            }
          }
        }
      }
    },
    "button/label": {
      "figma": {
        "componentPropertyReferences": {
          "characters": "label",
          "visible": "show-label"
        }
      }
    }
  }
}
```

Stable keys such as `label` connect definitions and sublayer references within
one result; they are not generated Figma property names. Supported property
types are `BOOLEAN`, `TEXT`, and `INSTANCE_SWAP`, linked through `visible`,
`characters`, and `mainComponent` respectively.

BOOLEAN properties control visibility, not styling. Hidden in-flow children
leave Auto Layout. Use this only for intentionally optional content. To preserve
geometry, toggle an inner layer inside a fixed slot, use `absolute` for a true
overlay, or use geometry-equivalent variants for whole-state changes.

Treat `layout-affecting-visibility-property` as a contract warning. Fix it when
geometry must stay stable. Accept intentional reflow only after comparing true
and false instances for bounds, sibling positions, baselines, and clipping; one
default-state screenshot is insufficient.

## Consume an authored component directly

Use the exact ID returned by `apply_canvas`. For TemPad-authored components,
`componentProperties` accepts their stable definition keys. This follow-up
needs no catalog:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"screen\" class=\"flex flex-col w-[320px] h-[200px] p-[24px]\"><div data-key=\"screen/action\" class=\"w-[160px] h-[48px]\"></div></div>",
  "native": {
    "screen/action": {
      "component": { "id": "ComponentID:created-button" },
      "componentProperties": { "label": "Save", "show-label": true }
    }
  }
}
```

Replace the illustrative ID with the returned ID. Never invent IDs or use this
shortcut for unidentified library components.

## Variant set

This call creates two components in one variant set. Every direct child of a new
set must be an authored component; names encode axes as `Property=Value`.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"button-set\" class=\"flex flex-row gap-[24px] p-[24px] w-[408px] h-[96px]\"><div data-key=\"button/default\" class=\"flex flex-row items-center justify-center w-[168px] h-[48px] bg-[#2563EB] rounded-[8px]\"><span data-key=\"button/default/label\" class=\"w-fit h-fit text-[16px] font-semibold text-[#FFFFFF]\">Continue</span></div><div data-key=\"button/hover\" class=\"flex flex-row items-center justify-center w-[168px] h-[48px] bg-[#1D4ED8] rounded-[8px]\"><span data-key=\"button/hover/label\" class=\"w-fit h-fit text-[16px] font-semibold text-[#FFFFFF]\">Continue</span></div></div>",
  "native": {
    "button-set": {
      "figma": {
        "name": "Button",
        "component": { "type": "COMPONENT_SET" }
      }
    },
    "button/default": {
      "figma": {
        "name": "State=Default",
        "component": { "type": "COMPONENT" }
      }
    },
    "button/hover": {
      "figma": {
        "name": "State=Hover",
        "component": { "type": "COMPONENT" }
      }
    }
  }
}
```

Consume the returned set ID and select siblings through variant properties. If
the call returns the set as `rootNodeId`, this creates Default and Hover:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"screen\" class=\"flex flex-row w-[384px] h-[96px] gap-[24px] p-[24px]\"><div data-key=\"screen/default\" class=\"w-[168px] h-[48px]\"></div><div data-key=\"screen/hover\" class=\"w-[168px] h-[48px]\"></div></div>",
  "native": {
    "screen/default": {
      "component": { "id": "ComponentSetID:created-button-set" }
    },
    "screen/hover": {
      "component": { "id": "ComponentSetID:created-button-set" },
      "componentProperties": { "State": "Hover" }
    }
  }
}
```

Replace the ID with returned `rootNodeId`. The set ID creates its default;
`componentProperties` selects another encoded variant. An exact child ID from
`nodeIdsByKey` may instantiate that variant directly.

Use `descriptionMarkdown` and `documentationLink` only for real guidance, inside
`figma.component` beside `type` and `properties`:

```json
{
  "figma": {
    "name": "Button",
    "component": {
      "type": "COMPONENT",
      "descriptionMarkdown": "Primary action"
    }
  }
}
```

Define shared properties on the component set rather than on one variant.

## Slots and instances

Use `figma.slot` only for an intentional flexible nested-content API. New slots
must be inside local authored components and include `property.name`; markup
children become defaults. Optional settings control stretching, empty display,
child limits, and preferred values.

An `INSTANCE_SWAP` default uses exact live component/set ID `{ "id": "..." }`
or importable library key `{ "key": "..." }`. Preferred values require
`{ "type": "COMPONENT" | "COMPONENT_SET", "key": "..." }` and accept neither
live IDs nor catalog refs. Resolve catalog identity before authoring and never
invent it. Put advanced state under `figma.instance`; omission preserves normal
override behavior.

Never edit a remote component, nest a main component inside another main
component, delete a component with surviving instances, or create properties
and variants that the requested component API does not need.
