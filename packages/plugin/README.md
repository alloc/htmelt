# @htmelt/unocss

[UnoCSS](https://github.com/antfu/unocss) plugin for [HTMelt](https://github.com/alloc/htmelt).

## How It Works

1. It loads your `unocss.config.js` file.
2. It scans your JSX and TSX files for tokens identified by UnoCSS
   plugins/presets.
3. For each JSX and TSX module, it generates a separate CSS file and
   adds it to the document with JavaScript.

## Roadmap

- [ ] Use lightningcss to remove duplicate CSS rules on a per-chunk basis.

## Install

```sh
pnpm install -D @htmelt/unocss
yarn add -D @htmelt/unocss
npm install --save-dev @htmelt/unocss
```

## `import.meta` extensions

The typings of `import.meta` and `import.meta.env` can both be extended
by plugins.

```ts
declare module '@htmelt/plugin/dist/importMeta.mjs' {
  export interface ImportMeta {
    foo: string
  }
  export interface ImportMetaEnv {
    bar: string
  }
}

// Important: Ensure this file is a module
export {}
```

It's recommended to add a `client.d.ts` module to your plugin's root
directory and advise users to include `my-plugin/client` in the `types`
array of their tsconfig (along with `htmelt/client`).

```json
{
  "compilerOptions": {
    "types": ["htmelt/client", "my-plugin/client"]
  }
}
```
