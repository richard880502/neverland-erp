# ERP UI Layout & Control Sizing

This document defines the default sizing rules for ERP forms, toolbars, dashboard cards, and action controls. The goal is to prevent recurring layout drift such as mismatched input/button heights, uneven card rows, and ad-hoc per-page padding.

## Control sizing

Default form controls:

- Input / select height: **46px**
- Toolbar button height: **46px**
- Toolbar button minimum width: **132px** when a text action is shown
- Control horizontal padding: **14px**
- Icon size inside toolbar actions: **16px**
- Gap between controls in one toolbar row: **10px**
- Label-to-control gap: **5–8px**

Inputs and action buttons that share a row must use the same visual height. Do not compensate with one-off padding values.

## Toolbar alignment

A toolbar that mixes labelled fields and buttons should align controls by the bottom edge:

```css
.toolbar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.toolbar input,
.toolbar button {
  height: 46px;
}
```

The label sits above the input, while the action button aligns with the input itself.

## Size variants

Do not create arbitrary sizes on individual pages. If a larger or compact control is required, introduce an explicit shared variant (for example `control-lg` or `control-sm`) and use it consistently.

## Dashboard/card rows

For two cards that belong to the same dashboard row:

- Use equal-width columns unless the information hierarchy clearly requires otherwise.
- Cards in the same row should stretch to the same height.
- Use a consistent grid gap, normally **16px**.
- Do not let an empty analytics card collapse while its sibling remains tall.
- On narrow layouts, switch to one column and return cards to natural content height.

Recommended pattern:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.grid > .panel {
  height: 100%;
}
```

## Finance implementation

The Finance workspace follows these rules directly:

- Month picker and refresh button share a 46px height.
- Toolbar icons render at 16px.
- Toolbar text buttons use a 132px minimum width.
- Paired dashboard panels use equal-width columns and equal row height.
- Mobile/tablet layouts return to a single-column natural-height flow.

## Review checklist

Before merging a new ERP page, visually verify:

1. Inputs and adjacent buttons have the same height.
2. Buttons in the same action group use the same size class.
3. Icons are consistent within the same toolbar/action group.
4. Paired dashboard cards align at both the top and bottom edge.
5. Spacing is taken from an existing page/system rule instead of a one-off value.
6. Responsive layouts intentionally change sizing/alignment instead of inheriting broken desktop rules.
