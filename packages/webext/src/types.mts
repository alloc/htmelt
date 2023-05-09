import type { Promisable } from 'type-fest'

export namespace WebExtension {
  export type Options = {
    targets: (Target | Platform)[]
    manifest: Manifest
    artifactsDir?: string
    run?: RunOptions
  }

  export type RunOptions = {
    startUrl?: string | string[]
    keepProfileChanges?: boolean
  }

  export type Target = FirefoxTarget | ChromiumTarget
  export type Platform = Target['platform']

  export type FirefoxTarget = {
    platform: 'firefox-desktop' | 'firefox-android'
    run?: FirefoxRunOptions
  }

  export type FirefoxRunOptions = {
    binary?: 'firefox' | 'beta' | 'nightly' | 'deved' | (string & {})
    profile?: string
    keepProfileChanges?: boolean
    devtools?: boolean
    browserConsole?: boolean
    preInstall?: boolean
    args?: string[]
  }

  export type ChromiumTarget = {
    platform: 'chromium'
    run?: ChromiumRunOptions
  }

  export type ChromiumRunOptions = {
    binary?: string
    profile?: string
    keepProfileChanges?: boolean
    args?: string[]
  }

  export type Manifest = ManifestV2 | ManifestV3

  interface ManifestBase {
    // Required
    manifest_version: number
    name: string
    version: string

    // Recommended
    default_locale?: string
    description?: string
    icons?: ManifestIcons

    // Optional
    author?: string
    background_page?: string
    browser_specific_settings?: {
      gecko?: {
        id?: string
      }
    }
    chrome_settings_overrides?: {
      homepage?: string
      search_provider?: SearchProvider
      startup_pages?: string[]
    }
    chrome_ui_overrides?: {
      bookmarks_ui?: {
        remove_bookmark_shortcut?: boolean
        remove_button?: boolean
      }
    }
    chrome_url_overrides?: {
      bookmarks?: string
      history?: string
      newtab?: string
    }
    commands?: {
      [name: string]: {
        suggested_key?: {
          default?: string
          windows?: string
          mac?: string
          chromeos?: string
          linux?: string
        }

        description?: string
        global?: boolean
      }
    }
    content_capabilities?: {
      matches?: string[]
      permissions?: string[]
    }
    content_scripts?: {
      matches?: string[]
      exclude_matches?: string[]
      css?: string[]
      js?: string[]
      run_at?: string
      all_frames?: boolean
      match_about_blank?: boolean
      include_globs?: string[]
      exclude_globs?: string[]
    }[]
    converted_from_user_script?: boolean
    current_locale?: string
    devtools_page?: string
    event_rules?: {
      event?: string
      actions?: {
        type: string
      }[]
      conditions?: chrome.declarativeContent.PageStateMatcherProperties[]
    }[]
    externally_connectable?: {
      ids?: string[]
      matches?: string[]
      accepts_tls_channel_id?: boolean
    }
    file_browser_handlers?: {
      id?: string
      default_title?: string
      file_filters?: string[]
    }[]
    file_system_provider_capabilities?: {
      configurable?: boolean
      watchable?: boolean
      multiple_mounts?: boolean
      source?: string
    }
    homepage_url?: string
    import?: {
      id: string
      minimum_version?: string
    }[]
    export?: {
      whitelist?: string[]
    }
    incognito?: string
    input_components?: {
      name?: string
      type?: string
      id?: string
      description?: string
      language?: string[] | string
      layouts?: string[]
      indicator?: string
    }[]
    key?: string
    minimum_chrome_version?: string
    nacl_modules?: {
      path: string
      mime_type: string
    }[]
    oauth2?: {
      client_id: string
      scopes?: string[]
    }
    offline_enabled?: boolean
    omnibox?: {
      keyword: string
    }
    options_page?: string
    options_ui?: {
      page?: string
      chrome_style?: boolean
      open_in_tab?: boolean
    }
    platforms?: {
      nacl_arch?: string
      sub_package_path: string
    }[]
    plugins?: {
      path: string
    }[]
    requirements?: {
      '3D'?: {
        features?: string[]
      }
      plugins?: {
        npapi?: boolean
      }
    }
    sandbox?: {
      pages: string[]
      content_security_policy?: string
    }
    short_name?: string
    spellcheck?: {
      dictionary_language?: string
      dictionary_locale?: string
      dictionary_format?: string
      dictionary_path?: string
    }
    storage?: {
      managed_schema: string
    }
    tts_engine?: {
      voices: {
        voice_name: string
        lang?: string
        gender?: string
        event_types?: string[]
      }[]
    }
    update_url?: string
    version_name?: string
  }

  export interface ManifestV2 extends ManifestBase {
    // Required
    manifest_version: 2

