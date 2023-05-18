/**
 * Arguments passed in through the command line.
 */
export interface Flags {
  watch?: boolean
  minify?: boolean
  outDir?: string
  critical?: boolean

  /** Arguments without an associated flag. */
  pre: string[]
  /** Arguments after the `--` token. */
  post: string[]
}
