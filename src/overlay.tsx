/* The overlay.
 *
 * Every style here is inline and every colour is fixed. That is not laziness —
 * this component is injected into other people's applications, so a class name
 * could collide with theirs and a CSS variable could be redefined underneath
 * it. Inline styles cannot be reached by the host page at all, which is the
 * only way an inspector can be trusted to report the page rather than itself.
 *
 * One dark panel in both themes, for the same reason DevTools uses one: it has
 * to stay legible above whatever it is floating over.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Lens } from './inspect'
import { toHex } from './color'
import { format } from './annotate'
import { createGlobal } from './agent'
import type { DsLensConfig, Inspection, Reading } from './types'

/* Agentation's palette, measured from its own toolbar rather than guessed:
   surface #1A1A1A, raised #252525, dividers #484848, white text, and two
   accents it ships — a blue and a red. ds-lens sits beside that toolbar, so
   matching it is the difference between one tool and two.

   The accent is read from agentation at runtime when it is on the page, so
   changing the accent there changes it here. */
const INK = {
  panel: '#1A1A1A',
  raised: '#252525',
  line: 'rgba(255,255,255,.10)',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,.55)',
  faint: 'rgba(255,255,255,.34)',
  ok: 'color(display-p3 0 .53 1)',
  okFallback: '#0087FF',
  bad: '#FF383C',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  shadow: '0 2px 8px rgba(0,0,0,.30), 0 8px 28px rgba(0,0,0,.24)',
}

/** Agentation's accent if it is mounted, else ds-lens's own blue. */
function readAccent(): string {
  const host = document.querySelector('[data-agentation-root]')
  const v = host && getComputedStyle(host).getPropertyValue('--agentation-color-accent').trim()
  return v || INK.okFallback
}

/* A colour is recognised far faster than it is read. The inset ring keeps a
   white or near-transparent swatch visible against the dark panel. */
function Swatch({ value }: { value: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: value,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.28)', marginRight: 7, verticalAlign: 'baseline',
    }} />
  )
}

/* Lucide `crosshair`, copied exactly rather than redrawn — an approximated
   icon is the kind of thing nobody notices and everybody feels. Inlined rather
   than imported so ds-lens keeps zero runtime dependencies.
   lucide-react v0.562.0, ISC. */
function Crosshair({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </svg>
  )
}

const POS_KEY = 'ds-lens:pos'
const CHIP = 44

/* Bottom-left by default, because agentation and most other floating toolbars
   live bottom-right. Dragging overrides it and the choice is remembered. */
function defaultPos() {
  return { x: 16, y: Math.max(16, window.innerHeight - CHIP - 16) }
}

function clamp(p: { x: number; y: number }) {
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - CHIP - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - CHIP - 8)),
  }
}

function Chip({ locked, peeking, copied, accent, onToggle }: {
  locked: boolean; peeking: boolean; copied: boolean; accent: string; onToggle: () => void
}) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(POS_KEY)
      if (saved) return clamp(JSON.parse(saved))
    } catch { /* private mode, or a value from an older version */ }
    return defaultPos()
  })
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const from = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)

  /* A window that shrank can strand the chip off-screen with no way to reach
     it, so the saved position is re-clamped rather than trusted. */
  useEffect(() => {
    const onResize = () => setPos(p => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const down = (e: ReactPointerEvent) => {
    from.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false }
    /* Capture keeps the drag alive when the cursor outruns a 44px target.
       It throws if the pointer is no longer active — a released button, a
       synthetic event — and that must not take the drag down with it. */
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    setDragging(true)
  }
  const move = (e: ReactPointerEvent) => {
    const f = from.current
    if (!f) return
    const next = clamp({ x: e.clientX - f.dx, y: e.clientY - f.dy })
    /* Four pixels of slop. Without it a click with any tremor in it is read as
       a drag and the button never fires. */
    if (Math.abs(next.x - pos.x) > 4 || Math.abs(next.y - pos.y) > 4) f.moved = true
    setPos(next)
  }
  const up = () => {
    const f = from.current
    setDragging(false)
    from.current = null
    if (!f) return
    if (f.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ } }
    else onToggle()
  }

  return (
    <div
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      role="button" tabIndex={0} aria-pressed={locked} aria-label="ds-lens inspector"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: CHIP, height: CHIP,
        zIndex: 2147483647, borderRadius: CHIP / 2,
        display: 'grid', placeItems: 'center',
        background: locked ? accent : INK.panel,
        color: locked ? '#FFFFFF' : peeking ? accent : 'rgba(255,255,255,.72)',
        boxShadow: INK.shadow,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none', userSelect: 'none',
        transition: dragging ? 'none' : 'background 120ms ease, color 120ms ease',
        outline: peeking && !locked ? `1.5px solid ${accent}` : 'none', outlineOffset: -1.5,
      }}
    >
      <Crosshair />
      {(copied || (hover && !dragging)) && (
        <span style={{
          position: 'absolute', bottom: CHIP + 8, left: '50%', transform: 'translateX(-50%)',
          background: INK.panel, color: 'rgba(255,255,255,.9)', borderRadius: 8,
          padding: '4px 8px', fontSize: 12, fontWeight: 500, fontFamily: INK.sans,
          whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.3)', pointerEvents: 'none',
        }}>
          {copied ? 'Copied' : locked ? 'Inspecting · esc' : 'Inspect · hold ⌥'}
        </span>
      )}
    </div>
  )
}

