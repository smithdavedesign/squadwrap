import type { NextConfig } from 'next'

// Every URL under these paths holds a private key (organizer id, invite token or yearbook token).
// The pages also say noindex in a meta tag, but Next streams metadata on dynamic pages, and slides and photos have
// no <head>: the header keeps all of them out of search indexes, and no Referer header ever carries the key away.
const PRIVATE_LINK_PATHS = ['/groups/:path*', '/join/:path*', '/y/:path*']
const PRIVATE_LINK_HEADERS = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
]

/**
 * `npm run cf:build` sets this: the build becomes the Cloudflare Worker (OpenNext). Vercel builds never set it.
 * Photon's Node entry compiles its WebAssembly from bytes at startup, which a Worker forbids; its `workerd` entry imports
 * the .wasm file instead, and OpenNext picks that entry when it bundles the Worker. Next traces with Node's conditions,
 * so that entry and its .wasm are added to the trace by hand.
 */
const workerBuild = process.env.SQUADWRAP_WORKER_BUILD === '1'
const PHOTON_WORKERD = ['node_modules/@cf-wasm/photon/dist/**']

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite (local dev database) loads its own WASM and data files, so it must not be bundled. Photon (photos,
  // lib/photo.ts) stays a package too, so each host loads its own entry: Node's, or the Worker's (above).
  serverExternalPackages: ['@electric-sql/pglite', '@cf-wasm/photon'],
  ...(workerBuild && { outputFileTracingIncludes: { '/**': PHOTON_WORKERD } }),
  async headers() {
    return PRIVATE_LINK_PATHS.map((source) => ({ source, headers: PRIVATE_LINK_HEADERS }))
  },
}

export default nextConfig
