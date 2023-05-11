import { Flags, Plugin } from '@htmelt/plugin'
import chromeRemote from 'chrome-remote-interface'
import exitHook from 'exit-hook'
import fs from 'fs'
import { cyan, yellow } from 'kleur/colors'
import path from 'path'
import { Promisable } from 'type-fest'
import { cmd as webExtCmd } from 'web-ext'
import { applyDevCSP } from './csp.mjs'
import { isManifestV3, loadManifest } from './manifest.mjs'
import { WebExtension } from './types.mjs'
import { findFreeTcpPort, replaceHomeDir, toArray } from './utils.mjs'

type InternalEvents = {
  reload: (() => Promisable<void>)[]
}

export default (options: WebExtension.Options): Plugin =>
  async (config, flags) => {
    const { manifest, scripts, ignoredFiles, backgroundPage } =
      await loadManifest(options, config, flags)

    // Manifest V2 only.
    const backgroundEntry = backgroundPage
      ? config.entries.find(e => e.file == backgroundPage)
      : undefined

    if (backgroundEntry) {
      backgroundEntry.bundleId = backgroundPage
      backgroundEntry.hmr = false
    }

    // Add the web extension scripts to the build.
    config.entries.push(...scripts.map(file => ({ file })))

    const target = resolveTarget(options, flags)
    config.esbuild.define['import.meta.platform'] = JSON.stringify(
      target.platform
    )

    const events: InternalEvents = {
      reload: [],
    }

    return {
      async initialBuild() {
        if (isManifestV3(manifest)) {
          // Remove permissions meant for other targets.
          if (manifest.permissions) {
            const perms = new Set(manifest.permissions)
            perms.forEach(perm => {
              // Firefox only (MV3)
              if (perm === 'webRequestBlocking' && !isFirefox(target)) {
                perms.delete(perm)
              }
            })
            manifest.permissions = [...perms]
          }

          // Write inline rules to new files in the build directory.
          manifest.declarative_net_request?.rule_resources.forEach(
            (resource, index, resources) => {
              if ('rules' in resource) {
                const resourcePath = path.join(
                  config.build,
                  'declarative_net_request',
                  'rule_resources',
                  resource.id + '.json'
                )

                fs.mkdirSync(path.dirname(resourcePath), { recursive: true })
                fs.writeFileSync(resourcePath, JSON.stringify(resource.rules))

                resources[index] = {
                  ...resource,
                  rules: undefined,
                  path: path.relative(process.cwd(), resourcePath),
                }
              }
            }
          )
        }

        // Pack the web extension for distribution.
        if (!flags.watch) {
          writeManifest(target.platform, manifest)

          await webExtCmd.build({
            sourceDir: process.cwd(),
            artifactsDir: path.resolve(
              options.artifactsDir || 'web-ext-artifacts',
              target.platform
            ),
            ignoreFiles: [...ignoredFiles],
            overwriteDest: true,
          })
        }
      },
      async fullReload() {
        for (const handler of events.reload) {
          await handler()
        }
      },
      hmr(clients) {
        applyDevCSP(manifest, config)
        writeManifest(target.platform, manifest)

        developExtension(target, options, manifest, clients, events).catch(
          console.error
        )

        clients.on('connect', ({ client }) => {
          client.evaluate('[location.protocol, location.host]').then(result => {
            if (Array.isArray(result)) {
              const [protocol, host] = result
              if (protocol) {
                client.emit('webext:uuid', { protocol, host })
              }
            }
          })
        })
      },
      commands(cli) {
        cli.commands.default.option(
          '--platform <platform>',
          'Browser target for web-ext (e.g. chrome, firefox)'
        )
      },
    }
  }

const platformAliases: Record<string, WebExtension.Platform> = {
  chrome: 'chromium',
  firefox: 'firefox-desktop',
}

function resolveTarget(
  options: WebExtension.Options,
  flags: Flags
): WebExtension.Target {
  const targets = options.targets || ['chromium']
  const platform =
    flags.platform && (platformAliases[flags.platform] || flags.platform)

  let target: WebExtension.Target | WebExtension.Platform | undefined
  if (platform) {
    target = targets.find(
      target =>
        platform === (typeof target === 'string' ? target : target.platform)
    )
    if (!target) {
      throw Error(`unknown browser target: "${platform}"`)
    }
  } else {
    target = targets[0]
  }

  if (typeof target === 'string') {
    return { platform: target }
  }

  return target
}

function isFirefox(
  target: WebExtension.Target
): target is WebExtension.FirefoxTarget {
  return target.platform.startsWith('firefox')
}