    // Pick one (or none)
    browser_action?: ManifestAction
    page_action?: ManifestAction

    // Optional
    background?: {
      scripts?: string[]
      page?: string
      persistent?: boolean
    }

    content_security_policy?: string
    optional_permissions?: string[]
    permissions?: string[]
    web_accessible_resources?: string[]
  }

  export interface ManifestV3 extends ManifestBase {
    // Required
    manifest_version: 3

    // Optional
    action?: ManifestAction
    background?: {
      service_worker?: string
      type?: 'module'
      // Firefox only
      scripts?: string[]
      persistent?: false
    }
    content_security_policy?: {
      extension_pages?: string
      sandbox?: string
    }
    declarative_net_request?: {
      rule_resources: (
        | DeclarativeNetRequest.RuleResource
        | DeclarativeNetRequest.InlineRuleResource
      )[]
    }
    host_permissions?: string[]
    optional_permissions?: ManifestPermissions[]
    permissions?: ManifestPermissions[]
    web_accessible_resources?: { resources: string[]; matches: string[] }[]
  }

  export interface SearchProvider {
    name?: string | undefined
    keyword?: string | undefined
    favicon_url?: string | undefined
    search_url: string
    encoding?: string | undefined
    suggest_url?: string | undefined
    instant_url?: string | undefined
    image_url?: string | undefined
    search_url_post_params?: string | undefined
    suggest_url_post_params?: string | undefined
    instant_url_post_params?: string | undefined
    image_url_post_params?: string | undefined
    alternate_urls?: string[] | undefined
    prepopulated_id?: number | undefined
    is_default?: boolean | undefined
  }

  export interface ManifestIcons {
    [size: number]: string
  }

  export interface ManifestAction {
    default_icon?: ManifestIcons
    default_title?: string
    default_popup?: string
  }

  // Source: https://developer.chrome.com/docs/extensions/mv3/declare_permissions/
  export type ManifestPermissions =
    | 'activeTab'
    | 'alarms'
    | 'background'
    | 'bookmarks'
    | 'browsingData'
    | 'certificateProvider'
    | 'clipboardRead'
    | 'clipboardWrite'
    | 'contentSettings'
    | 'contextMenus'
    | 'cookies'
    | 'debugger'
    | 'declarativeContent'
    | 'declarativeNetRequest'
    | 'declarativeNetRequestFeedback'
    | 'declarativeWebRequest'
    | 'desktopCapture'
    | 'documentScan'
    | 'downloads'
    | 'downloads.shelf'
    | 'downloads.ui'
    | 'enterprise.deviceAttributes'
    | 'enterprise.hardwarePlatform'
    | 'enterprise.networkingAttributes'
    | 'enterprise.platformKeys'
    | 'experimental'
    | 'favicon'
    | 'fileBrowserHandler'
    | 'fileSystemProvider'
    | 'fontSettings'
    | 'gcm'
    | 'geolocation'
    | 'history'
    | 'identity'
    | 'identity.email'
    | 'idle'
    | 'loginState'
    | 'management'
    | 'nativeMessaging'
    | 'notifications'
    | 'offscreen'
    | 'pageCapture'
    | 'platformKeys'
    | 'power'
    | 'printerProvider'
    | 'printing'
    | 'printingMetrics'
    | 'privacy'
    | 'processes'
    | 'proxy'
    | 'scripting'
    | 'search'
    | 'sessions'
    | 'signedInDevices'
    | 'storage'
    | 'system.cpu'
    | 'system.display'
    | 'system.memory'
    | 'system.storage'
    | 'tabCapture'
    | 'tabGroups'
    | 'tabs'
    | 'topSites'
    | 'tts'
    | 'ttsEngine'
    | 'unlimitedStorage'
    | 'vpnProvider'
    | 'wallpaper'
    | 'webNavigation'
    | 'webRequest'
    | 'webRequestBlocking'

  export namespace DeclarativeNetRequest {
    export interface RuleResource {
      /** A non-empty string uniquely identifying the ruleset. IDs beginning with `_` are reserved for internal use. */
      id: string
      /** Whether the ruleset is enabled by default. */
      enabled: boolean
      /** The path of the JSON ruleset relative to the extension directory. */
      path: string
    }

    export interface InlineRuleResource extends Omit<RuleResource, 'path'> {
      rules: chrome.declarativeNetRequest.Rule[]
    }
  }

  /**
   * Runs before the manifest is used.
   */
  export type ManifestHook = (
    manifest: Manifest,
    options: WebExtension.Options
  ) => Promisable<void>
}

declare module '@htmelt/plugin' {
  export interface PluginInstance {
    webext?: {
      manifest?: WebExtension.ManifestHook
    }
  }
  export interface Flags {
    platform?: WebExtension.Platform
  }
}
