export interface ImportMeta {
  env: ImportMetaEnv
  glob: ImportGlobFunction
}

export interface ImportMetaEnv {
  HMR_URL: string
  DEV_URL: string
  DEV: boolean
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
