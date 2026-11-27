// Shared catalog normalization. No renderer or animation package dependencies.
export const ACTION_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
export const CLIP_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const SECONDARY_POLICIES = new Set(['portable', 'compatible', 'same-avatar', 'error'])
const ACTION_MODES = new Set(['locomotion', 'oneshot', 'loop', 'emote'])
const ACTION_LAYERS = new Set(['locomotion', 'gameplay', 'reaction'])
const QUEUE_POLICIES = new Set(['replace', 'enqueue', 'ignore'])
export const LAYER_PRIORITY = Object.freeze({ locomotion: 0, gameplay: 100, reaction: 200 })

export function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function positive(value, fallback = 0) {
  const number = finite(value, fallback)
  return number > 0 ? number : fallback
}

export function nonNegative(value, fallback = 0) {
  const number = finite(value, fallback)
  return number >= 0 ? number : fallback
}

export function normalizeActionMode(value, fallback = 'locomotion') {
  const mode = String(value || fallback)
  if (!ACTION_MODES.has(mode)) throw new Error(`Unsupported animation action mode: ${mode}`)
  return mode
}

export function defaultPriority(mode) {
  if (mode === 'oneshot') return 50
  if (mode === 'emote') return 30
  if (mode === 'loop') return 20
  return 0
}

export function defaultCrossFade(mode) {
  if (mode === 'locomotion') return 0.16
  if (mode === 'oneshot') return 0.1
  return 0.14
}

export function normalizeLayer(value, mode = 'locomotion') {
  const fallback = mode === 'locomotion' ? 'locomotion' : 'gameplay'
  const layer = String(value || fallback)
  if (!ACTION_LAYERS.has(layer)) throw new Error(`Unsupported animation action layer: ${layer}`)
  return layer
}

export function normalizeQueuePolicy(value, fallback = 'replace') {
  const policy = String(value || fallback)
  if (!QUEUE_POLICIES.has(policy)) throw new Error(`Unsupported animation queue policy: ${policy}`)
  return policy
}

export function normalizeEvents(value) {
  if (value == null) return Object.freeze([])
  if (!Array.isArray(value)) throw new TypeError('Animation action events must be an array.')
  return Object.freeze(value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`Animation action event ${index} must be an object.`)
    const name = String(entry.name || '').trim()
    if (!name) throw new Error(`Animation action event ${index} requires a name.`)
    const at = finite(entry.at ?? entry.normalizedTime, Number.NaN)
    if (!Number.isFinite(at) || at < 0 || at > 1) throw new Error(`Animation action event "${name}" must use normalized time 0..1.`)
    return Object.freeze({ name, at, ...(entry.data !== undefined ? { data: entry.data } : {}) })
  }).sort((a, b) => a.at - b.at))
}

function resolveAssetUrl(source, manifestUrl, generation) {
  const url = new URL(String(source), manifestUrl)
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    url.searchParams.set('__anyo_animation_reload', String(generation))
  }
  return url.href
}

export function normalizeSecondaryNodes(value, fallback = 'compatible') {
  const policy = String(value || fallback)
  if (!SECONDARY_POLICIES.has(policy)) throw new Error(`Unsupported secondaryNodes policy: ${policy}`)
  return policy
}

function normalizeClipDefinition(id, raw, manifestUrl, generation) {
  if (!CLIP_RE.test(id)) throw new Error(`Invalid animation clip id: ${JSON.stringify(id)}`)
  if (raw == null || raw === false) return null
  const definition = typeof raw === 'string' ? { src: raw } : raw
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError(`Animation clip "${id}" must be a string or object.`)
  }
  if (definition.enabled === false) return null
  const source = String(definition.src || definition.source || '').trim()
  if (!source) return null
  const format = String(definition.format || 'vrma').trim().toLowerCase()
  if (format !== 'vrma') throw new Error(`Animation clip "${id}" uses unsupported format "${format}".`)
  return Object.freeze({
    id,
    src: resolveAssetUrl(source, manifestUrl, generation),
    manifestSrc: source,
    format,
    secondaryNodes: normalizeSecondaryNodes(definition.secondaryNodes, 'compatible'),
    loop: definition.loop === 'once' ? 'once' : 'repeat',
    speed: positive(definition.speed, 1),
    label: String(definition.label || id),
    runtimeOnly: false,
  })
}

