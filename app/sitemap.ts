import type { MetadataRoute } from 'next'
import { PUBLIC_PATHS, siteUrl } from '../lib/site'

/** /sitemap.xml: the public pages only; every group page is private. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl()
  return PUBLIC_PATHS.map((path) => ({
    url: new URL(path, site).href,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.3,
  }))
}
