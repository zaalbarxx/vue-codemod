/**
 * Remove `Vue.use()` calls
 * Per current design, `Vue.use` is replaced by `app.use`.
 * But in library implementations like `vue-router` and `vuex`,
 * the new `app.use` does not reuse the same argument passed to `Vue.use()`,
 * but expects instantiated instances that are used to pass to the root components instead.
 * So we now expect the migration to be done in the `root-prop-to-use` transformation,
 * and the `Vue.use` statements can be just abandoned.
 */
import wrap from '../src/wrapAstTransformation'
import type { ASTTransformation } from '../src/wrapAstTransformation'
import { ArrowFunctionExpression } from "jscodeshift";

const wrapperModule = '@/app/core/utils/loadAsyncComponent';
const wrapperFunctionName = 'loadAsyncComponent';

const isModalOrPanel = (moduleName: string) => moduleName.includes('Modal') ||
  moduleName.includes('Panel');

export const transformAST: ASTTransformation<void> = (
  context
) => {
  const {j, root} = context

  const importsWithoutArrowFunction = root.find(j.CallExpression, (node) => {
    return node.callee.type === 'Import' && isModalOrPanel(node.arguments?.[0]?.value ?? '');
  }).filter((node) => {
    if (node.parentPath.value.type === 'ArrowFunctionExpression') {
      return false;
    }

    return true;
  });

  importsWithoutArrowFunction.replaceWith((node) => {
    return j.arrowFunctionExpression([], node.value, true)
  });

  const getFunctionParameter = (nodeArgument: any) => {
    if (nodeArgument.type === 'StringLiteral') {
      return nodeArgument.value;
    }

    if (nodeArgument.type === 'TemplateLiteral') {
      return nodeArgument.quasis[0]?.value.raw;
    }

    return '';
  }
  const importArrowFunctions = root.find(j.ArrowFunctionExpression, (node: ArrowFunctionExpression) => {
    const body = node.body;

    return body.type === 'CallExpression' && body.callee.type === 'Import' &&
      isModalOrPanel(getFunctionParameter(body.arguments[0] ?? ''))
  }).filter(node => {
    // if is already wrapped in `defineAsyncComponent` we will ignore the node
    if (node.parentPath.parentPath?.value.type === 'CallExpression' && node.parentPath.parentPath.value.callee.name === wrapperFunctionName) {
      return false;
    }
    return true;
  });

  const imports = root.find(j.ImportDeclaration, (node) => node.source.value === wrapperModule);

  importArrowFunctions.replaceWith(node => {
    return j.callExpression(j.identifier(wrapperFunctionName), [node.value])
  });


  const hasDefineAsyncComponentImport = imports.some(node => {
    return node.value.specifiers.some(specifier => specifier.type === 'ImportSpecifier' && specifier.imported.name === wrapperFunctionName)
  });

  if (importArrowFunctions.length > 0 && !hasDefineAsyncComponentImport) {
    if (imports.length > 0) {
      imports.nodes()[0].specifiers.unshift(j.importSpecifier(j.identifier(wrapperFunctionName)));
    } else {
      root.get().node.program.body.unshift(j.importDeclaration([j.importSpecifier(j.identifier(wrapperFunctionName))], j.stringLiteral(wrapperModule)));
    }
  }
}


export default wrap(transformAST)
export const parser = 'babylon'