function normalizeActionDefinition(action, raw, clips) {
  if (!ACTION_RE.test(action)) throw new Error(`Invalid animation action name: ${JSON.stringify(action)}`)
  if (raw == null || raw === false) return null
  const definition = typeof raw === 'string' ? { clip: raw } : raw
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError(`Animation action "${action}" must be a clip id string or object.`)
  }
  const clip = String(definition.clip || definition.clipId || '').trim()
  if (!clip) return null
  if (!clips[clip]) throw new Error(`Animation action "${action}" maps to unknown clip "${clip}".`)
  const mode = normalizeActionMode(definition.mode, 'locomotion')
  const layer = normalizeLayer(definition.layer, mode)
  return Object.freeze({
    action, clip, mode, layer,
    loop: definition.loop === 'once' ? 'once' : (definition.loop === 'repeat' ? 'repeat' : undefined),
    speed: definition.speed == null ? undefined : positive(definition.speed, 1),
    priority: finite(definition.priority, defaultPriority(mode)),
    interruptible: definition.interruptible !== false,
    returnToLocomotion: definition.returnToLocomotion !== false,
    crossFade: nonNegative(definition.crossFade, defaultCrossFade(mode)),
    queue: normalizeQueuePolicy(definition.queue, mode === 'locomotion' ? 'replace' : 'enqueue'),
    events: normalizeEvents(definition.events),
  })
}


/**
 * Manifest v2 separates clip assets from semantic action bindings.
 * v3 adds orchestration policy; v4 adds arbitration layers, queues and events.
 * Versions 1-3 remain supported and are upgraded in memory.
 */
export function normalizeAnimationCatalogManifest(input, manifestUrl, generation = 1) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Animation manifest must be a JSON object.')
  const version = Number(input.version)
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) throw new Error(`Unsupported animation manifest version: ${String(input.version)}`)

  const clips = Object.create(null)
  const actions = Object.create(null)

  if (version === 1) {
    const sourceActions = input.actions
    if (!sourceActions || typeof sourceActions !== 'object' || Array.isArray(sourceActions)) {
      throw new TypeError('Animation manifest v1 must define an actions object.')
    }
    for (const [action, raw] of Object.entries(sourceActions)) {
      if (!ACTION_RE.test(action)) throw new Error(`Invalid animation action name: ${JSON.stringify(action)}`)
      if (raw == null || raw === false) continue
      const definition = typeof raw === 'string' ? { src: raw } : raw
      const clip = normalizeClipDefinition(action, definition, manifestUrl, generation)
      if (!clip) continue
      clips[action] = clip
      actions[action] = Object.freeze({ action, clip: action, mode: 'locomotion', layer: 'locomotion', loop: clip.loop, speed: clip.speed, priority: 0, interruptible: true, returnToLocomotion: true, crossFade: 0.16, queue: 'replace', events: Object.freeze([]) })
    }
  } else {
    const sourceClips = input.clips
    if (!sourceClips || typeof sourceClips !== 'object' || Array.isArray(sourceClips)) {
      throw new TypeError('Animation manifest v2 must define a clips object.')
    }
    for (const [id, raw] of Object.entries(sourceClips)) {
      const clip = normalizeClipDefinition(String(id), raw, manifestUrl, generation)
      if (clip) clips[id] = clip
    }
    const sourceActions = input.actions || {}
    if (typeof sourceActions !== 'object' || Array.isArray(sourceActions)) throw new TypeError('Animation manifest actions must be an object.')
    for (const [action, raw] of Object.entries(sourceActions)) {
      const binding = normalizeActionDefinition(String(action), raw, clips)
      if (binding) actions[action] = binding
    }
  }

  return Object.freeze({ version: 4, clips: Object.freeze(clips), actions: Object.freeze(actions) })
}

export async function loadAnimationCatalogManifest(source, options = {}) {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const base = options.baseUrl || (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
    return normalizeAnimationCatalogManifest(source, base, options.generation || 1)
  }
  const manifestUrl = String(source || '').trim()
  if (!manifestUrl) throw new Error('Animation manifest URL is required.')
  const fetcher = options.fetcher || globalThis.fetch
  if (typeof fetcher !== 'function') throw new Error('No fetch implementation is available for the animation manifest.')
  const response = await fetcher(manifestUrl, { signal: options.signal, cache: 'no-store' })
  if (!response?.ok) throw new Error(`Animation manifest request failed (${response?.status ?? 'network'}): ${manifestUrl}`)
  return normalizeAnimationCatalogManifest(await response.json(), response.url || manifestUrl, options.generation || 1)
}

