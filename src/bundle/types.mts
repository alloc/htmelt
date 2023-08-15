import { esbuild, Plugin } from '@htmelt/plugin'

/** An in-progress bundle */
export type PartialBundle = {
  id: string
  hmr: boolean
  scripts: Set<string>
  importers: Plugin.Document[]
  entries?: Set<string>
  context?: esbuild.BuildContext<{ metafile: true }>
  metafile?: esbuild.Metafile
  /** Same as `metafile.inputs` but mapped with `fileToId` */
  inputs?: string[]
  /** Raw CSS code to be concatenated, minified, and injected into the document */
  injectedStyles?: string[]
}
