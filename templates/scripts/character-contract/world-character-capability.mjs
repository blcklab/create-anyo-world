import { projectPath } from './project-manifest.mjs'
import { normalizeAnimationCatalogManifest } from './animation-catalog.mjs'

const MAX_BYTES = 1024 * 1024
const MAX_CATALOG_BYTES = 8 * MAX_BYTES
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const AVATAR_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const own = (obj, key) => Object.hasOwn(obj, key)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, label, max, optional = false) => {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}.`)
  return value.trim()
}
const bounded = (value, min, max, label, fallback) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`)
  return value
}
function safeRoot(value) {
  const root = new URL(value)
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/') || /%(?:5c|2e|25)/i.test(root.pathname)) throw new Error('Invalid character repository root.')
  // Existing repository resolver percent-encodes slash-containing Git refs.
  // Permit that encoding only inside the ref segment of an exact jsDelivr root.
  if (/%2f/i.test(root.pathname)) {
    const match = root.origin === 'https://cdn.jsdelivr.net' && /^\/gh\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+@([^/]+)\/$/.exec(root.pathname)
    if (!match || decodeURIComponent(match[1]).split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid encoded repository root.')
  }
  return root
}
function within(url, root) {
  return url.origin === root.origin && url.pathname.startsWith(root.pathname) && !url.username && !url.password && !url.search && !url.hash
}
// Relative to the owning document; traversal may never ascend above root,
// including paths that would escape and then re-enter the same repository.
export function resolveCharacterResource(value, ownerUrl, rootUrl, extension) {
  const root = safeRoot(rootUrl), owner = new URL(ownerUrl)
  if (!within(owner, root) || owner.pathname.endsWith('/')) throw new Error('Character catalog owner is outside repository.')
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 512 || value.startsWith('/') || /[\\%?#:\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid relative character resource path.')
  const segments = owner.pathname.slice(root.pathname.length).split('/').slice(0,-1)
  for (const part of value.split('/')) {
    if (part === '.') continue
    if (part === '..') { if (!segments.length) throw new Error('Character resource escapes repository.'); segments.pop(); continue }
    if (!part || !/^[A-Za-z0-9_. -]+$/.test(part) || !part.trim()) throw new Error('Invalid relative character resource path.')
    segments.push(encodeURIComponent(part))
  }
  const url = new URL(segments.join('/'), root)
  if (!within(url, root) || !extension.test(url.pathname)) throw new Error('Invalid character resource format or containment.')
  return url.href
}
function freezeJson(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value) }
  return value
}
export function validateAvatarCatalog(raw, manifestUrl, rootUrl) {
  if (!record(raw) || raw.version !== 1 || !record(raw.avatars)) throw new Error('Expected avatar catalog version 1.')
  const entries = Object.entries(raw.avatars)
  if (entries.length > 64) throw new Error('Too many avatars (64 maximum).')
  if (raw.default !== null && (entries.length || raw.default !== undefined) && (typeof raw.default !== 'string' || !own(raw.avatars,raw.default))) throw new Error('Avatar default must be null or name an existing avatar.')
  const avatars = Object.create(null)
  for (const [id, item] of entries) {
    if (!AVATAR_ID.test(id) || RESERVED.has(id) || !record(item)) throw new Error('Invalid avatar ID or entry.')
    const src = resolveCharacterResource(item.src, manifestUrl, rootUrl, /\.(vrm|glb)$/i)
    const format = src.toLowerCase().endsWith('.vrm') ? 'vrm' : 'glb'
    if (item.format !== undefined && item.format !== format) throw new Error(`Avatar ${id} format does not match model.`)
    const transform = item.transform === undefined ? {} : item.transform
    if (!record(transform)) throw new Error('Invalid avatar transform.')
    if (transform.autoFit !== undefined && typeof transform.autoFit !== 'boolean') throw new Error('Invalid autoFit.')
    if (format === 'glb' && (item.animations !== undefined || transform.autoFit === true || transform.targetHeight !== undefined)) throw new Error('VRMA and automatic height fitting require a VRM avatar.')
    if (format === 'vrm' && item.embeddedClip !== undefined) throw new Error('embeddedClip is reserved for GLB avatars.')
    avatars[id] = Object.freeze({ id, name: text(item.name,'avatar name',128), description: text(item.description,'avatar description',512,true), src, format,
      thumbnail: item.thumbnail === undefined ? undefined : resolveCharacterResource(item.thumbnail,manifestUrl,rootUrl,/\.(png|webp|jpe?g)$/i),
      animations: item.animations === undefined ? undefined : resolveCharacterResource(item.animations,manifestUrl,rootUrl,/\.json$/i),
      embeddedClip: text(item.embeddedClip,'embedded clip',128,true),
      transform: Object.freeze({scale:bounded(transform.scale,.01,20,'scale',1), yawOffset:bounded(transform.yawOffset,-2*Math.PI,2*Math.PI,'yawOffset',0),autoFit:transform.autoFit ?? format==='vrm', ...(format==='vrm'?{targetHeight:bounded(transform.targetHeight,.5,3,'targetHeight',1.7)}:{})}) })
  }
  return Object.freeze({version:1, default:raw.default ?? null, noAvatarByDefault:raw.default === null, avatars:Object.freeze(avatars)})
}

