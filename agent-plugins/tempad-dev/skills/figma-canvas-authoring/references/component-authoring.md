# Author reusable components

Use this reference only when the user explicitly requests a reusable local
component or an explicitly requested design-system task requires one. This
reference explains representation; it is not a reason to componentize an
ordinary screen or create a component library. New local components do not
require `get_design_system`. Use a catalog when discovery or normalized library
props are useful; use an exact returned live ID for a component the agent just
authored.

When a composition uses a new component, its final usage nodes must be native
Figma instances. Either:

- author the component first, then use its returned `rootNodeId` or exact entry
  from `nodeIdsByKey` in the composition;
- stabilize the composition first, then author the component and replace each
  managed primitive usage. Give a replacement a new `data-key` when needed and
  list the old key in `removeKeys`.

Never leave a visually equivalent primitive copy as the final usage.
If a representative instance is later replaced to fit real content or geometry,
the selected responsibility is no longer closed. Revise the component contract
or instance sizing and restore the usage; if the contract no longer earns its
cost, safely remove the now-speculative definition instead of reporting it as a
reusable deliverable.

Before expanding a composition around a new component, create the smallest real
definition needed and use its exact returned `rootNodeId` or `nodeIdsByKey`
entry in one representative native instance. Continue only after structural
verification confirms that component reference. If the tool does not return an
exact ID, rejects the instance, or cannot verify its reference, stop creating
component resources. Never represent a failed instance with a primitive or
claim the component deliverable is complete. Continue independent Direct screen
work only when it remains a valid requested outcome and explicitly report the
degraded component delivery; if a reusable component is itself required, that
part of the task remains incomplete. Remove an unused temporary definition only
when safe and not itself a requested deliverable.

If a verified definition becomes empty, default-sized, or loses properties,
treat it as transaction corruption. Do not rebuild it in place: update preserves
its page coordinates. Re-read the definition and intended usage, then stop and
report it. With a fixed MCP session, remove and recreate it only when unused;
never remove or substitute a definition with instances.

When an update targets an existing component or component set, the root `div`
preserves that native type. Omit a redundant root `figma.component` declaration
unless the call changes component metadata or properties.

Copy a complete recipe and change its design facts. Do not infer TemPad's
component shape from raw Plugin API calls.

## Contents

- [Define the contract from real usages](#define-the-contract-from-real-usages)
- [Component and properties](#component-and-properties)
- [Consume an authored component directly](#consume-an-authored-component-directly)
- [Variant set](#variant-set)
- [Slots and instances](#slots-and-instances)

## Define the contract from real usages

Before creating a definition, compare every intended usage and separate stable
anatomy from differing content, state, or nested substitution. Map each real
difference to the smallest supported mechanism: Text, Boolean, Instance Swap,
a variant, a Slot, or nested composition. Treat a field as invariant only when
the concrete usages agree.

When stable anatomy is expected to evolve together, a state difference that a
supported property or variant can express is evidence for the shared contract,
not a reason to keep copies local. Keep the responsibility local only when
consumer divergence or contract cost outweighs that coordinated change.

If a meaningful usage difference cannot be expressed by the proposed contract,
revise the component structure or keep the responsibility local. Do not publish
a reusable definition that makes different usages share placeholder content or
an accidental default merely because its outer geometry repeats.

Model one mutually exclusive categorical concern as one variant axis. Do not
replace it with independent Boolean properties whose combinations permit no
active value or several active values when those states are not real usages.
Use Boolean properties for independently optional content or behavior.

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

Stable property keys such as `label` connect definitions and sublayer
references inside the same result. They are not the generated Figma property
names. Supported authored property definitions are `BOOLEAN`, `TEXT`, and
`INSTANCE_SWAP`. Link sublayers with `visible`, `characters`, or
`mainComponent` respectively.

BOOLEAN properties control layer visibility, not visual styling. Figma removes
a hidden in-flow child from Auto Layout as if it were absent. Use that behavior
for intentionally optional content. When a state decoration must not move text
or siblings, bind `visible` to an inner layer inside an always-present fixed
slot, or make the decoration `absolute` when overlay positioning is the real
semantics. Use geometry-equivalent variants when the whole visual state changes.

Treat `layout-affecting-visibility-property` as a state-contract warning. Fix it
when geometry should remain stable. Accept it only when reflow is intentional,
after creating representative true and false instances and comparing their
bounds, sibling positions, text baselines, and clipping. A screenshot of only
the default property state is not component verification.

## Consume an authored component directly

Use the exact live ID returned by the component's `apply_canvas` result. For a
TemPad-authored component, `componentProperties` accepts the same stable
property keys used in its definition. This complete follow-up call needs no
catalog:

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

Replace the illustrative ID with the exact returned ID. Do not invent a live
ID or use this shortcut for an unidentified library component.

## Variant set

This complete call creates two components and combines them into one variant
set. Direct children of a new set must all be authored components. Variant
names encode axes using Figma's `Property=Value` convention.

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

Consume the returned set ID directly and select a sibling through its variant
property. For example, if the call above returns the set as `rootNodeId`, this
follow-up creates one default and one Hover instance:

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

Replace the illustrative ID with the exact returned `rootNodeId`. The set ID
creates its default variant; `componentProperties` selects another real variant
by its encoded axis. An exact child ID from `nodeIdsByKey` may instead create
that variant directly.

Use `descriptionMarkdown` and `documentationLink` only for real guidance. Both
belong inside `figma.component`, beside `type` and `properties`; they are not
siblings of `figma.component`:

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

Use `figma.slot` only when flexible nested content is an intentional component
API. A new slot must be inside a local authored component and must include
`property.name`; its existing markup children become default slot content.
Optional settings cover stretching, empty display, child limits, and preferred
values.

An `INSTANCE_SWAP` default or preferred value must resolve to a real component
or set by exact local ID, library key, or catalog `{ "ref": "cN" }`. Never
invent any of those identities. Advanced instance state belongs under
`figma.instance`; omission preserves normal Figma override behavior.

Never edit a remote component, nest a main component inside another main
component, delete a component with surviving instances, or create properties
and variants that the requested component API does not need.
