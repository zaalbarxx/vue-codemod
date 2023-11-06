import wrap from '../src/wrapAstTransformation'
import type { ASTTransformation } from '../src/wrapAstTransformation'
import { getCntFunc } from '../src/report'
import * as templateParser from 'vue-eslint-parser';
import {Node, ESLintExpressionStatement, ESLintCallExpression, ESLintLiteral} from 'vue-eslint-parser/ast/nodes'

export const transformAST: ASTTransformation = ({ root, j, templateRoot }) => {
  let templateEmits: string[] = [];

  const isEmitExpression = (node: Node): node is ESLintExpressionStatement => {
    return node.type === 'ExpressionStatement' &&
    node.expression?.type === 'CallExpression' &&
    "name" in node.expression.callee &&
    node.expression.callee.name === '$emit' && node.expression.arguments[0]?.type === 'Literal';
  }

  if (templateRoot) {
    templateParser.AST.traverseNodes(templateRoot, {
      enterNode(node: Node) {
        if (
          node.type === 'VAttribute' &&
          node.directive && node.key.name.name === 'on' &&
          node.value?.type === 'VExpressionContainer' &&
          node.value?.expression?.type === 'VOnExpression'
        ) {
          templateEmits.push(
            ...node.value.expression.body
            .filter(isEmitExpression)
            .map(node => ((node.expression as ESLintCallExpression).arguments[0] as ESLintLiteral).value as string)
          );
        }
      },
      leaveNode() {}
    });

  }

  // find the export default
  const defaultExportBody = root.find(j.ExportDefaultDeclaration)
  // stats
  const cntFunc = getCntFunc('add-emit-declarations', global.outputReport)
  // find the CallExpression
  const emitCalls = defaultExportBody.find(j.CallExpression, node => {
    return (
      node.callee.object?.type === 'ThisExpression' &&
      node.callee.property?.name === '$emit'
    )
  })

  let scriptEmits: string[] = [];
  const emitsProperty = defaultExportBody.find(j.ObjectProperty, node => {
    return node.key.name === 'emits' && node.value.type === 'ArrayExpression'
  })
  const hasEmitsProperty = emitsProperty.length > 0;

  const emitItems = emitsProperty.length
    ? [...emitsProperty.get(0).node.value.elements]
    : []
  const existingEmits = emitItems.map((r: { value: string }) => r.value);

  if (emitCalls.length) {
    // find the $emit argument
    emitCalls.forEach(({ node }) => {
      if (node.arguments[0]?.type === 'StringLiteral') {
        scriptEmits.push(node.arguments[0].value)
      }
    })
  }

  const allEmits = Array.from(new Set([...templateEmits, ...scriptEmits]));

  if (allEmits.length) {
    allEmits.forEach(r => {
      if (!existingEmits.includes(r)) {
        emitItems.push(j.stringLiteral(r));
      }
    });

    if (!hasEmitsProperty) {
      const rootNode = defaultExportBody
        .get(0)
        .node.declaration;
      const componentOptions = rootNode.callee.loc.identifierName === 'defineComponent' ? rootNode.arguments[0] : rootNode;
      // no emits property then create emits:[...]  AST
      const propsToPlaceEmitsAfter = ['name', 'components', 'props'];
      const latestIndex = componentOptions?.properties.reduce((acc: number, node: any, index: number) => {
        if (propsToPlaceEmitsAfter.includes(node.key.name) && index > acc) {
          return index;
        }
        return acc;
      }, 0) ?? 0;

      const emitsExpression = j.objectProperty(j.identifier('emits'), j.arrayExpression(emitItems));

      if (componentOptions.properties) {
        componentOptions.properties = [...componentOptions.properties.slice(0, latestIndex + 1), emitsExpression, ...componentOptions.properties.slice(latestIndex + 1)]
        cntFunc();
      }
    } else {
      const emitsObjectProperty = emitsProperty.get(0).parentPath;
      emitsObjectProperty.value.value = j.arrayExpression(emitItems);
    }
  }
}

export default wrap(transformAST, true)
export const parser = 'babylon'
