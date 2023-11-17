import wrap, {
  VueJsAndTemplateTransformation
} from '../src/wrapVueJsAndTemplateTransformation'

export const transformAST: VueJsAndTemplateTransformation = (
  fileInfos,
  options
) => {
  console.log(options.scriptAstRoot, options.templateAstRoot)

  return { script: null, template: [] }
}

export default wrap(transformAST)
