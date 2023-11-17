import jscodeshift, { Transform, Parser } from 'jscodeshift'
// @ts-ignore
import getParser from 'jscodeshift/src/getParser'

import { parse as parseSFC, stringify as stringifySFC } from './sfcUtils'
import type { SFCDescriptor } from './sfcUtils'

import VueTransformation from './VueTransformation'
import {parseTemplate} from "./parseTemplate";
import {debug} from "./debug";

type FileInfo = {
  path: string
  source: string
  templateSource?: any
}

type JSTransformation = Transform & {
  type: 'JSTransformation'
  parser?: string | Parser
}

type JSTransformationModule =
  | JSTransformation
  | {
      default: Transform
      parser?: string | Parser
    }

type VueTransformationModule =
  | VueTransformation
  | {
      default: VueTransformation
    }

export type TransformationModule =
  | JSTransformationModule
  | VueTransformationModule

export default function runTransformation(
  fileInfo: FileInfo,
  transformationModule: TransformationModule,
  params: object = {}
) {
  let transformation: VueTransformation | JSTransformation
  // @ts-ignore
  if (typeof transformationModule.default !== 'undefined') {
    // @ts-ignore
    transformation = transformationModule.default
  } else {
    // @ts-ignore
    transformation = transformationModule
  }

  const { path, source } = fileInfo
  const extension = (/\.([^.]*)$/.exec(path) || [])[0]
  let lang = extension.slice(1)
  let descriptor: SFCDescriptor

  if (transformation.type === 'vueTransformation') {
    const parseResult = parseTemplate({ path, source, extension })

    if (!parseResult) {
      return source
    }

    const { contentStart, contentEnd, astStart, astEnd, descriptor } =
      parseResult

    if (!descriptor.template) {
      debug('skip .vue files without template block.')
      return source
    }

    fileInfo.source = descriptor.template.ast.loc.source

    const api = getJSCodeshiftAPI(transformationModule, lang)
    const JSFileInfo = {
      // eslint-disable-next-line no-restricted-syntax
      ...fileInfo,
      lang: descriptor.script?.lang || 'js',
      source: descriptor.script?.content ?? ''
    }
    // eslint-disable-next-line no-restricted-syntax
    const out = transformation(fileInfo, { ...params, JSAPI: api, JSFileInfo })

    if (!out) {
      return source
    }

    // need to reconstruct the .vue file from descriptor blocks
    if (extension === '.vue') {
      if (out === descriptor!.template!.content) {
        return source // skipped, don't bother re-stringifying
      }
      // remove redundant <template> tag
      descriptor!.template!.content = out.slice(
        contentStart - astStart,
        contentEnd - astEnd
      )
      return stringifySFC(descriptor!)
    }

    return out
  } else {
    debug('Running jscodeshift transform')

    if (extension === '.vue') {
      descriptor = parseSFC(source, { filename: path }).descriptor

      // skip .vue files without script block
      if (!descriptor.script) {
        debug('skip .vue files without script block.')
        return source
      }

      global.scriptLine = descriptor.script.loc.start.line

      lang = descriptor.script.lang || 'js'
      fileInfo.source = descriptor.script.content
      if (transformation.type === 'jsWithVueTemplate') {
        fileInfo.templateSource = descriptor.template?.ast.loc.source
      }
    }

    const api = getJSCodeshiftAPI(transformationModule, lang)

    const out = transformation(fileInfo, api, params)
    if (!out) {
      return source // skipped
    }

    // need to reconstruct the .vue file from descriptor blocks
    if (extension === '.vue') {
      if (out === descriptor!.script!.content) {
        return source // skipped, don't bother re-stringifying
      }

      descriptor!.script!.content = out
      return stringifySFC(descriptor!)
    }

    return out
  }
}

const getJSCodeshiftAPI = (transformationModule: any, lang: string) => {
  let parser = getParser()
  let parserOption = (transformationModule as JSTransformationModule).parser
  // force inject `parser` option for .tsx? files, unless the module specifies a custom implementation
  if (typeof parserOption !== 'object') {
    if (lang.startsWith('ts')) {
      parserOption = lang
    }
  }

  if (parserOption) {
    parser =
      typeof parserOption === 'string' ? getParser(parserOption) : parserOption
  }

  const j = jscodeshift.withParser(parser)
  const api = {
    j,
    jscodeshift: j,
    stats: () => {},
    report: () => {}
  }

  return api
}
