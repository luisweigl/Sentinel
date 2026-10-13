| Area | Proposed rules |
|---|---|
| **Typography** | System sans-serif for service names and controls; system monospace for endpoints, measurements, timestamps, and table headings. Scale: **11px** metadata, **12px** controls and measurements, **13px** service names, **15px** brand, **20px** page heading. Weights: 400, 500, 600. Tabular numerals. No uppercase body labels or exaggerated letter spacing. |
| **Spacing** | **4px** base; scale: **4, 8, 12, 16, 24, 32px**. Preserve current spacing and density; use the scale when refining existing padding. |
| **Radius** | **2px** on controls. Square surfaces and table boundaries. Circular status dots only. |
| **Borders** | **1px solid**. Row dividers: `#252B33`. Section boundaries: `#343C47`. Control borders: `#46515E`. No shadows. |
| **Background hierarchy** | Page: `#111418`. Header and table body: `#171B21`. Table headings and control surfaces: `#1E242C`. Hover: `#252D37`. Flat fills; no gradients. |
| **Text** | Primary: `#E0E5EB`. Secondary: `#B0BAC6`. Metadata: `#8995A4`. Disabled: `#657180`. Use weight and brightness to establish hierarchy. |

**Status colors**

| State | Color | Treatment |
|---|---|---|
| Healthy | `#78B38B` | Small dot; neutral result text |
| Failing | `#E1847E` | Small dot and failed-result text |
| Awaiting check | `#929EAD` | Outlined dot |
| Paused | `#727E8E` | Solid dot |
| Focus | `#9BAEC5` | Keyboard focus outline |

Keep measurements neutral. No glowing indicators, colored rows, tinted badges, or large status blocks.

**Buttons**

- Compact, 12px medium labels; preserve current dimensions.
- Default: `#1E242C` surface, `#46515E` border, primary text.
- Hover: `#29323D`; pressed: `#323D4A`.
- “Clear filters” stays a text button with a transparent background.
- Focus: 2px outline with a 2px offset.
- No bright accent-filled buttons on this screen.

**Inputs and selects**

- Background: `#11161C`; border: `#46515E`; radius: 2px.
- Entered text: primary; placeholder: metadata.
- Hover border: `#647183`; focus uses the shared outline.
- Retain native controls, current sizing, and visible labels.
- Set native browser controls to a dark color scheme.