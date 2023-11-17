import { Collection, FileInfo, JSCodeshift } from 'jscodeshift'
import * as parser from 'vue-eslint-parser'
import { Node } from 'vue-eslint-parser/ast/nodes'
import { cliInstance } from './report'
import { applyOperation } from './wrapVueTransformation'
import { Operation } from './operationUtils'

export interface Options extends Record<string, any> {
  j: JSCodeshift
  jscodeshift: JSCodeshift
  stats: () => void
  report: () => void
  templateAstRoot: Node | null
  scriptAstRoot: Collection<any> | null
}

type TransformationResult = string | null | undefined | void
type Transformations = {
  script: TransformationResult
  template: TransformationResult
}

type TransformationOptions = Options

export type VueJsAndTemplateTransformation<Params = any> = {
  (
    fileInfos: { template: FileInfo; js: FileInfo },
    options: TransformationOptions
  ): {
    script: TransformationResult
    template: Operation[]
  }
}

type Transform = {
  (
    fileInfos: { template: FileInfo; js: FileInfo },
    options: TransformationOptions
  ): Transformations
  type: 'vueJsAndTemplateTransformation'
}

export default function wrapVueJsAndTemplateTransformation<
  Params extends TransformationOptions
>(transformAST: VueJsAndTemplateTransformation<Params>): Transform {
  const transform: Transform = (fileInfos, options: Options) => {
    const templateSource = fileInfos.template.source
    let templateAstRoot: Node | null = null

    if (templateSource) {
      const options = { sourceType: 'module' }
      const ast = parser.parse(templateSource, options)
      templateAstRoot = <Node>ast.templateBody;
    }

    let scriptAstRoot = null

    if (fileInfos.js.source) {
      const j = options.jscodeshift
      try {
        scriptAstRoot = j(fileInfos.js.source)
      } catch (err) {
        cliInstance.stop()
        console.error(
          `JSCodeshift failed to parse ${fileInfos.js.path},` +
            ` please check whether the syntax is valid`
        )
        return { script: null, template: null }
      }
    }

    const { template: templateOperations, script } = transformAST(fileInfos, {
      ...options,
      templateAstRoot,
      scriptAstRoot
    })

    return {
      template: templateSource
        ? applyOperation(templateSource, templateOperations)
        : null,
      script
    }
  }

  transform.type = 'vueJsAndTemplateTransformation'

  return transform
}
