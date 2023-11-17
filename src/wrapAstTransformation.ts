import type { JSCodeshift, Core } from 'jscodeshift'
import { cliInstance } from './report'
import * as templateParser from 'vue-eslint-parser'
import {Node} from "vue-eslint-parser/ast/nodes";

interface FileInfo {
  /** The absolute path to the current file. */
  path: string
  /** The source code of the current file. */
  source: string
  templateSource?: any;
}

export interface AstTransform {
  (file: FileInfo, api: any, options: any): string | null | undefined | void
  type: string
}

export type Context = {
  root: ReturnType<Core>
  j: JSCodeshift
  filename: string,
  templateRoot?: Node
}

export type ASTTransformation<Params = void> = {
  (context: Context, params: Params): void
}

global.subRules = {}

export default function astTransformationToJSCodeshiftModule<Params = any>(
  transformAST: ASTTransformation<Params>,
  withTemplateAST = false
): AstTransform {
  const transform: AstTransform = (file, api, options: Params) => {
    const j = api.jscodeshift
    let root
    try {
      root = j(file.source)
    } catch (err) {
      cliInstance.stop()
      console.error(
        `JSCodeshift failed to parse ${file.path},` +
          ` please check whether the syntax is valid`
      )
      return
    }

    const parseTemplateAST = () => {
      const source = file.templateSource
      const options = { sourceType: 'module' }
      const ast = templateParser.parse(source, options)
      let root: Node = <Node>ast.templateBody
      return root;
    }

    try {
      transformAST({ root, j, filename: file.path, templateRoot: withTemplateAST && file.templateSource ? parseTemplateAST() : undefined }, options)
    } catch (error) {
      console.error(`Failed to transform ${file.path}`);
      throw error;
    }

    return root.toSource()
  }

  if (withTemplateAST) {
    transform.type = 'jsWithVueTemplate';
  }
  return transform
}
