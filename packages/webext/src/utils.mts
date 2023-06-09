import net from 'net'
import os from 'os'
import path from 'path'
import type { WebExtension } from './types.mjs'

export function findFreeTcpPort() {
  return new Promise<number>(resolve => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const freeTcpPort: number = (srv.address() as any).port
      srv.close(() => resolve(freeTcpPort))
    })
  })
}

export function replaceHomeDir(file: string): string
export function replaceHomeDir(file: string | undefined): string | undefined
export function replaceHomeDir(file: string | undefined) {
  if (file?.startsWith('~')) {
    file = path.join(os.homedir(), file.slice(1))
  }
  return file
}

export function toArray<T>(value: T | T[]): T[]
export function toArray<T>(value: T | readonly T[]): readonly T[]
export function toArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value]
}

export function isFirefoxTarget(
  target: WebExtension.Target
): target is WebExtension.FirefoxTarget {
  return target.platform.startsWith('firefox')
}

export function isFirefox(
  platform: WebExtension.Platform
): platform is 'firefox-desktop' | 'firefox-android' {
  return platform.startsWith('firefox')
}