async function developExtension(
  target: WebExtension.Target,
  options: WebExtension.Options,
  manifest: WebExtension.Manifest,
  clients: Plugin.ClientSet,
  events: InternalEvents
) {
  const runOptions: WebExtension.RunOptions &
    WebExtension.ChromiumRunOptions &
    WebExtension.FirefoxRunOptions = { ...options.run, ...target.run }

  const artifactsDir = path.resolve(
    options.artifactsDir || 'web-ext-artifacts',
    target.platform
  )

  let port: number | undefined

  const params = {} as import('web-ext').CmdRunParams
  if (target.platform == 'chromium') {
    params.chromiumBinary = replaceHomeDir(runOptions.binary)
    params.chromiumProfile = replaceHomeDir(runOptions.profile)
    params.args = runOptions.args
  } else if (target.platform == 'firefox-desktop') {
    params.firefox = replaceHomeDir(runOptions.binary || 'firefox')
    params.firefoxProfile = replaceHomeDir(runOptions.profile)
    params.firefoxPreview = []
    params.preInstall = !!runOptions.preInstall
    params.devtools = !!runOptions.devtools
    params.browserConsole = !!runOptions.browserConsole

    const args = runOptions.args || []
    port = await findFreeTcpPort()
    args.push('--remote-debugging-port', port.toString())
    params.args = args
  }

  const runner = await webExtCmd.run({
    ...params,
    target: [target.platform],
    sourceDir: process.cwd(),
    artifactsDir: path.resolve(artifactsDir, target.platform),
    keepProfileChanges: runOptions.keepProfileChanges ?? false,
    profileCreateIfMissing: !!(params.chromiumProfile || params.firefoxProfile),
    noReload: true,
  })

  await refreshOnRebuild(
    target.platform,
    runner,
    clients,
    events,
    manifest,
    toArray(runOptions.startUrl || 'about:newtab'),
    port
  ).catch(e => {
    console.error(
      '[%s] Error during setup:',
      target,
      e.message.includes('404 Not Found')
        ? 'Unsupported CDP command'
        : e.message
    )
  })
}

