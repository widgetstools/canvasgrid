/**
 * @cgrid/customizer — the customizer editor surfaces (Cycle 21i).
 *
 * Phase 2 / T5 bootstrap: Lit + @lit/context enter HERE and only here —
 * the kernel stays vanilla-DOM (locked decision 2026-07-04). This
 * package ships the flat-panel chrome subset (visual parity with the
 * kernel settings chrome, same --cg-* tokens) and the LitElement →
 * kernel ToolPanel adapter. Editors (#09 Smart Edit onward) build on
 * these; the heavyweight shared editors (Monaco ExpressionEditor,
 * StyleEditor, FormatterPicker, TemplateManager) land in Phase 3.
 */
export {
  CgcBand,
  CgcField,
  CgcSwitch,
  CgcSelect,
  CgcNumber,
  defineChromeComponents,
  type CgcChangeDetail,
} from './components';
export { litToolPanel, CgcPanelElement, gridApiContext } from './litToolPanel';
