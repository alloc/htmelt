import { Config, Flags } from '@htmelt/plugin'
import fs from 'fs'
import path from 'path'
import { WebExtension } from './types.mjs'

export function isManifestV3(
  manifest: WebExtension.Manifest
): manifest is WebExtension.ManifestV3 {
  return manifest.manifest_version > 2
}

export async function loadManifest(
  webextConfig: WebExtension.Options,
  config: Config,
  flags: Flags
) {
  const { manifest } = webextConfig

  if (flags.watch) {
    const httpServerUrl = config.server.url.href
    const wsServerUrl = httpServerUrl.replace('http', 'ws')

    // The content security policy needs to be lax for HMR to work.
    const csp = parseContentSecurityPolicy(
      (manifest.manifest_version == 2
        ? manifest.content_security_policy
        : manifest.content_security_policy?.extension_pages) || ''
    )
    csp['default-src'] ||= new Set(["'self'"])
    csp['default-src'].add(httpServerUrl)
    csp['connect-src'] ||= new Set(csp['default-src'])
    csp['connect-src'].add(httpServerUrl)
    csp['connect-src'].add(wsServerUrl)
    csp['script-src'] ||= new Set(csp['default-src'] || ["'self'"])
    csp['script-src'].add(httpServerUrl)
    csp['style-src'] ||= new Set(csp['default-src'] || ["'self'"])
    csp['style-src'].add(httpServerUrl)
    csp['style-src'].add("'unsafe-inline'")

    if (manifest.manifest_version == 2) {
      manifest.content_security_policy = csp.toString()
    } else {
      manifest.content_security_policy ||= {}
      manifest.content_security_policy.extension_pages = csp.toString()
    }
  }

  await Promise.all(
    config.plugins.map(
      plugin =>
        plugin.webext?.manifest &&
        plugin.webext.manifest(manifest, webextConfig)
    )
  )

  return {
    ...getManifestFiles(manifest, config, flags),
    manifest,
    backgroundPage:
      manifest.manifest_version == 2 ? manifest.background?.page : undefined,
  }
}

function getManifestFiles(
  manifest: WebExtension.Manifest,
  config: Config,
  flags: Flags
) {
  const ignoredFiles = new Set(fs.readdirSync(process.cwd()))
  const keptFiles = new Set<string>()

  const keepFile = (file: string | undefined, watch?: boolean) => {
    if (typeof file == 'string') {
      let outFile: string
      if (file.startsWith(config.src + '/')) {
        outFile = config.getBuildPath(file)
      } else {
        outFile = file
      }

      // Remove the file and its ancestors from the ignored list.
      outFile
        .split('/')
        .reverse()
        .forEach((file, index, files) => {
          const parentFile = files
            .slice(index + 1)
            .reverse()
            .join('/')

          // Add sibling files to the ignored list.
          if (parentFile) {
            file = files[index] = path.join(parentFile, file)
            if (ignoredFiles.has(parentFile)) {
              fs.readdirSync(parentFile).forEach(child => {
                child = path.join(parentFile, child)
                if (child != file && !keptFiles.has(child)) {
                  ignoredFiles.add(child)
                }
              })
            }
          }

          ignoredFiles.delete(file)
          keptFiles.add(file)
        })

      watch ??= flags.watch && !file.startsWith(config.build + '/')
      if (watch && fs.existsSync(file)) {
        config.watcher?.add(file)
      }
    }
  }

  const noSrcFiles: string[] = []
  const keepFiles = (
    arg:
      | string
      | string[]
      | Record<string, string | string[]>
      | WebExtension.ManifestAction
      | WebExtension.ManifestIcons
      | undefined,
    key?: string | number
  ): string[] => {
    if (arg == null) {
      return noSrcFiles
    }
    if (typeof arg == 'string') {
      keepFile(arg)
      return noSrcFiles
    }
    if (Array.isArray(arg)) {
      return arg.filter((file, index) => {
        keepFile(file)
        if (file.startsWith(config.src + '/')) {
          arg[index] = config.getBuildPath(file)
          return true
        }
      })
    }
    if (key != null) {
      const file: string = Reflect.get(arg, key)
      if (file.startsWith(config.src + '/')) {
        Reflect.set(arg, key, config.getBuildPath(file))
        return [file]
      }
      keepFile(file)
      return noSrcFiles
    }
    for (const key of Object.keys(arg)) {
      keepFiles(arg, key)
    }
    return noSrcFiles
  }

  keepFile('manifest.json')
  keepFile(config.build, false)
  keepFile(config.assets)
  keepFiles(manifest.chrome_url_overrides)
  keepFiles(manifest.icons)

  let backgroundScripts: string[]
  if (manifest.manifest_version == 2) {
    backgroundScripts = keepFiles(manifest.background?.scripts)
    keepFiles(manifest.background, 'page')
    keepFiles(manifest.web_accessible_resources)
    keepFiles(manifest.browser_action, 'default_popup')
    keepFiles(manifest.browser_action?.default_icon)
  } else {
    backgroundScripts = keepFiles(manifest.background, 'service_worker')
    manifest.web_accessible_resources?.forEach(config => {
      keepFiles(config.resources)
    })
    keepFiles(manifest.action, 'default_popup')
    keepFiles(manifest.action?.default_icon)
  }

  const contentScripts =
    manifest.content_scripts
      ?.map(script => [...keepFiles(script.js), ...keepFiles(script.css)])
      .flat() || []

  return {
    scripts: [...backgroundScripts, ...contentScripts].filter(Boolean),
    ignoredFiles,
  }
}

function parseContentSecurityPolicy(str: string) {
  const policies = str.split(/ *; */)
  const result: Record<string, Set<string>> = {}
  for (const policy of policies) {
    if (!policy) continue
    const [name, ...values] = policy.split(/ +/)
    result[name] = new Set(values)
  }
  Object.defineProperty(result, 'toString', {
    value: () => {
      return (
        Object.entries(result)
          .map(([name, values]) => `${name} ${[...values].join(' ')}`)
          .join('; ') + ';'
      )
    },
  })
  return result
}