function Pill({ children, tone }: { children: ReactNode; tone?: 'bad' }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 5, fontSize: 10.5,
      background: tone === 'bad' ? 'rgba(255,56,60,.16)' : 'rgba(255,255,255,.08)',
      color: tone === 'bad' ? INK.bad : INK.dim,
      fontFamily: INK.sans, letterSpacing: .1,
    }}>{children}</span>
  )
}

/* Other tools' floating UI.
 *
 * ds-lens swallows clicks while it is active, so anything it does not skip
 * becomes unclickable. Measured against agentation: with the inspector on, a
 * click on its toolbar was preventDefault'd and never arrived. An inspector
 * that quietly disables the annotation tool beside it is worse than no
 * inspector, so known overlay roots are skipped by default and a host can add
 * its own with `overlaySelectors` or by marking an element
 * `data-ds-lens-ignore`. */
const OVERLAY_ROOTS = [
  '[data-ds-lens]',
  '[data-ds-lens-ignore]',
  '[data-agentation-root]',
  '[data-stagewise-companion-anchor]',
  '#vercel-live-feedback',
  'vercel-live-feedback',
]

const LABEL: Record<string, string> = {
  'background-color': 'Background', 'border-color': 'Border colour',
  'border-radius': 'Radius', 'border-width': 'Border', 'box-shadow': 'Shadow',
  color: 'Colour', gap: 'Gap',
}
const label = (p: string) => LABEL[p] ?? (p.startsWith('padding') ? 'Padding' : p)

/** Padding reads as one line when all four sides agree, four when they differ. */
function foldPadding(readings: Reading[]): Reading[] {
  const sides = readings.filter(r => r.property.startsWith('padding'))
  if (sides.length !== 4) return readings
  const rest = readings.filter(r => !r.property.startsWith('padding'))
  const same = sides.every(s => s.value === sides[0].value && s.verdict.status === sides[0].verdict.status)
  if (!same) return readings
  return [...rest, { ...sides[0], property: 'padding' }]
}

function Row({ name, value, verdict, ok, accent, swatch }: {
  name: string; value: string; verdict: string; ok: boolean; accent: string; swatch?: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '46px minmax(0,1fr) auto', gap: 10, alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ color: INK.faint, fontSize: 11, fontFamily: INK.sans }}>{name}</span>
      <span style={{
        color: INK.text, fontFamily: INK.mono, fontSize: 11.5,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {swatch && <Swatch value={swatch} />}{value}
      </span>
      <span style={{ color: ok ? accent : INK.bad, fontFamily: INK.mono, fontSize: 11.5, whiteSpace: 'nowrap' }}>
        {verdict}
      </span>
    </div>
  )
}

/* The tail of a selector is the part that identifies the element; the head is
   page furniture. Ellipsising the front keeps the useful half. */
const tail = (text: string, max = 46) =>
  text.length <= max ? text : '…' + text.slice(-(max - 1))

