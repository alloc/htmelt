# @htmelt/webext

Develop web extensions with `htmelt`.

&nbsp;

## Features

- Automatic extension reloading
- Support for Chromium and Firefox
- TypeScript definitions for `manifest.json` schema
- Platform-specific logic with `import.meta.platform`

&nbsp;

## Install

```sh
pnpm install -D @htmelt/unocss
yarn add -D @htmelt/unocss
npm install --save-dev @htmelt/unocss
```

&nbsp;

## Quick Start

First, make sure you have `manifest.json` in your gitignore file, because it will be generated automatically.

```sh
echo manifest.json >> .gitignore
```

If you have a manifest in your project already, move it into your `bundle.config.js` file.

```js
// bundle.config.js
import webext from '@htmelt/webext'

export default {
  plugins: [
    webext({
      manifest: { ... },
    })
  ]
}
```

Then, add the following to your `package.json`:

```json
{
  "scripts": {
    "build": "htmelt",
    "build:chrome": "htmelt --platform chrome",
    "build:firefox": "htmelt --platform firefox",
    "dev": "htmelt --watch",
    "dev:chrome": "htmelt --watch --platform chrome",
    "dev:firefox": "htmelt --watch --platform firefox"
  }
}
```

&nbsp;

## Usage

When using the `htmelt` command in your terminal, you should include the
`--platform` flag if you have multiple `targets` defined; otherwise, the
first target will always be used.

```sh
htmelt --platform chromium
```

You can use these platform aliases if you prefer:

- `chrome` is an alias for `chromium`
- `firefox` is an alias for `firefox-desktop`

&nbsp;

### Platform-specific behavior

Use `import.meta.platform` to check if the extension is running in
Chromium or Firefox.

```ts
if (import.meta.platform === 'chromium') {
  // Chromium-specific code
} else {
  // Firefox-specific code
}
```

The condition is evaluated at build time, so the code that is not
relevant to the current platform will be removed from the bundle.

For `import.meta.platform` to be recognized in TypeScript, you need to
include `@htmelt/webext` and `htmelt/client` in the `types` array of
your tsconfig.

```json
{
  "compilerOptions": {
    "types": ["@htmelt/webext"]
  }
}
```

### Conditional manifest

The `manifest` option can be a function that takes the target platform. By default, the returned manifest object allows both MV3 and MV2 properties. If you want strict type safety for either MV2 or MV3, you can declare the return type explicitly.

```ts
// bundle.config.mts
import { defineConfig } from 'htmelt/config.mjs'
import webext, { WebExtension } from '@htmelt/webext'

export default defineConfig({
  plugins: [
    webext({
      manifest: (platform): WebExtension.ManifestV3 => ({
        manifest_version: 2, // Type '2' is not assignable to type '3'. ts(2322)
      }),
    }),
  ],
})
```
