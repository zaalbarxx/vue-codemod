import { parse as parseSFC, SFCDescriptor } from './sfcUtils'
import { debug } from './debug'

export const parseTemplate = ({
  source,
  extension,
  path
}: {
  source: any
  extension: string
  path: string
}): {
  contentStart: number
  contentEnd: number
  astStart: number
  astEnd: number
  descriptor: SFCDescriptor
} | null => {
  let descriptor

  if (extension === '.vue') {
    descriptor = parseSFC(source, { filename: path }).descriptor
  } else {
    // skip non .vue files
    return null
  }

  // skip .vue files without template block
  if (!descriptor.template) {
    debug('skip .vue files without template block.')
    return null
  }
  let contentStart: number =
    descriptor.template.ast.children[0].loc.start.offset
  let contentEnd: number =
    descriptor.template.ast.children[
      descriptor.template.ast.children.length - 1
    ].loc.end.offset + 1
  let astStart = descriptor.template.ast.loc.start.offset
  let astEnd = descriptor.template.ast.loc.end.offset + 1

  return { contentStart, contentEnd, astStart, astEnd, descriptor }
}
