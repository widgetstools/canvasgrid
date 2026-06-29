# 10 — visual-excel

> Translate on-screen styling (cell colors, borders, fonts, conditional-styling rules) and number formats into AG-Grid's `excelStyles` registry so XLSX exports mirror the visual appearance.

## Purpose

When a user clicks "Export to Excel", the XLSX file should look like the on-screen grid — same colors, fonts, borders, number formats, conditional rules applied. AG-Grid's export supports an `excelStyles` config; this module produces it from the other modules' state.

## Config schema

```ts
interface VisualExcelState {
  settings: VisualExcelSettings;
}

interface VisualExcelSettings {
  enabled: boolean;            // master switch — when false, export uses plain AG-Grid excel
  fileNamePrefix: string;      // generates default filenames like `markets-grid-2026-06-29.xlsx`
}
```

The module itself carries almost no config. Its inputs are read at export time from column-customization and conditional-styling.

## Runtime behavior

### Build at export time

```ts
function buildVisualExcelStyles(input: {
  columnCustomization: ColumnCustomizationState;
  conditionalStyling: ConditionalStylingState;
  themeMode: 'light' | 'dark';                // chosen by user at export time
}): ExcelStyle[] {
  const styles: ExcelStyle[] = [];

  // 1. Header style baseline
  styles.push(VISUAL_EXCEL_HEADER_STYLE);

  // 2. Cell style baseline
  styles.push(VISUAL_EXCEL_CELL_STYLE);

  // 3. Per-column styles from column-customization
  for (const [colId, assignment] of Object.entries(columnCustomization.assignments)) {
    const themeSlice = pickThemeSlice(assignment.cellStyleOverrides, themeMode);
    if (hasStyling(themeSlice)) {
      styles.push({
        id: `ds-col-${cssEscapeColId(colId)}`,
        ...cellStyleToExcelStyle(themeSlice),
      });
    }
  }

  // 4. Number format styles (de-duped by format string hash)
  const formatHashes = collectFormatHashes(columnCustomization);
  for (const [hash, formatString] of formatHashes) {
    styles.push({
      id: `ds-fmt-${hash}`,
      ...numberFormatExcelStyle(formatString),
    });
  }

  // 5. Conditional-styling rules (one per rule, keyed by rule id)
  for (const rule of conditionalStyling.rules) {
    const themeSlice = pickThemeSlice(rule.style, themeMode);
    styles.push({
      id: `ds-rule-${rule.id}`,
      ...cellStyleToExcelStyle(themeSlice),
    });
  }

  return styles;
}
```

### Cell class stamping

`applyFormatExcelClasses()` writes `cellClassRules` onto columns that carry number formats so the export machinery applies the format style when serializing cells. Without this, the format hash class never appears on a cell and the style is unused.

### CSS-to-Excel conversion

`cellStyleToExcelStyle()` maps CSS properties to Excel equivalents:
- `color` → Excel font color
- `backgroundColor` → Excel interior (fill)
- `fontWeight: 'bold'` → Excel font bold
- `fontStyle: 'italic'` → Excel font italic
- `textAlign` → Excel horizontal alignment
- `borderColor/Width/Style` → Excel 4-side borders (native, not box-shadow)

`cssToExcelColor()` handles CSS color names, hex, rgb, hsl → Excel ARGB hex.

### Border handling

In the on-screen rendering, borders ride on a `::after` pseudo-element with real `border` properties (not `box-shadow`) because inset box-shadow silently drops the `style` attribute (dashed/dotted never render). The Excel converter mirrors this as native 4-side borders.

## UI surface

None in engine. Host wires:
- Export button → call `buildVisualExcelStyles(...)` → pass into AG-Grid's `exportDataAsExcel({ excelStyles: ... })`
- "Excel export theme" picker if the user wants to export in dark theme vs light

## Persistence

Just settings (enabled flag + filename prefix). No dynamic state.

## Dependencies

- [column-customization](05-column-customization.md): cell styles, number formats, column assignments
- [conditional-styling](03-conditional-styling.md): rule styles
- `cssEscapeColId()` shared helper

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/visual-excel/buildVisualExcelStyles.ts](../../../starui/packages/shared/engine/src/customizer/modules/visual-excel/buildVisualExcelStyles.ts)
- [../starui/packages/shared/engine/src/customizer/modules/visual-excel/cellStyleToExcelStyle.ts](../../../starui/packages/shared/engine/src/customizer/modules/visual-excel/cellStyleToExcelStyle.ts)
- [../starui/packages/shared/engine/src/customizer/modules/visual-excel/cssToExcelColor.ts](../../../starui/packages/shared/engine/src/customizer/modules/visual-excel/cssToExcelColor.ts)
- [../starui/packages/shared/engine/src/customizer/modules/visual-excel/formatExcelClassId.ts](../../../starui/packages/shared/engine/src/customizer/modules/visual-excel/formatExcelClassId.ts)

## Design decisions worth copying

- **Theme slice at export time.** Pick light or dark based on user's export choice, not the active theme. Same profile exports correctly under both themes.
- **De-duped format strings.** Collect unique format strings; emit one `ExcelStyle` per format; every matching column references the shared style by ID. Saves bytes in large exports.
- **Class-based styling.** Excel styles tied to CSS classes (`ds-rule-<id>`, `ds-fmt-<hash>`) — same class names the on-screen render uses. Clean separation: visual rules don't know about export.
- **4-side native borders.** Excel doesn't have inset shadow. Translate borders to Excel's native 4-side border properties; matches what users authored.
- **Module is mostly stateless.** No runtime persistence. Build at export time, throw away. Keeps the module light.

## cgrid translation

cgrid already has CSV + XLSX writers in the worker. visual-excel maps onto two places:

1. **Style registry on the XLSX writer.** Already partly built for cgrid's recent export cycle. Needs to accept a styles registry from the main thread and apply per cell during serialization. Add the `ExcelStyle`-shaped contract.

2. **Class collection on the main thread.** When triggering export, walk column-customization + conditional-styling state, emit the style registry, transfer to the worker.

cgrid's renderer already has the cell-class concept (or will, after conditional-styling lands) — the export path can reuse the same class assignments.

One simplification vs. AG-Grid: cgrid controls both the renderer AND the export. The CSS-to-Excel translation can be eliminated by using the same style object shape in both places — no conversion needed. **Recommended: define a normalized `CellStyle` interface that both the canvas renderer and the XLSX writer consume.** CSS conversion only matters if you also need to inject the same style into HTML overlays (header tooltips, popups).
