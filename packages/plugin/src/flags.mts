/**
 * Arguments passed in through the command line.
 */
export interface Flags {
  watch?: boolean
  outDir?: string

  /** Arguments without an associated flag. */
  pre: string[]
  /** Arguments after the `--` token. */
  post: string[]
}

export interface BundleFlags extends Flags {
  minify?: boolean
  critical?: boolean
}
