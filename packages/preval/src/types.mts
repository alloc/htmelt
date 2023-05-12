export interface PreVal {
  file: string
  fs: {
    /**
     * Read a file. If the path is relative, it's resolved from the
     * directory containing the file being compiled.
     */
    readFile: (file: string) => string | undefined
    /**
     * List the files in a directory. If the path is relative, it's
     * resolved from the directory containing the file being compiled.
     */
    listFiles: (dir: string) => string[] | undefined
  }
  path: {
    resolve: (...paths: string[]) => string
  }
  process: {
    cwd(): string
  }
}
