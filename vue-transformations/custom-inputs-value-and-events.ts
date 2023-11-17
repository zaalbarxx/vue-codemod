import {Node, VAttribute} from 'vue-eslint-parser/ast/nodes'
import type { Operation } from '../src/operationUtils'
import * as OperationUtils from '../src/operationUtils'
import {
  default as wrap,
  createTransformAST,
  VueASTFix
} from '../src/wrapVueTransformation'
import { parseTemplate } from '../src/parseTemplate'
import path from 'path'
import fs from 'fs-extra'
import {getComponentEmits, getComponentPropNames, getVueOptions} from '../src/astUtils'

const isEventNode = (node: Node) =>
  node.type === 'VAttribute' &&
  node.key.type === 'VDirectiveKey' &&
  node.key.name.name === 'on' &&
  node.key.argument?.type === 'VIdentifier' &&
  ['input', 'change'].includes(node.key.argument.name)

const isValueNode = (node: Node) =>
  node.type === 'VAttribute' &&
  node.key.type === 'VDirectiveKey' &&
  node.key.name.name === 'bind' &&
  node.key.argument?.type === 'VIdentifier' &&
  node.key.argument.name === 'value'

function nodeFilter(node: Node): boolean {
  return isEventNode(node) || isValueNode(node)
}

const fix: VueASTFix = (
  node: VAttribute,
  source: string,
  { JSAPI: { j, jscodeshift }, file }
): Operation[] => {
  if (
    node.parent?.parent?.type !== 'VElement' ||
    !/[A-Z]/.test(node.parent.parent.rawName.charAt(0))
  ) {
    return []
  }

  const jsAst = jscodeshift(file.source)
  const componentName = node.parent.parent.rawName
  const importDeclaration = jsAst
    .find(j.ImportDeclaration, node =>
      node.specifiers.some(
        (specifier: any) =>
          specifier.type === 'ImportDefaultSpecifier' &&
          specifier.local.name === componentName
      )
    )
    .nodes()[0]

  if (!importDeclaration) {
    console.warn(
      `Could not find import declaration for component ${componentName} in file ${file.path}`
    )
    return []
  }
  let importPath = importDeclaration.source
    .value!.toString()
    .replace('@/', 'src/')
  if (!importPath.includes('.vue')) {
    importPath = `${importPath}.vue`
  }
  importPath = path.resolve(importPath)

  const parseResult = parseTemplate({
    path: importPath,
    source: fs.readFileSync(importPath).toString(),
    extension: '.vue'
  })

  if (!parseResult?.descriptor?.script?.content) {
    return []
  }

  const jsRoot = jscodeshift(parseResult?.descriptor?.script?.content)
  const options = getVueOptions({ j, root: jsRoot, filename: importPath })
  const propNames = getComponentPropNames(options)

  if (isValueNode(node) && !propNames.includes(((node as any).key.argument.name))) {
    return [
      OperationUtils.replaceText(node.key, ':model-value')
    ];
  } else if (isEventNode(node)) {
    const emits = getComponentEmits(options);

    if (!emits.includes((node as any).key.argument.name)) {
      return [
        OperationUtils.replaceText(node.key, '@update:modelValue')
      ]
    }
  }
  return []
}

export const transformAST = createTransformAST(
  nodeFilter,
  fix,
  'remove-listeners'
)

export default wrap(transformAST)
