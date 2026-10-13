import type { MetadataRoute } from 'next'
import { siteUrl } from '../lib/site'

/**
 * /robots.txt: everything may be crawled. The private-link pages (/groups, /join, /y) aren't disallowed on purpose:
 * a crawler that finds such a link must fetch it to see its noindex header (next.config.ts), and listing the paths
 * here would only advertise them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('/sitemap.xml', siteUrl()).href,
  }
}
