import { PreVal } from './dist/types.mjs'

declare global {
  namespace preval {
    interface Context extends PreVal {}
  }

  /**
   * Evaluate the given function in a Node.js context at build time. Any
   * value serializable by
   * [`serialize-javascript`](https://github.com/yahoo/serialize-javascript)
   * can be returned.
   *
   * The `context` argument provides some basic helpers.
   * To use another module, you must use dynamic `import`.
   *
   * Nothing outside the function can be used. The only exceptions are
   * functions returned from the `preval` callback, which *can* use
   * anything outside the function (but **nothing** declared in the
   * `preval` callback can be used).
   */
  const preval: {
    <Result>(
      generator: (context: preval.Context) => Result | Promise<Result>
    ): Result
  }
}

export {}