export function validateWorldAnimationCatalog(raw, manifestUrl, rootUrl) {
  if (!record(raw) || ![1,2,3,4].includes(raw.version)) throw new Error('Unsupported animation catalog version.')
  const checkMap = (map, label) => {
    if (!record(map) || Object.keys(map).length > 128 || Object.keys(map).some(id => RESERVED.has(id) || id.length > 64)) throw new Error(`Invalid or oversized animation ${label}.`)
  }
  const clips = raw.version === 1 ? raw.actions : raw.clips
  checkMap(clips,'clips')
  const actions = raw.version === 1 ? {} : raw.actions ?? {}
  checkMap(actions,'actions')
  for (const item of Object.values(clips)) {
    if (item === false || item === null || item?.enabled === false) continue
    const def = typeof item === 'string' ? {src:item} : item
    if (!record(def)) throw new Error('Invalid animation clip.')
    resolveCharacterResource(def.src || def.source,manifestUrl,rootUrl,/\.vrma$/i)
    bounded(def.speed,.01,8,'clip speed')
  }
  for (const def of Object.values(actions)) {
    if (typeof def === 'string' || def === null || def === false) continue
    if (!record(def)) throw new Error('Invalid animation action.')
    bounded(def.speed,.01,8,'action speed'); bounded(def.crossFade,0,10,'crossFade'); bounded(def.priority,-10000,10000,'priority')
    if (def.events != null && (!Array.isArray(def.events) || def.events.length > 64)) throw new Error('Too many animation events.')
  }
  // Reuse the exact existing parser. Its reload query is internal; retain authored
  // relative references plus a separately validated canonical URL for M3.
  const normalized = normalizeAnimationCatalogManifest(raw,manifestUrl)
  const resolved = Object.create(null)
  for (const [id, clip] of Object.entries(normalized.clips)) resolved[id] = Object.freeze({...clip,src:resolveCharacterResource(clip.manifestSrc,manifestUrl,rootUrl,/\.vrma$/i)})
  return freezeJson({...normalized,clips:resolved})
}

async function readCatalog(url, fetchImpl, signal, budget) {
  signal.throwIfAborted()
  const response = await fetchImpl(url,{signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json'}})
  signal.throwIfAborted()
  if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error(`Catalog unavailable or redirected (HTTP ${response.status}).`)
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Character catalog exceeds byte limit or has no body.')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true}); let bytes=0, body=''
  try {
    for (;;) {
      signal.throwIfAborted()
      const {done,value} = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes+=value.byteLength; budget.bytes+=value.byteLength
      if (bytes>MAX_BYTES || budget.bytes>MAX_CATALOG_BYTES) throw new Error('Character catalog byte budget exceeded.')
      body+=decoder.decode(value,{stream:true})
    }
    body+=decoder.decode()
    return JSON.parse(body)
  } finally { void reader.cancel().catch(()=>{}); reader.releaseLock() }
}

// No model/clip binaries are requested at M1. Shared catalogs are fetched once.
// A failed optional catalog never prevents the other catalogs or world loading.
export async function loadWorldCharacterCapability(result, {fetchImpl=fetch,signal,onDiagnostic}={}) {
  signal?.throwIfAborted()
  const {avatars,animations} = result.project?.capabilities ?? {}
  const invalid = result.project?.invalidCharacterCapabilities ?? []
  if (!avatars && !animations && !invalid.length) return null
  const diagnostics=[...(result.project?.capabilityDiagnostics ?? [])]
  const report = message => { diagnostics.push(message); onDiagnostic?.(message) }
  let root, world
  try {
    root=safeRoot(result.rootUrl); world=new URL(result.worldUrl)
    if (new URL(projectPath(result.project.world ?? 'world.anyo.json').split('/').map(encodeURIComponent).join('/'),root).href!==world.href) throw new Error('Character capability source mismatch.')
  } catch(error) { report(error.message); return null }
  const deadline=AbortSignal.timeout(15000), combined=signal?AbortSignal.any([signal,deadline]):deadline, budget={bytes:0}
  const projectManifest=new URL('anyo.project.json',root).href
  const attempt=async(label,fn)=>{try{return await fn()}catch(error){if(signal?.aborted)signal.throwIfAborted();report(`${label}: ${error.message}`);return null}}
  const catalogPath=spec=>resolveCharacterResource(projectPath(spec.manifest),projectManifest,root.href,/\.json$/i)
  let avatarUrl=null, sharedUrl=null
  const avatarCatalog=avatars?await attempt('Avatar catalog',async()=>{avatarUrl=catalogPath(avatars);return validateAvatarCatalog(await readCatalog(avatarUrl,fetchImpl,combined,budget),avatarUrl,root.href)}):null
  if(animations)sharedUrl=await attempt('Shared animation path',()=>catalogPath(animations))
  const urls=[...new Set([sharedUrl,...Object.values(avatarCatalog?.avatars??{}).map(a=>a.animations)].filter(Boolean))]
  const animationCatalogs=Object.create(null)
  // Limit parallel requests, with a single deadline and aggregate byte budget.
  for(let i=0;i<urls.length;i+=4)await Promise.all(urls.slice(i,i+4).map(async url=>{
    animationCatalogs[url]=await attempt(`Animation catalog ${url}`,async()=>validateWorldAnimationCatalog(await readCatalog(url,fetchImpl,combined,budget),url,root.href))
  }))
  signal?.throwIfAborted()
  return Object.freeze({rootUrl:root.href,worldUrl:world.href,avatarUrl,avatarCatalog,avatarDeclared:Boolean(avatars || invalid.includes('avatars')),sharedAnimationDeclared:Boolean(animations || invalid.includes('animations')),sharedAnimationUrl:sharedUrl,animationCatalogs:Object.freeze(animationCatalogs),diagnostics:Object.freeze(diagnostics)})
}
