/**
 * @cgrid/customizer — the customizer editor surfaces (Cycle 21i).
 *
 * Lit chrome + Smart Edit / Bulk Update panels + ExpressionEditor foundation.
 * CodeMirror can replace the textarea later; Monaco is not the locked path.
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
export { smartEditToolPanel } from './panels/smartEdit';
export { bulkUpdateToolPanel } from './panels/bulkUpdate';
export { switchRow, numberRow, type SwitchRowSpec, type NumberRowSpec } from './panels/rows';
export {
  CgcExpressionEditor,
  defineExpressionEditor,
} from './expressionEditor';
