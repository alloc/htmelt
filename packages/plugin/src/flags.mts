import { WebExtension } from './config.mjs'

/**
 * Arguments passed in through the command line.
 */
export interface Flags {
  watch?: boolean
  minify?: boolean
  critical?: boolean
  webext?: WebExtension.RunTarget | WebExtension.RunTarget[]
}
