/* Joining an annotation to a measurement.
 *
 * Annotation tools say WHERE a person pointed — a selector, a component, a
 * note. They do not say what that element measures. Both halves are needed to
 * act on "this looks tight", and until now joining them was something each
 * consumer wrote for themselves.
 *
 * Deliberately not an agentation plugin. It accepts any object that carries a
 * selector or a pair of coordinates, which covers agentation, Vercel Comments
 * and anything else that reports where a click landed. ds-lens imports nothing
 * from any of them and never will.
 */
import { Lens } from './inspect'
import type { Inspection } from './types'

/** The fields annotation tools use for "which element". All optional. */
export interface AnnotationLike {
  /** agentation's field — a CSS selector path. */
  elementPath?: string
  /** A plain selector, under either common name. */
  selector?: string
  element?: string
  x?: number
  y?: number
  [key: string]: unknown
}

export interface EnrichOptions {
  /** Reuse an existing reader. One is made on demand when omitted. */
  lens?: Lens
  /**
   * Whether x/y are relative to the document or the viewport.
   * Tools that persist a marker usually store page coordinates, because a
   * viewport pair is meaningless once the page has scrolled — so that is the
   * default, and it is converted before hit-testing.
   */
  coordinateSpace?: 'page' | 'viewport'
}

let shared: Lens | null = null
function reader(given?: Lens): Lens {
  if (given) return given
  /* The overlay's instance if one is mounted, so a configured role pattern or
     token prefix is not silently ignored here. */
  const global = (window as unknown as { __dsLens?: { readSelector(s: string): Inspection | null } }).__dsLens
  if (global) return { readSelector: global.readSelector.bind(global) } as Lens
  return (shared ??= new Lens())
}

/** Measure the element an annotation points at, or null if it cannot be found. */
export function measure(annotation: AnnotationLike, options: EnrichOptions = {}): Inspection | null {
  const lens = reader(options.lens)

  for (const candidate of [annotation.elementPath, annotation.selector, annotation.element]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    /* A tool may put a human label here rather than a selector — agentation's
       `element` is a React component trail. An invalid selector throws, and
       that must read as "not this one" rather than take the call down. */
    try {
      const found = lens.readSelector(candidate)
      if (found) return found
    } catch { /* not a selector */ }
  }

  if (typeof annotation.x === 'number' && typeof annotation.y === 'number') {
    const page = (options.coordinateSpace ?? 'page') === 'page'
    const el = document.elementFromPoint(
      annotation.x - (page ? window.scrollX : 0),
      annotation.y - (page ? window.scrollY : 0),
    )
    if (el) return lens.read(el)
  }
  return null
}

/**
 * The annotation, plus what the element it points at actually measures.
 *
 * The original object is returned untouched alongside the reading rather than
 * merged into it, so a tool's own fields can never be shadowed by ours.
 */
export function enrich<T extends AnnotationLike>(
  annotation: T,
  options: EnrichOptions = {},
): T & { dsLens: Inspection | null } {
  return { ...annotation, dsLens: measure(annotation, options) }
}

/**
 * One line a person can read, or paste into a comment.
 *
 *   14px / 500 / 20px · text-label-md · layer utilities
 *   13px / 450 / 13px · no role, nearest text-label-md · UNLAYERED
 */
export function describe(found: Inspection | null): string {
  if (!found) return 'not found'
  const parts: string[] = [found.type.value]

  if (found.type.verdict.status === 'role') parts.push(found.type.verdict.name)
  else if (found.type.suggestion) parts.push(`no role, nearest ${found.type.suggestion.name}`)
  else parts.push('no role')

  const origin = found.type.origin
  if (origin) {
    /* Unlayered is the one that explains why a correct class did nothing, so
       it is shouted rather than mentioned. */
    parts.push(origin.layer ? `layer ${origin.layer}` : 'UNLAYERED')
  }

  const raw = found.offSystem.filter(r => r.property !== 'type')
  if (raw.length) parts.push(`${raw.length} raw ${raw.length === 1 ? 'value' : 'values'}`)

  return parts.join(' · ')
}