function Panel({ data, at, accent }: {
  data: Inspection; at: { x: number; y: number }; accent: string
}) {
  const W = 322
  const left = Math.min(at.x + 18, window.innerWidth - W - 12)
  const top = Math.min(at.y + 18, window.innerHeight - 190)
  const origin = data.type.origin
  const off = data.offSystem.length
  const typeOk = data.type.verdict.status === 'role'

  /* One slot for the verdict, whether or not there is a role. A matched role
     names itself; an unmatched one points at the closest — `→ text-label-md`
     reads as "should be this" and costs no extra line. Spelling it out as
     "nearest is X — 14px / — / 20px" restated numbers already on the row and
     was read as part of the value. */
  const typeVerdict = typeOk
    ? (data.type.verdict as { name: string }).name
    : data.type.suggestion ? `\u2192 ${data.type.suggestion.name}` : 'no role'

  return (
    <div style={{
      position: 'fixed', left, top: Math.max(12, top), width: W, zIndex: 2147483647,
      background: INK.panel, borderRadius: 12, boxShadow: INK.shadow,
      padding: '11px 13px 11px', pointerEvents: 'none',
      font: `400 12px/1.45 ${INK.sans}`, color: INK.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.text || tail(data.selector, 30)}
        </span>
        {off > 0 && (
          <span style={{ color: INK.bad, fontSize: 11, whiteSpace: 'nowrap' }}>{off} off</span>
        )}
      </div>

      <div style={{ height: 1, background: INK.line, margin: '8px 0 4px' }} />

      <Row
        name="Type" accent={accent} ok={typeOk}
        value={data.type.value}
        verdict={typeVerdict}
      />
      {foldPadding(data.readings).map(r => {
        const ok = r.verdict.status === 'token'
        const colour = /color$/.test(r.property)
        return (
          <Row
            key={r.property} name={label(r.property)} accent={accent} ok={ok}
            value={colour ? toHex(r.value) : r.value}
            swatch={colour ? r.value : undefined}
            verdict={ok ? (r.verdict as { name: string }).name : 'raw'}
          />
        )
      })}

      {origin && !origin.layer && (
        <div style={{ marginTop: 7 }}>
          <Pill tone="bad">unlayered</Pill>
        </div>
      )}
    </div>
  )
}

export interface DsLensProps extends DsLensConfig {
  /** Start with the inspector already on. Default false. */
  defaultOn?: boolean
  /** Extra floating UI to leave alone, added to the built-in list. */
  overlaySelectors?: string[]
  /** Highlight and on-system colour. Defaults to agentation's accent if present. */
  accent?: string
}

export function DsLens(props: DsLensProps = {}) {
  const {
    defaultOn = false, exposeGlobal = true, globalName = '__dsLens',
    overlaySelectors = [], accent: _accent, ...config
  } = props
  const [locked, setLocked] = useState(defaultOn)
  /* Hold Alt to peek. Peeking reads but never intercepts a click, so an
     annotation tool underneath stays usable — look at an element, let go, click
     it. Locking on is for hands-free sweeps, and that mode does take the click
     (to copy the reading), which is why it is not the default. */
  const [peek, setPeek] = useState(false)
  const on = locked || peek
  const [found, setFound] = useState<Inspection | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  /* Read once at mount: agentation's accent if it is on the page, else ours.
     A prop wins over both, for a host that wants neither. */
  const accent = useMemo(() => props.accent ?? readAccent(), [props.accent])
  const lens = useRef<Lens | null>(null)
  const mounted = useRef(false)

  if (!lens.current) lens.current = new Lens(config)

  useEffect(() => {
    mounted.current = true
    if (!exposeGlobal) return
    window[globalName] = createGlobal(lens.current!, '0.1.0')
    return () => { delete window[globalName] }
  }, [exposeGlobal, globalName])

  /* True for ds-lens's own UI and for any other tool's floating UI. Those
     elements are never inspected and never have their clicks intercepted. */
  const skip = useCallback((el: Element | null) => {
    if (!el) return true
    return [...OVERLAY_ROOTS, ...overlaySelectors].some(sel => {
      try { return !!el.closest(sel) } catch { return false }
    })
  }, [overlaySelectors])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setPeek(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setPeek(false) }
    /* A held key is lost when the window loses focus, which leaves peek stuck
       on and every click swallowed until the page is reloaded. */
    const blur = () => setPeek(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    if (!on) { setFound(null); return }

    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (skip(el)) return
      setAt({ x: e.clientX, y: e.clientY })
      setFound(lens.current!.read(el!))
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setLocked(false) }
    const click = (e: MouseEvent) => {
      if (!locked) return                       // peeking never steals a click
      if (skip(e.target as Element)) return
      e.preventDefault(); e.stopPropagation()
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      /* The short block by default: the full Inspection is ~50 lines of JSON
         for one element, which is the wrong thing to drop into a chat or a
         comment. Shift gets the JSON, for when something is going to parse it
         rather than read it. */
      const found = lens.current!.read(el)
      const text = e.shiftKey ? JSON.stringify(found, null, 2) : format(found)
      navigator.clipboard?.writeText(text).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1200) },
        () => {/* clipboard blocked — the panel still shows the values */},
      )
    }

    document.addEventListener('mousemove', move, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('click', click, true)
    return () => {
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('click', click, true)
    }
  }, [on, locked, skip])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div data-ds-lens="">
      <Chip
        locked={locked}
        peeking={peek}
        copied={copied}
        accent={accent}
        onToggle={() => setLocked((v: boolean) => !v)}
      />

      {on && found && (
        <>
          <div style={{
            position: 'fixed', pointerEvents: 'none', zIndex: 2147483646,
            left: found.box.x, top: found.box.y, width: found.box.width, height: found.box.height,
            outline: `1px solid ${accent}`, background: 'rgba(0,135,255,.12)',
          }} />
          <Panel data={found} at={at} accent={accent} />
        </>
      )}
    </div>,
    document.body,
  )
}
