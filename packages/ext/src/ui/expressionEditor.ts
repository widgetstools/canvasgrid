/**
 * Re-export the shared CodeMirror expression editor.
 * Implementation lives in `@wellsfargo-starui/velocity-grid-expression/editor`
 * so the DataProvider popout can mount it without depending on ext.
 */
export {
  ExpressionEditor,
  EXPRESSION_BUILTINS,
  PERSPECTIVE_EXPRTK_BUILTINS,
  countPerspectiveColumnRefs,
  type ExpressionEditorOptions,
  type ExpressionColumn,
  type ExpressionFunction,
  type ExpressionDialect,
} from '@wellsfargo-starui/velocity-grid-expression/editor';
