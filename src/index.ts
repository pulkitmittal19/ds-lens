/* ds-lens — is what you are looking at actually on the design system?
 *
 * Three surfaces over one reader:
 *   <DsLens />              an overlay a designer hovers
 *   window.__dsLens         a JSON API a coding agent calls
 *   new Lens().audit()      a whole-page count for CI
 *
 * See README.md for setup. MIT.
 */
export { Lens, selectorFor } from './inspect'
export { DsLens } from './overlay'
export { createGlobal, type DsLensGlobal } from './agent'
export { enrich, measure, describe, format, type AnnotationLike, type EnrichOptions } from './annotate'
export { buildTokenTable, tokenFor, type TokenTable } from './tokens'
export { winningRule, specificity, invalidateLayerOrder } from './cascade'
export { discoverRoles, matchRole, nearestRole, type Role } from './roles'
export { distanceBetween, formatDistance, type Distance, type Gap } from './measure'
export type { Audit, DsLensConfig, Inspection, Origin, Reading, Verdict } from './types'
export const VERSION = '0.1.4'
