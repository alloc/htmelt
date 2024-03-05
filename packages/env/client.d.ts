declare global {
  /**
   * Load an environment file at build time and embed the parsed variables into
   * the code. If a folder is passed, it will load the `.env` file inside it,
   * and if `.env.${NODE_ENV}` file exists, it will be loaded instead.
   */
  const inlinedEnvFile: {
    <Variables extends object = Record<string, string>>(
      fileOrFolder: string
    ): Variables
  }
}

export {}
