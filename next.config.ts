import type { NextConfig } from 'next'

// Every URL under these paths holds a private key (organizer id, invite token or yearbook token).
// The pages also say noindex in a meta tag, but Next streams metadata on dynamic pages, and slides and photos have
// no <head>: the header keeps all of them out of search indexes, and no Referer header ever carries the key away.
const PRIVATE_LINK_PATHS = ['/groups/:path*', '/join/:path*', '/y/:path*']
const PRIVATE_LINK_HEADERS = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite (local dev database) loads its own WASM and data files, so it must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite'],
  async headers() {
    return PRIVATE_LINK_PATHS.map((source) => ({ source, headers: PRIVATE_LINK_HEADERS }))
  },
}

export default nextConfig
