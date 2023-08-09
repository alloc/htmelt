/**
 * Arguments passed in through the command line.
 */
export interface Flags {
  base?: string
  outDir?: string
  port?: number
  watch?: boolean
}

export interface BundleFlags extends Flags {
  deletePrev?: boolean
  minify?: boolean
}

export interface LeadingArgv {
  /** Arguments without an associated flag. */
  pre: string[]
}

export interface TrailingArgv {
  /** Arguments after the `--` token. */
  post: string[]
}
