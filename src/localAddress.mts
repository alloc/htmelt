// Credits to https://github.com/jaywcjlove/local-ip-url
// License: MIT
import os from 'os'

/**
 * Returns the address for the network interface on the current system with the
 * specified `name`.
 */
export default function localAddress(
  name?: 'public' | 'private' | (string & {}),
  family: 'ipv4' | 'ipv6' = 'ipv4'
) {
  if (name && /^\d+/.test(name)) {
    return name
  }

  const interfaces = os.networkInterfaces()

  //
  // If a specific network interface has been named,
  // return the address.
  //
  if (name && name !== 'private' && name !== 'public') {
    const res = interfaces[name]?.filter(function (details) {
      const itemFamily = details.family.toLowerCase()
      return itemFamily === family
    })
    if (!res || res.length === 0) return undefined
    return res[0].address
  }

  const all = Object.keys(interfaces)
    .map(function (nic) {
      //
      // Note: name will only be `public` or `private`
      // when this is called.
      //
      const addresses = interfaces[nic]?.filter(function (details) {
        if (
          family !== details.family.toLowerCase() ||
          isLoopback(details.address)
        ) {
          return false
        }
        if (!name) {
          return true
        }
        if (name === 'public') {
          return !isPrivate(details.address)
        }
        return isPrivate(details.address)
      })

      return addresses?.length ? addresses[0].address : undefined
    })
    .filter(Boolean)

  return !all.length ? loopback(family) : all[0]
}

function isLoopback(addr: string) {
  return (
    /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/.test(addr) ||
    /^fe80::1$/.test(addr) ||
    /^::1$/.test(addr) ||
    /^::$/.test(addr)
  )
}

function isPrivate(addr: string) {
  return (
    /^(::f{4}:)?10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) ||
    /^(::f{4}:)?192\.168\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) ||
    /^(::f{4}:)?172\.(1[6-9]|2\d|30|31)\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(
      addr
    ) ||
    /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) ||
    /^(::f{4}:)?169\.254\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) ||
    /^f[cd][0-9a-f]{2}:/i.test(addr) ||
    /^fe80:/i.test(addr) ||
    /^::1$/.test(addr) ||
    /^::$/.test(addr)
  )
}

function loopback(family: string) {
  return family === 'ipv4' ? '127.0.0.1' : 'fe80::1'
}