const aboutDebuggingRE = /^about:debugging(#|$)/

async function refreshOnRebuild(
  platform: WebExtension.Platform,
  runner: import('web-ext').MultiExtensionRunner,
  clients: Plugin.ClientSet,
  events: InternalEvents,
  manifest: WebExtension.Manifest,
  tabs: string[],
  firefoxPort?: number
) {
  let port: number
  let extProtocol: string

  const isChromium = platform == 'chromium'
  if (isChromium) {
    const instance = runner.extensionRunners[0].chromiumInstance!
    port = instance.port!
    extProtocol = 'chrome-extension:'

    // For some reason, the Chrome process may stay alive if we don't
    // kill it explicitly.
    exitHook(() => {
      instance.process.kill()
    })
  } else if (firefoxPort) {
    port = firefoxPort
    extProtocol = 'moz-extension:'
  } else {
    return
  }

  if (tabs.length) {
    let resolvedTabs = tabs
    if (platform == 'firefox-desktop') {
      resolvedTabs = resolveFirefoxTabs(tabs, manifest, runner)
    } else {
      resolvedTabs = tabs.map(url =>
        url == 'about:newtab'
          ? 'chrome://newtab/'
          : aboutDebuggingRE.test(url)
          ? 'chrome://extensions/'
          : url
      )
    }
    await openTabs(port, resolvedTabs, manifest, isChromium)
  }

  let uuid: string
  clients.on('webext:uuid', event => {
    if (event.protocol == extProtocol) {
      uuid = event.host
    }
  })

  if (isChromium) {
    // Ensure not all tabs will be closed as a result of the extension
    // being reloaded, since that will cause an unsightly reopening of
    // the browser window.
    events.reload.push(async () => {
      const extOrigin = extProtocol + '//' + uuid
      const pages = (await chromeRemote.List({ port })).filter(
        tab => tab.type == 'page'
      )
      if (
        pages.length > 0 &&
        pages.every(tab => tab.url.startsWith(extOrigin))
      ) {
        const firstPage = await chromeRemote({
          port,
          target: pages[0].id,
        })
        await firstPage.send('Page.navigate', {
          url: 'chrome://newtab/',
        })
      }
    })
  }

  events.reload.push(async () => {
    const extOrigin = extProtocol + '//' + uuid

    if (!uuid) {
      console.warn('[%s] ' + yellow('⚠'), platform, 'Extension UUID not found')
      return
    }

    console.log(cyan('↺'), extOrigin)

    // Chromium reloads automatically, and we can't stop it.
    if (!isChromium) {
      await runner.reloadAllExtensions()
    }

    const newTabPage = manifest.chrome_url_overrides?.newtab
    const newTabUrl = newTabPage
      ? `${extOrigin}/${newTabPage}`
      : isChromium
      ? 'chrome://newtab/'
      : 'about:newtab'

    const currentTabs = await chromeRemote.List({ port })
    const missingTabs = tabs
      .map(url =>
        newTabPage && url == 'about:newtab'
          ? newTabUrl
          : isChromium && aboutDebuggingRE.test(url)
          ? 'chrome://extensions/'
          : url
      )
      .filter(url => {
        const matchingTab = currentTabs.find(tab => tab.url == url)
        return !matchingTab || url == newTabUrl
      })

    if (missingTabs.length) {
      try {
        await openTabs(port, missingTabs, manifest, isChromium, true)
      } catch (e: any) {
        console.error(e.message)
      }
    }
  })
}

function resolveFirefoxTabs(
  tabs: string[],
  manifest: any,
  runner: import('web-ext').MultiExtensionRunner
) {
  return tabs.map((url: string) => {
    if (url != 'about:newtab') {
      return url
    }
    const newTabPage = manifest.chrome_url_overrides?.newtab
    if (newTabPage) {
      const profilePath = runner.extensionRunners[0].profile?.path()
      if (profilePath) {
        const uuid = extractFirefoxExtensionUUID(profilePath, manifest)
        if (uuid) {
          return `moz-extension://${uuid}/${newTabPage}`
        }
      }
    }
    return url
  })
}

function extractFirefoxExtensionUUID(
  profile: string,
  manifest: WebExtension.Manifest
) {
  try {
    const rawPrefs = fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8')
    const uuids = JSON.parse(
      (
        rawPrefs.match(
          /user_pref\("extensions\.webextensions\.uuids",\s*"(.*?)"\);/
        )?.[1] || '{}'
      ).replace(/\\(\\)?/g, '$1')
    )
    const geckoId = manifest.browser_specific_settings?.gecko?.id
    if (geckoId) {
      return uuids[geckoId]
    }
  } catch (e) {
    console.error(e)
  }

  return null
}

async function openTabs(
  port: number,
  tabs: string[],
  manifest: WebExtension.Manifest,
  isChromium: boolean,
  isRefresh?: boolean
) {
  const targets = await retryForever(() => chromeRemote.List({ port }))
  const firstTab = targets.find(t => t.type == 'page')

  const browser = await chromeRemote({
    port,
    target: targets[0],
  })

  await Promise.all(
    tabs.map(async (url, i) => {
      let target: chromeRemote.Client
      let targetId: string
      let needsNavigate = false

      console.log('Opening tab...', url)

      if (i == 0 && firstTab) {
        targetId = firstTab.id
        needsNavigate = true
      } else {
        let params: { url: string } | undefined
        if (isChromium) {
          params = { url }
        } else {
          // Firefox doesn't support creating a new tab with a specific
          // URL => https://bugzilla.mozilla.org/show_bug.cgi?id=1817258
          needsNavigate = true
        }
        targetId = (await browser.send('Target.createTarget', params)).targetId
      }

      target = await chromeRemote({
        port,
        target: targetId,
      })

      if (needsNavigate) {
        await target.send('Page.navigate', { url })
      }

      if (!isRefresh) {
        return
      }

      const newTabPage = manifest.chrome_url_overrides?.newtab
      const isNewTab = !!newTabPage && url.endsWith('/' + newTabPage)
      if (!isNewTab) {
        return
      }

      let retries = 0
      while (true) {
        const { result } = await target.send('Runtime.evaluate', {
          expression: 'location.href',
        })

        if (url == result.value) {
          break
        }

        const delay = 100 ** (1 + 0.1 * retries++)
        console.log(
          'Expected "%s" to be "%s". Retrying in %s secs...',
          result.value,
          url,
          (delay / 1000).toFixed(1)
        )

        await new Promise(resolve => setTimeout(resolve, delay))
        await target.send('Page.navigate', {
          url: isChromium ? 'chrome://newtab/' : url,
        })
      }
    })
  )
}

async function retryForever<T>(task: () => Promise<T>) {
  const start = Date.now()
  while (true) {
    try {
      return await task()
    } catch (err: any) {
      // console.error(
      //   err.message.includes('404 Not Found') ? 'Browser not ready' : err
      // )
      if (Date.now() - start > 3000) {
        throw err
      }
    }
  }
}

function writeManifest(
  platform: WebExtension.Platform,
  manifest: WebExtension.Manifest
) {
  if (isManifestV3(manifest)) {
    processBackgroundWorkerMV3(platform, manifest)
  }
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2))
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
