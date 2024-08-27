/// <reference types="chrome" />
import { Config, Flags } from '@htmelt/plugin'
import fs from 'fs'
import path from 'path'
import { WebExtension } from './types.mjs'
import { isFirefoxTarget } from './utils.mjs'

export function isManifestV3(
  manifest: WebExtension.Manifest | WebExtension.AnyManifest
): manifest is WebExtension.ManifestV3 {
  return manifest.manifest_version > 2
}

export async function loadManifest(
  target: WebExtension.Target,
  webextConfig: WebExtension.Options,
  config: Config,
  flags: Flags
) {
  const manifest = (
    typeof webextConfig.manifest === 'function'
      ? webextConfig.manifest(target.platform)
      : webextConfig.manifest
  ) as WebExtension.AnyManifest

  if (!isFirefoxTarget(target)) {
    delete manifest.browser_specific_settings
  }

  if (isManifestV3(manifest)) {
    // Remove permissions meant for other targets.
    if (manifest.permissions) {
      const perms = new Set(manifest.permissions)
      perms.forEach(perm => {
        // Firefox only (MV3)
        if (perm === 'webRequestBlocking' && !isFirefoxTarget(target)) {
          perms.delete(perm)
        }
      })
      manifest.permissions = [...perms]
    }
    processBackgroundWorkerMV3(target.platform, manifest)
  } else {
    // Firefox doesn't support localhost dev server for MV3 extensions,
    // so let's automate some of the effort required to use MV2 for
    // Firefox and MV3 everywhere else. When the `webext.manifest`
    // config function sets the manifest version to 2, we can gracefully
    // rewrite MV3-only settings into MV2-equivalent settings.
    revertMV3Features(manifest)
  }

  await Promise.all(
    config.plugins.map(
      plugin =>
        plugin.webext?.manifest &&
        plugin.webext.manifest(manifest, webextConfig)
    )
  )

  return {
    ...getManifestFiles(manifest as WebExtension.Manifest, config, flags),
    manifest: manifest as WebExtension.Manifest,
  }
}

function getManifestFiles(
  manifest: WebExtension.Manifest,
  config: Config,
  flags: Flags
) {
  const ignoredFiles = new Set(fs.readdirSync(config.root))
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
      if (typeof file == 'string' && file.startsWith(config.src + '/')) {
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

  let backgroundPage: string | undefined
  let backgroundScripts: string[]
  if (manifest.manifest_version == 2) {
    backgroundPage = keepFiles(manifest.background, 'page')[0]
    backgroundScripts = keepFiles(manifest.background?.scripts)
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
      ?.map(script => {
        keepFiles(script.css)
        return keepFiles(script.js)
      })
      .flat() || []

  return {
    backgroundPage,
    backgroundScripts,
    contentScripts,
    ignoredFiles,
  }
}

function revertMV3Features(manifest: WebExtension.AnyManifest) {
  // Remove unsupported properties.
  manifest.declarative_net_request = undefined

  // Remove unsupported permissions.
  if (manifest.permissions) {
    const permissions = new Set(manifest.permissions)
    permissions.delete('declarativeNetRequest')
    permissions.delete('scripting')
    manifest.permissions = [...permissions]
  }

  // Revert action back to browser_action.
  if (manifest.action) {
    if (!manifest.browser_action && !manifest.page_action) {
      manifest.browser_action = manifest.action
    }
    manifest.action = undefined
  }

  // Revert host_permissions back into permissions.
  if (manifest.host_permissions) {
    manifest.permissions ||= []
    manifest.permissions.push(...manifest.host_permissions)
    manifest.host_permissions = undefined
  }

  // Revert CSP object to a string.
  if (
    manifest.content_security_policy &&
    typeof manifest.content_security_policy !== 'string'
  ) {
    manifest.content_security_policy =
      manifest.content_security_policy.extension_pages
  }

  // Revert web_accessible_resources to a string array.
  if (
    manifest.web_accessible_resources?.[0] &&
    typeof manifest.web_accessible_resources[0] !== 'string'
  ) {
    manifest.web_accessible_resources = (
      manifest.web_accessible_resources as { resources: string[] }[]
    ).flatMap(config => config.resources)
  }
}

function processBackgroundWorkerMV3(
  platform: WebExtension.Platform,
  manifest: WebExtension.ManifestV3
) {
  let bg = manifest.background
  if (!bg) {
    return
  }

  // Firefox doesn't support background.service_worker, so rewrite it
  // to be an event-driven background script.
  if (platform !== 'chromium') {
    if (bg.scripts || bg.service_worker) {
      bg = {
        scripts: bg.scripts || [bg.service_worker!],
        persistent: false,
      }
    } else {
      bg = undefined
    }
  }

  // Chromium uses background.service_worker, so remove the
  // background.scripts property if both are defined.
  else if (bg.scripts) {
    if (bg.service_worker) {
      bg = {
        service_worker: bg.service_worker,
        type: bg.type,
      }
    } else {
      bg = undefined
    }
  }

  manifest.background = bg
}
