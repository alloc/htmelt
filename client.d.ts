interface ImportMeta {
  env: ImportMetaEnv
  glob: ImportGlobFunction
}

interface ImportMetaEnv {
  HMR_URL: string
  DEV_URL: string
  DEV: boolean
}

declare const process: {
  env: {
    NODE_ENV: string
  }
}

type ImportGlobOptions<TEager extends boolean> = {
  eager?: TEager
  import?: string
}

interface ImportGlobFunction {
  <TEager extends boolean = false>(
    pattern: string | string[],
    options?: ImportGlobOptions<TEager>
  ): TEager extends true
    ? Record<string, unknown>
    : Record<string, () => Promise<any>>
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
