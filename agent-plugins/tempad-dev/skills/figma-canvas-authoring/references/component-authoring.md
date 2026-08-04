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

Copy a complete recipe and change its design facts. Do not infer TemPad's
component shape from raw Plugin API calls.

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

Use `descriptionMarkdown` and `documentationLink` only for real guidance.
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
