import { ImageResponse } from 'next/og'
import { SHARE_IMAGE, TAGLINE } from '../lib/site'

// The 1200×630 share image for link previews (Open Graph and, through Next's fallback, the Twitter card). Drawn with
// code from the slide's palette (lib/slide.tsx) and prerendered at build time: no request data, no external assets.
export const alt = SHARE_IMAGE.alt
export const size = { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height }
export const contentType = SHARE_IMAGE.type

const INK = '#f4f0ff'
const MUTED = '#a99cc8'
const GREEN = '#1ed760'
const GOLD = '#ffd84d'
const NIGHT = '#120d1f'
const flex = { display: 'flex' } as const

/** A small story slide, like the ones the app makes, with a sample award. */
function MiniSlide({ initial, name, title, tilt, shade }: { initial: string; name: string; title: string; tilt: number; shade: string }) {
  return (
    <div
      style={{
        ...flex,
        position: 'absolute',
        top: 60,
        left: 0,
        width: 290,
        height: 516,
        flexDirection: 'column',
        alignItems: 'center',
        padding: '44px 26px 0',
        borderRadius: 28,
        border: '2px solid #3a2f57',
        backgroundImage: `linear-gradient(165deg, ${shade} 0%, #120d1f 60%, #0b3325 100%)`,
        transform: `rotate(${tilt}deg)`,
        textAlign: 'center',
      }}
    >
      <div style={{ ...flex, fontSize: 16, letterSpacing: 3, color: MUTED }}>FLAT 4B</div>
      <div style={{ ...flex, fontSize: 22, color: GREEN, marginTop: 4 }}>2026 wrapped</div>
      <div style={{ ...flex, marginTop: 26, padding: 6, borderRadius: 120, backgroundColor: GOLD }}>
        <div
          style={{
            ...flex,
            width: 120,
            height: 120,
            borderRadius: 60,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: NIGHT,
            color: GOLD,
            fontSize: 60,
          }}
        >
          {initial}
        </div>
      </div>
      <div style={{ ...flex, fontSize: 28, marginTop: 22 }}>{name}</div>
      <div style={{ ...flex, fontSize: 14, letterSpacing: 3, color: MUTED, marginTop: 16 }}>THE AWARD FOR</div>
      <div style={{ ...flex, fontSize: 34, color: GOLD, marginTop: 6, lineHeight: 1.1 }}>{title}</div>
    </div>
  )
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          ...flex,
          width: '100%',
          height: '100%',
          padding: '0 70px',
          alignItems: 'center',
          backgroundColor: NIGHT,
          backgroundImage: 'linear-gradient(150deg, #2c1460 0%, #120d1f 55%, #0b3325 100%)',
          color: INK,
        }}
      >
        <div style={{ ...flex, flexDirection: 'column', width: 640 }}>
          <div style={{ ...flex, fontSize: 40, letterSpacing: 2, color: GREEN }}>squadwrap</div>
          <div style={{ ...flex, fontSize: 76, lineHeight: 1.05, marginTop: 18 }}>Wrapped for your friend group</div>
          <div style={{ ...flex, fontSize: 30, lineHeight: 1.35, color: MUTED, marginTop: 26 }}>{TAGLINE}</div>
          <div style={{ ...flex, fontSize: 24, color: INK, marginTop: 34 }}>
            <div style={{ ...flex, padding: '10px 22px', borderRadius: 999, border: `2px solid ${GREEN}` }}>
              No app · No account · Free to try
            </div>
          </div>
        </div>
        <div style={{ ...flex, position: 'relative', width: 420, height: 630 }}>
          <div style={{ ...flex, position: 'absolute', top: 0, left: 120, width: 290, height: 630 }}>
            <MiniSlide initial="B" name="Ben" title="Landlord of Excuses" tilt={8} shade="#0b3325" />
          </div>
          <div style={{ ...flex, position: 'absolute', top: 0, left: 10, width: 290, height: 630 }}>
            <MiniSlide initial="A" name="Ana" title="The Human Snooze Button" tilt={-5} shade="#2c1460" />
          </div>
        </div>
      </div>
    ),
    size,
  )
}
