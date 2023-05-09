type ImportMetaExtensions =
  import('@htmelt/plugin/dist/importMeta.mjs').ImportMeta

interface ImportMeta extends ImportMetaExtensions {}

declare const process: {
  env: {
    NODE_ENV: string
  }
}

/** Exists in watch mode only. */
declare var htmelt: {
  modules: Record<string, object>
  import(id: string): object
  export(id: string, exports: htmelt.Export[]): any
}

declare namespace htmelt {
  type Module = {
    exports: Record<string, any>
    rawExports: Export[]
  }

  type Export =
    | { from: string; aliases?: Record<string, string> }
    | { values: Record<string, () => any> }
    | { name: string; get: () => any }
    | [name: string, value: any]
}
