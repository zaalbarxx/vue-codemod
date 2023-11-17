import wrap from '../src/wrapAstTransformation'
import type { ASTTransformation } from '../src/wrapAstTransformation'
import {getComponentPropNames, getVueOptions} from '../src/astUtils'
import {
  BlockStatement,
  Collection,
  ObjectExpression,
  ObjectMethod
} from 'jscodeshift'
import { transformAST as addImport } from './add-import'

type Params = {
  useCompositionApi: boolean
}

export const transformAST: ASTTransformation<Params | undefined> = context => {
  const { root, j, filename } = context
  if (filename.includes('.spec')) {
    return
  }

  const vueOptions = getVueOptions(context).filter(
    path => path.value.type === 'ObjectExpression'
  ) as Collection<ObjectExpression>

  if (vueOptions.length === 0) {
    console.warn(`Could not find Vue options for file ${filename}.`)
    return
  }

  const tableManagerUsage = root.find(j.NewExpression, {
    callee: { name: 'AppTableManager' }
  })
  if (tableManagerUsage.length === 0) {
    return root.toSource()
  }

  let setupCall = vueOptions
    .find(j.Property, node => node.key?.name === 'setup')
    .paths()[0]

  let hasSetupCallReturnStatement = setupCall
    ? j(setupCall).find(j.ReturnStatement).length > 0
    : false
  if (!setupCall) {
    vueOptions.forEach(path => {

      const index = path.value.properties.findIndex(
        node =>
          node.type === 'ObjectProperty' &&
          node.key.type === 'Identifier' &&
          node.key.name === 'props'
      )
      const setupCallNode = j.property(
        'init',
        j.identifier('setup'),
        j.functionExpression(
          null,
          [j.identifier('props')],
          j.blockStatement([])
        )
      )
      setupCallNode.method = true
      path.value.properties = insertAt(
        index + 1,
        setupCallNode,
        path.value.properties
      )
    })
    setupCall = vueOptions
      .find(j.Property, { key: { name: 'setup' } })
      .paths()[0]
  } else if (
    setupCall.value.value.type === 'FunctionExpression' &&
    setupCall.value.value.params.length === 0
  ) {
    setupCall.value.value.params = [j.identifier('props')]
  }

  const setupCallBody = (setupCall.value.value as any).body as BlockStatement
  const vueMethods = vueOptions.find(j.ObjectProperty, {
    key: { name: 'methods' }
  })

  const componentPropNames = getComponentPropNames(vueOptions);

  tableManagerUsage.forEach(path => {
    const configuration = path.value.arguments
    const i18nCalls = j(path.value).find(j.CallExpression, node => {
      return (
        node.callee &&
        node.callee.object &&
        node.callee.object.type === 'ThisExpression' &&
        node.callee.property.name === '$t'
      )
    })

    if (i18nCalls.length) {
      const hasI18nDeclared =
        j(setupCall).find(j.CallExpression, { callee: { name: 'useI18n' } })
          .length > 0
      if (!hasI18nDeclared) {
        const property = j.property(
          'init',
          j.identifier('t'),
          j.identifier('t')
        )
        property.shorthand = true
        setupCallBody.body.unshift(
          j.variableDeclaration('const', [
            j.variableDeclarator(
              j.objectPattern([property]),
              j.callExpression(j.identifier('useI18n'), [])
            )
          ])
        )
      }

      i18nCalls.forEach(path => {
        path.value.callee = j.identifier('t')
      })

      addImport(context, {
        specifier: {
          type: 'named',
          imported: 'useI18n'
        },
        source: '@/i18n'
      })
    }

    const methodsUsed = j(path.value).find(j.CallExpression, node => {
      return (
        node.callee &&
        node.callee.object &&
        node.callee.object.type === 'ThisExpression' &&
        node.callee.property.name !== '$t'
      )
    })

    const transformThisPropToPropsProp = (method: Collection) => {
      const propsUsages = method.find(
        j.MemberExpression,
        node =>
          node.object.type === 'ThisExpression' &&
          componentPropNames.includes(node.property.name)
      )
      propsUsages.forEach(propsPath => {
        propsPath.replace(
          j.memberExpression(
            j.identifier('props'),
            j.identifier((propsPath.value.property as any).name)
          )
        )
      })
    }

    const moveMethodToSetup = (methodName: string) => {
      const vueMethod = vueMethods.find(j.ObjectMethod, {
        key: { name: methodName }
      })
      const method = vueMethod.nodes()[0] as ObjectMethod

      if (!method) {
        console.warn(`Could not find method ${methodName} in ${filename} to hoist.`);
        return;
      }

      const functionExpression = j.functionDeclaration(
        j.identifier(methodName),
        method.params,
        method.body
      )

      vueMethod.remove()

      setupCallBody.body = insertAt(
        hasSetupCallReturnStatement
          ? setupCallBody.body.length - 1
          : setupCallBody.body.length,
        functionExpression,
        setupCallBody.body
      )
    }

    methodsUsed.forEach(path => {
      const methodName = (path.value.callee as any).property.name
      const vueMethod = vueMethods.find(j.Property, {
        key: { name: methodName }
      })
      path.value.callee = j.identifier(methodName)
      transformThisPropToPropsProp(vueMethod);
      moveMethodToSetup(methodName)
    })

    const vueMethodsNames = (vueMethods.nodes()[0]?.value as any).properties.map(
      (property: any) => property.key?.name
    ).filter(Boolean) ?? [];

    const methodsUsedAsProperties = j(path.value).find(
      j.MemberExpression,
      node => {
        return (
          node.object &&
          node.property &&
          node.object &&
          node.object.type === 'ThisExpression' &&
          vueMethodsNames.includes(node.property.name)
        )
      }
    )

    methodsUsedAsProperties.forEach(path => {
      const methodName = (path.value.property as any).name
      path.replace(j.identifier(methodName))
      moveMethodToSetup(methodName)
    })

    const declarations = root.find(j.VariableDeclaration, node =>
      node.declarations.some(
        (declaration: any) =>
          declaration.init &&
          declaration.init.callee &&
          declaration.init.callee.name === 'AppTableManager'
      )
    )
    const declarationName = (declarations as any).nodes()[0].declarations[0].id
      .name
    declarations.remove()

    const initializers = root.find(
      j.CallExpression,
      node =>
        node.callee &&
        node.callee.object &&
        node.callee.object.name === declarationName &&
        node.callee.property.name === 'initialize'
    )

    if (initializers.length > 0) {
      setupCallBody.body = insertAt(
        hasSetupCallReturnStatement
          ? setupCallBody.body.length - 1
          : setupCallBody.body.length,
        j.expressionStatement(
          j.callExpression(j.identifier('onMounted'), [
            j.arrowFunctionExpression(
              [],
              j.blockStatement([
                j.expressionStatement(
                  j.callExpression(
                    j.memberExpression(
                      j.identifier('tableManager'),
                      j.identifier('initialize')
                    ),
                    []
                  )
                )
              ])
            )
          ])
        ),
        setupCallBody.body
      )
    }

    initializers.remove()

    const returnStatements = root.find(
      j.ReturnStatement,
      node =>
        node.argument &&
        node.argument.type === 'ObjectExpression' &&
        node.argument.properties.some(
          (property: any) => property.key?.name === declarationName
        )
    )

    returnStatements.forEach(path => {
      const index: number = (path as any).value.argument.properties.findIndex(
        (property: any) => property.key.name === declarationName
      )

      ;(path as any).value.argument.properties = removeAtIndex(
        (path as any).value.argument.properties,
        index
      )
    })

    let setupReturnStatement = j(setupCall)
      .find(j.ReturnStatement)
      .filter(path => {
        return (
          path.parent.parent &&
          path.parent.parent.parent &&
          path.parent.parent.parent.value.key &&
          path.parent.parent.parent.value.key.name === 'setup'
        )
      })
      .nodes()[0]

    if (!setupReturnStatement) {
      const setupReturn = j.returnStatement(j.objectExpression([]))
      setupCallBody.body.push(setupReturn)
      setupReturnStatement = setupReturn
    }

    const tableManagerReturnProperty = j.property(
      'init',
      j.identifier('tableManager'),
      j.identifier('tableManager')
    )

    tableManagerReturnProperty.shorthand = true
    ;(setupReturnStatement as any).argument.properties.push(
      tableManagerReturnProperty
    )

    const onMountedIndex = setupCallBody.body.findIndex(
      statement =>
        statement.type === 'ExpressionStatement' &&
        (statement as any).expression.callee.name === 'onMounted'
    )

    transformThisPropToPropsProp(j(configuration));

    setupCallBody.body = insertAt(
      onMountedIndex !== -1 ? onMountedIndex : setupCallBody.body.length - 1,
      j.variableDeclaration('const', [
        j.variableDeclarator(
          j.identifier('tableManager'),
          j.callExpression(j.identifier('useTableManager'), [configuration[0]])
        )
      ]),
      setupCallBody.body
    )

    addImport(context, {
      specifier: {
        type: 'named',
        imported: 'onMounted'
      },
      source: 'vue'
    })

    addImport(context, {
      specifier: {
        type: 'named',
        imported: 'useTableManager'
      },
      source: '@/app/shared/components/AppTable/AppTableManager'
    })
  })
}

function insertAt(index: number, value: any, array: any[]) {
  return [...array.slice(0, index), value, ...array.slice(index)]
}

const removeAtIndex = (array: any[], index: number) => {
  return array.filter((element, elementIndex) => elementIndex !== index)
}

export default wrap(transformAST)
export const parser = 'babylon'
