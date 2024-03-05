# @htmelt/env

Import environment variables from a file at build time.

This plugin is an alternative to using `import.meta.env` and the
`esbuild.define` config option, which is verbose and clumsy to setup.

## Usage

Add the following to your `tsconfig.json` compiler options:

```json
"types": ["@htmelt/env/client"],
```

Then, anywhere in your project, you can use the `inlinedEnvFile` function to
import environment variables from a file at build time.

```ts
interface Variables {
  FOO: string
}

// The given path is relative to the current module. It can point to a file
// or a folder. If a folder is passed, a mode-specific file (e.g. ".env.development")
// will be used if it exists.
export const env = inlinedEnvFile<Variables>('./')
```

## Install

```sh
pnpm install -D @htmelt/env
yarn add -D @htmelt/env
npm install --save-dev @htmelt/env
```
