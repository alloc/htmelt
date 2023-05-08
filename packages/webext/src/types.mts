import { Promisable } from 'type-fest'

export namespace WebExtension {
  export type Config = {
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

  export type Manifest = chrome.runtime.Manifest & {
    browser_specific_settings?: {
      gecko?: {
        id?: string
      }
    }
    declarative_net_request?: {
      rule_resources: (
        | DeclarativeNetRequest.RuleResource
        | DeclarativeNetRequest.InlineRuleResource
      )[]
    }
  }

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
    webextConfig: WebExtension.Config
  ) => Promisable<void>
}
