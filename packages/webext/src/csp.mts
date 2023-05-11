import { Config } from '@htmelt/plugin'
import { WebExtension } from './types.mjs'

export function applyDevCSP(manifest: WebExtension.Manifest, config: Config) {
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
  csp['script-src-elem'] ||= new Set(csp['default-src'] || ["'self'"])
  csp['script-src-elem'].add(httpServerUrl)
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
