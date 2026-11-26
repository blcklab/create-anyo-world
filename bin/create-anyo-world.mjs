#!/usr/bin/env node
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const VERSION = '0.6.1'
const ANYO_TOOLING_VERSION = '0.11.0-rc.37'
const HELP = `create-anyo-world ${VERSION}\n\nUsage:\n  npm create anyo-world@latest my-world -- --lat=14.556201 --lng=121.024261\n  npm create anyo-world@latest my-world -- --mode=loader --github=blcklab/my-world\n  npm create anyo-world@latest my-world -- --mode=both --lat=14.556201 --lng=121.024261 --github=blcklab/my-world --web-surface=dashboard --web-resolution=full-hd\n\nOptions:\n  --mode=<atlas|loader|both>  Target workflow (default: atlas)\n  --title=<name>              Display title\n  --lat=<latitude>            World latitude (Atlas/both mode)\n  --lng=<longitude>           World longitude (Atlas/both mode)\n  --zoom=<3-20>               Preferred Atlas zoom (default: 20)\n  --osm=<type/id>             Optional exact OSM binding\n  --github=<user/repo>        GitHub repository used by Atlas/World Loader links\n  --ref=<git-ref>             Optional immutable tag/commit/branch\n  --web-surface[=<app-id>]    Add a repository-hosted Web Surface app (default id: dashboard)\n  --web-resolution=<quality>  360p, 540p, 720p/hd, or 1080p/full-hd (default: hd)\n  --modular                  Scaffold models/ with a native Anyo Object 0.1 example\n  --force                     Write into a non-empty/existing project directory\n  --version                   Show version\n  --help                      Show this help\n`

function parseArgs(argv) {
  const options = { force: false }
  const positional = []
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--force') options.force = true
    else if (arg === '--modular') options.modular = true
    else if (arg === '--web-surface') options['web-surface'] = true
    else if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...rest] = arg.slice(2).split('=')
      options[key] = rest.join('=')
    } else if (!arg.startsWith('-')) positional.push(arg)
    else throw new Error(`Unknown option ${arg}`)
  }
  return { projectName: positional[0] || null, options }
}

function slug(value) {
  const result = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result) || result.length > 214) throw new Error('Project name must begin with a letter or number and be a portable npm package name.')
  return result
}
function titleFromSlug(value) { return value.split(/[-_.]+/g).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ') }
function coordinate(value, limit, label) {
  const number = String(value ?? '').trim() === '' ? NaN : Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > limit) throw new Error(`${label} must be a finite value between -${limit} and ${limit}.`)
  return number
}
function zoom(value) {
  const number = Number(value ?? 20)
  if (!Number.isFinite(number) || number < 3 || number > 20) throw new Error('Zoom must be between 3 and 20.')
  return number
}
function normalizeMode(value) {
  const raw = String(value || 'atlas').trim().toLowerCase()
  if (raw === 'world-loader') return 'loader'
  if (!['atlas', 'loader', 'both'].includes(raw)) throw new Error('--mode must be atlas, loader, or both.')
  return raw
}
function parseOsm(value) {
  if (!value) return null
  const match = String(value).trim().match(/^(node|way|relation)[/:](.+)$/i)
  if (!match || !match[2].trim()) throw new Error('--osm must look like way/9200000033, relation/123, or node/123.')
  return { provider: 'openstreetmap', type: match[1].toLowerCase(), id: match[2].trim() }
}
function lotId(latitude, longitude, osm) { return osm ? `osm:${osm.type}:${osm.id}` : `geo:${latitude.toFixed(6)}:${longitude.toFixed(6)}` }
function normalizeGitHubRepository(value) {
  if (!value) return null
  let raw = String(value).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  const parts = raw.split('/').filter(Boolean)
  if (parts.length !== 2) throw new Error('--github must look like owner/repository.')
  const owner = parts[0]
  const repository = parts[1].replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || owner.includes('--') || owner.endsWith('-')) throw new Error('--github owner is not valid.')
  if (!repository || repository.length > 100 || !/^[A-Za-z0-9._-]+$/.test(repository) || repository === '.' || repository === '..') throw new Error('--github repository is not valid.')
  return `${owner}/${repository}`
}
function normalizeRef(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.length > 200 || !/^[A-Za-z0-9._-]+$/.test(raw) || raw === '.' || raw === '..' || raw.includes('..')) throw new Error('--ref must be a simple branch, tag, or commit name.')
  return raw
}
function normalizeWebAppId(value) {
  if (value === undefined || value === false || value === null || value === '') return null
  const raw = value === true ? 'dashboard' : String(value).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) throw new Error('--web-surface must use a portable app id containing only letters, numbers, dot, underscore, or dash.')
  return raw
}
const WEB_RESOLUTIONS = Object.freeze({
  low: [640, 360], '360p': [640, 360],
  balanced: [960, 540], '540p': [960, 540],
  hd: [1280, 720], '720p': [1280, 720],
  'full-hd': [1920, 1080], '1080p': [1920, 1080],
})
function webResolution(value) {
  const key = String(value || 'hd').trim().toLowerCase()
  const resolution = WEB_RESOLUTIONS[key]
  if (!resolution) throw new Error('--web-resolution must be 360p, 540p, 720p/hd, or 1080p/full-hd.')
  return [...resolution]
}
async function exists(file) { try { await access(file); return true } catch { return false } }
function json(value) { return JSON.stringify(value, null, 2) + '\n' }

function projectDocument({ id, title, atlasEnabled }) {
  return {
    schema: 'anyo-project@1',
    id,
    title,
    world: './world.anyo.json',
    directories: {
      assets: './assets/',
      webSurfaces: './web-surface/',
    },
    ...(atlasEnabled ? { manifests: { atlas: './atlas.world.json' } } : {}),
  }
}

function webSurfaceEntity(appId, resolution) {
  return {
    id: `web/${appId}`,
    type: 'web-surface',
    size: [4.8, 2.7],
    surface: { room: 'main', wall: 'north', offset: [0, 0.1] },
    webSurface: {
      source: { type: 'app', app: appId },
      target: { type: 'plane', size: [4.8, 2.7] },
      presentation: {
        type: 'texture',
        resolution,
        fit: 'contain',
        side: 'double',
        emissive: { color: '#ffffff', intensity: 1.08, useTexture: true },
      },
      fallback: { type: 'snapshot', image: './assets/web-surface-fallback.svg' },
      framePolicy: { mode: 'on-change' },
    },
  }
}

function worldDocument({ id, title, latitude = null, longitude = null, atlasEnabled = true, webApp = null, modular = false }) {
  const entities = []
  if (atlasEnabled) {
    entities.push(
      { id: 'map-exterior', type: 'group', components: [{ type: 'anyo.mapExterior' }], children: [
        { id: 'map-exterior-wall-north', type: 'box', position: [0, 2.1, -4], size: [8, 4.2, 0.18], material: 'wall', collision: true },
        { id: 'map-exterior-wall-west', type: 'box', position: [-4, 2.1, 0], size: [0.18, 4.2, 8], material: 'wall', collision: true },
        { id: 'map-exterior-wall-east', type: 'box', position: [4, 2.1, 0], size: [0.18, 4.2, 8], material: 'wall', collision: true },
        { id: 'map-exterior-wall-south-left', type: 'box', position: [-2.5, 2.1, 4], size: [3, 4.2, 0.18], material: 'wall', collision: true },
        { id: 'map-exterior-wall-south-right', type: 'box', position: [2.5, 2.1, 4], size: [3, 4.2, 0.18], material: 'wall', collision: true },
        { id: 'map-exterior-roof', type: 'box', position: [0, 4.25, 0], size: [8.1, 0.18, 8.1], material: 'wall', collision: false },
      ] },
    )
  }
  if (webApp) entities.push(webSurfaceEntity(webApp.id, webApp.resolution))
  else entities.push({ id: 'welcome', type: 'text', content: title.toUpperCase(), size: [4.6, 0.8], surface: { room: 'main', wall: 'north', offset: [0, 0.65] }, style: { fontSize: 0.22, fontWeight: 750, color: '#172033' } })
  entities.push(modular
    ? { id: 'centerpiece', composition: 'centerpiece', room: 'main', position: [0, 1, -1.5] }
    : { id: 'centerpiece', type: 'box', room: 'main', position: [0, 1, -1.5], size: [1.4, 1.4, 1.4], material: 'accent', collision: true })
  if (atlasEnabled) {
    entities.push(
      { id: 'map-main-entrance', type: 'group', room: 'main', position: [0, 1.65, 3.1], components: [{ type: 'anyo.mapSpawn' }] },
      { id: 'map-interior-exit', type: 'group', room: 'main', position: [0, 1.35, 3.72], components: [{ type: 'anyo.mapExit', label: 'Return outside', transition: 'stream', interactionDistance: 4 }], children: [
        { id: 'map-exit-frame-left', type: 'box', position: [-1.21, 0, 0.02], size: [0.08, 2.7, 0.08], material: 'map-exit-marker', collision: false, castShadow: false, receiveShadow: false },
        { id: 'map-exit-frame-right', type: 'box', position: [1.21, 0, 0.02], size: [0.08, 2.7, 0.08], material: 'map-exit-marker', collision: false, castShadow: false, receiveShadow: false },
        { id: 'map-exit-frame-top', type: 'box', position: [0, 1.31, 0.02], size: [2.5, 0.08, 0.08], material: 'map-exit-marker', collision: false, castShadow: false, receiveShadow: false },
        { id: 'map-exit-threshold', type: 'box', position: [0, -1.315, 0.08], size: [1.95, 0.07, 0.28], material: 'map-exit-marker', collision: false, castShadow: false, receiveShadow: false },
        { id: 'map-exit-label', type: 'text', position: [0, 1.67, 0.03], text: 'E · EXIT', fontSize: 0.17, color: '#fff7d6', align: 'center', castShadow: false },
      ] },
    )
  }

  const data = {}
  if (latitude !== null && longitude !== null) {
    data.location = { name: title, latitude, longitude, coordinates: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` }
  }
  if (atlasEnabled) {
    data.atlas = { entrance: { room: 'main', opening: 'entrance', targetSpawn: 'map-main-entrance', interactionDistance: 3.4, marker: 'none' } }
  }

  return {
    $schema: 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json',
    version: '0.9',
    metadata: {
      title,
      description: atlasEnabled ? `${title}, a portable Anyo world for Atlas and World Loader.` : `${title}, a portable Anyo world for World Loader.`,
      ...(webApp ? { webSurface: `Repository app "${webApp.id}" is discovered by World Loader from web-surface/${webApp.id}/web-surface.json.` } : {}),
    },
    ...(modular ? { imports: { centerpiece: { src: './models/centerpiece.anyo.json' } } } : {}),
    ...(Object.keys(data).length ? { data } : {}),
    environment: {
      background: '#111827',
      ambientLight: { color: '#eef2ff', intensity: 0.28 },
      lighting: { enabled: true, skyColor: '#aab8d0', groundColor: '#1c2533', diffuseIntensity: 0.34, specularIntensity: 0.22 },
      colorManagement: { toneMapping: 'aces', exposure: 1, outputColorSpace: 'srgb' },
      shadows: { enabled: true, mapSize: 1024, bias: 0.0008, normalBias: 0.015, softness: 1, cameraPadding: 2 },
      imageQuality: { dithering: true, maxAnisotropy: 4 },
      sun: { color: '#ffffff', intensity: 0.78, position: [7, 10, 6], castShadow: true },
    },
    materials: {
      wall: { color: '#e8edf5', roughness: 0.9, receiveShadow: true, castShadow: true },
      floor: { color: '#65748a', roughness: 0.7, receiveShadow: true, castShadow: true },
      ...(!modular ? { accent: { color: '#7dd3fc', roughness: 0.35, metalness: 0.2, receiveShadow: true, castShadow: true } } : {}),
      'map-exit-marker': { color: '#f5c76d', roughness: 0.24, emissive: '#f5b942', emissiveIntensity: 0.7, transparent: true, opacity: 0.78 },
    },
    building: {
      id,
      name: title,
      floors: [{ id: 'ground', elevation: 0, rooms: [{ id: 'main', size: [8, 8], materials: { wall: 'wall', floor: 'floor' }, openings: [{ id: 'entrance', type: 'door', wall: 'south', offset: 'center', width: 2, height: 2.5, open: true }] }] }],
    },
    entities,
    exploration: { spawn: { room: 'main', position: [0, 1.65, 2.5] }, pointerLock: true },
    revision: 0,
  }
}


function modularObjectDocument({ title }) {
  return {
    $schema: 'https://anyo.blcklab.dev/schemas/object-0.1.schema.json',
    kind: 'anyo-object',
    version: '0.1',
    metadata: {
      title: `${title} Centerpiece`,
      description: 'Example reusable native Anyo object generated by create-anyo-world.',
    },
    materials: {
      accent: { color: '#7dd3fc', roughness: 0.35, metalness: 0.2, receiveShadow: true, castShadow: true },
    },
    root: {
      id: 'centerpiece-root',
      type: 'group',
      children: [{
        id: 'centerpiece-body',
        type: 'box',
        size: [1.4, 1.4, 1.4],
        material: 'accent',
        collision: true,
      }],
    },
  }
}

function anyoDocumentsSource() {
  return `import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const PROJECT_PROTOCOL = 'anyo-project:'
const PROJECT_HOST = 'root'
const PROJECT_BASE = 'anyo-project://root/'
const projectRoot = await realpath(path.resolve('.'))
const projectRootPrefix = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep

export const rootWorldUrl = new URL('world.anyo.json', PROJECT_BASE).href
export const rootSourceContext = Object.freeze({ documentUrl: rootWorldUrl, baseUrl: PROJECT_BASE })

function insideProject(file) {
  return file === projectRoot || file.startsWith(projectRootPrefix)
}

function projectPathFromUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== PROJECT_PROTOCOL || url.hostname !== PROJECT_HOST) {
    throw new Error('Generated Anyo tooling resolves local project imports only: ' + rawUrl)
  }
  if (url.search || url.hash) throw new Error('Local Anyo object imports may not contain query strings or fragments: ' + rawUrl)
  const relative = decodeURIComponent(url.pathname).replace(/^\\/+/, '')
  const candidate = path.resolve(projectRoot, relative)
  if (!insideProject(candidate)) throw new Error('Anyo import escapes the generated project root: ' + rawUrl)
  return candidate
}

export async function readRootWorld() {
  const sourceText = await readFile(path.join(projectRoot, 'world.anyo.json'), 'utf8')
  return { document: JSON.parse(sourceText), sourceText }
}

export async function loadProjectAnyoDocument(request) {
  const candidate = projectPathFromUrl(request.url)
  const actual = await realpath(candidate)
  if (!insideProject(actual)) throw new Error('Anyo import resolves outside the generated project root: ' + request.url)
  const sourceText = await readFile(actual, 'utf8')
  let document
  try { document = JSON.parse(sourceText) }
  catch (error) { throw new Error('Invalid JSON in ' + request.url + ': ' + (error instanceof Error ? error.message : String(error))) }
  return { document, documentUrl: request.url, sourceText }
}

function portableProjectString(value, outputFile) {
  let url
  try { url = new URL(value) } catch { return value }
  if (url.protocol !== PROJECT_PROTOCOL || url.hostname !== PROJECT_HOST) return value
  const relativeProjectPath = decodeURIComponent(url.pathname).replace(/^\\/+/, '')
  const target = path.resolve(projectRoot, relativeProjectPath)
  if (!insideProject(target)) throw new Error('Bundled URL escapes the generated project root: ' + value)
  const outputDirectory = path.dirname(path.resolve(projectRoot, outputFile))
  let relative = path.relative(outputDirectory, target).split(path.sep).join('/')
  if (!relative.startsWith('.')) relative = './' + relative
  return relative + url.search + url.hash
}

export function makeProjectUrlsPortable(value, outputFile = 'dist/world.anyo.json') {
  if (typeof value === 'string') return portableProjectString(value, outputFile)
  if (Array.isArray(value)) return value.map(entry => makeProjectUrlsPortable(entry, outputFile))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, makeProjectUrlsPortable(entry, outputFile)]))
  }
  return value
}
`
}

function devServerSource() {
  return `import { createReadStream, existsSync } from 'node:fs'
import { stat, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const root = await realpath(resolve('.'))

function option(name, fallback) {
  const exact = process.argv.find(argument => argument.startsWith(name + '='))
  if (exact) return exact.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1]
  return fallback
}

const host = String(option('--host', process.env.HOST || '127.0.0.1')).trim() || '127.0.0.1'
const rawPort = String(option('--port', process.env.PORT || '4174')).trim()
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Anyo world dev server: --port must be an integer from 1 to 65535')
  process.exit(1)
}

const mime = new Map([
  ['.json','application/json; charset=utf-8'],['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],
  ['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],
  ['.glb','model/gltf-binary'],['.gltf','model/gltf+json'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],
  ['.webp','image/webp'],['.gif','image/gif'],['.ico','image/x-icon'],['.woff','font/woff'],['.woff2','font/woff2'],['.hdr','image/vnd.radiance'],['.vrm','model/gltf-binary'],['.vrma','model/gltf-binary'],['.ktx2','image/ktx2'],['.wasm','application/wasm'],['.mp3','audio/mpeg'],['.ogg','audio/ogg'],['.mp4','video/mp4'],['.webm','video/webm']
])
const cors = { 'access-control-allow-origin':'*', 'cache-control':'no-store' }
const server = createServer(async (req,res) => {
  const fail = (status, message) => { res.writeHead(status,cors); res.end(message) }
  if (req.method === 'OPTIONS') { res.writeHead(204,{...cors,'access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'Range'}); return res.end() }
  if (!['GET','HEAD'].includes(req.method)) return fail(405,'Method not allowed')
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = existsSync(join(root,'atlas.world.json')) ? '/atlas.world.json' : '/world.anyo.json'
    const segments = pathname.split('/')
    if (segments.some(part => part.startsWith('.') || part === 'node_modules') || segments[1] === 'scripts' || pathname.includes(String.fromCharCode(92))) return fail(404,'Not found')
    const file = resolve(root,'.'+pathname)
    if (!file.startsWith(root+sep)) return fail(404,'Not found')
    const actual = await realpath(file)
    if (!actual.startsWith(root+sep) || actual.slice(root.length+1).split(sep).some(part => part.startsWith('.') || part === 'node_modules') || actual.slice(root.length+1).split(sep)[0] === 'scripts') return fail(404,'Not found')
    const info = await stat(actual)
    if (!info.isFile()) return fail(404,'Not found')
    res.writeHead(200,{...cors,'content-type':mime.get(extname(actual).toLowerCase()) || 'application/octet-stream','content-length':info.size})
    if (req.method === 'HEAD') return res.end()
    const stream = createReadStream(actual)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  } catch { return fail(404,'Not found') }
})

server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    console.error(\`Anyo world dev server: \${host}:\${port} is already in use. Try --port=\${port + 1}.\`)
    process.exitCode = 1
    return
  }
  throw error
})

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const entry = existsSync(join(root,'atlas.world.json')) ? 'atlas.world.json' : 'world.anyo.json'
  const authority = displayHost.includes(':') ? '[' + displayHost + ']' : displayHost
  const sourceRoot = 'http://' + authority + ':' + port + '/'
  console.log('Anyo world source: ' + sourceRoot + entry)
  console.log('World Loader preview (start Loader separately): http://localhost:5173/?registryRoot=' + encodeURIComponent(sourceRoot))
})
`
}

function validateSource() {
  return `import { inspectWorldDocument, resolveWorldDocumentImports } from '@blcklab/anyo'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadProjectAnyoDocument, readRootWorld, rootSourceContext } from './anyo-documents.mjs'

async function exists(file) { try { await access(file); return true } catch { return false } }
function formatIssues(issues) { return issues.slice(0, 8).map(issue => issue.code + ' ' + issue.path + ': ' + issue.message).join('\\n') }
function countImports(imports) { return Object.values(imports).reduce((total, item) => total + 1 + countImports(item.imports || {}), 0) }

const project=JSON.parse(await readFile('anyo.project.json','utf8'))
if(project.schema!=='anyo-project@1') throw new Error('anyo.project.json must use anyo-project@1')
if(!/^[a-z0-9][a-z0-9._-]*$/.test(String(project.id||''))) throw new Error('anyo.project.json has invalid id')
if(!String(project.title||'').trim()) throw new Error('anyo.project.json title is required')
if(project.world!=='./world.anyo.json') throw new Error('anyo.project.json world must be ./world.anyo.json')
if(project.directories?.assets!=='./assets/' || project.directories?.webSurfaces!=='./web-surface/') throw new Error('anyo.project.json must use canonical assets and web-surface directories')
if(!(await exists('world.anyo.json'))) throw new Error('anyo.project.json references missing world.anyo.json')
const { document: world } = await readRootWorld()
if(world.version!=='0.9') throw new Error('Generated project expects Anyo World 0.9; found '+String(world.version))
const validation=inspectWorldDocument(world)
if(!validation.valid) throw new Error('Anyo World 0.9 validation failed:\\n'+formatIssues(validation.errors))
const graph=await resolveWorldDocumentImports(world,{sourceContext:rootSourceContext,documentLoader:loadProjectAnyoDocument})
console.log('Anyo World 0.9 contract: PASS')
const importCount=countImports(graph.imports)
if(importCount) console.log('Anyo object imports: PASS ('+importCount+')')

if(project.manifests?.atlas && !(await exists('atlas.world.json'))) throw new Error('Project references missing atlas.world.json')
if(await exists('atlas.world.json')) {
  if(project.manifests?.atlas!=='./atlas.world.json') throw new Error('Atlas project must declare manifests.atlas as ./atlas.world.json')
  const manifest=JSON.parse(await readFile('atlas.world.json','utf8'))
  if(manifest.schema!=='anyo-world-manifest@1') throw new Error('atlas.world.json must use anyo-world-manifest@1')
  if(!manifest.id||!manifest.title||!manifest.world||!manifest.location) throw new Error('Manifest is missing id, title, world, or location')
  const {latitude,longitude}=manifest.location
  if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180) throw new Error('Invalid manifest location')
  if(!manifest.placement||!['exact-building','nearest-building','coordinate-only'].includes(manifest.placement.mapMatch)) throw new Error('Manifest must declare a geographic match mode')
  if(!world.entities.some(entity=>entity.components?.some(component=>component.type==='anyo.mapSpawn'))) throw new Error('Atlas world must include anyo.mapSpawn')
  if(!world.entities.some(entity=>entity.components?.some(component=>component.type==='anyo.mapExit'))) throw new Error('Atlas world must include anyo.mapExit')
  const entrance=world.data?.atlas?.entrance
  if(!entrance?.room||!entrance?.opening) throw new Error('Atlas world must declare data.atlas.entrance room/opening')
  console.log('Anyo Atlas contract: PASS')
  console.log('Lot:', manifest.lotId)
  console.log('Location:', latitude.toFixed(6)+', '+longitude.toFixed(6))
  console.log('Local Atlas:', 'http://127.0.0.1:4173/?manifest='+encodeURIComponent('http://127.0.0.1:4174/atlas.world.json')+'&backend=webgl2')
}

const appEntities = world.entities.filter(entity=>entity?.type==='web-surface' && entity.webSurface?.source?.type==='app')
const registered = new Set()
if(await exists('web-surface')) {
  for(const entry of await readdir('web-surface',{withFileTypes:true})) {
    if(!entry.isDirectory()) continue
    const manifestPath=path.join('web-surface',entry.name,'web-surface.json')
    if(!(await exists(manifestPath))) continue
    const app=JSON.parse(await readFile(manifestPath,'utf8'))
    if(app.schema!=='anyo-web-app@1') throw new Error(manifestPath+' must use anyo-web-app@1')
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(app.id||''))) throw new Error(manifestPath+' has invalid id')
    if(app.id!==entry.name) throw new Error(manifestPath+' id must match its directory')
    if(registered.has(app.id)) throw new Error('Duplicate Web Surface app id: '+app.id)
    const rawEntry=String(app.entry||'')
    if(!rawEntry || /^[a-z][a-z0-9+.-]*:/i.test(rawEntry) || rawEntry.startsWith('/') || rawEntry.split(/[?#]/,1)[0].split('/').includes('..')) throw new Error(manifestPath+' entry must stay inside the app directory')
    const entryFile=path.resolve('web-surface',entry.name,rawEntry.split(/[?#]/,1)[0])
    const appRoot=path.resolve('web-surface',entry.name)+path.sep
    if(!entryFile.startsWith(appRoot) || !(await exists(entryFile))) throw new Error(manifestPath+' entry file does not exist')
    const actualEntry=await realpath(entryFile)
    const actualAppRoot=await realpath(appRoot) + path.sep
    if(!actualEntry.startsWith(actualAppRoot) || !(await stat(actualEntry)).isFile()) throw new Error(manifestPath+' entry must stay inside the app directory')
    registered.add(app.id)
  }
}
for(const entity of appEntities) if(!registered.has(entity.webSurface.source.app)) throw new Error('World references unregistered Web Surface app: '+entity.webSurface.source.app)
if(registered.size) console.log('Web Surface apps: PASS ('+registered.size+')')
console.log('Anyo project contract: PASS')
console.log('Anyo World Loader contract: PASS')
`
}

function bundleSource() {
  return `import { bundleWorldDocument, validateWorldDocument } from '@blcklab/anyo'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadProjectAnyoDocument, makeProjectUrlsPortable, readRootWorld, rootSourceContext } from './anyo-documents.mjs'

const outputFile='dist/world.anyo.json'
const { document: world }=await readRootWorld()
if(world.version!=='0.9') throw new Error('Generated project expects Anyo World 0.9; found '+String(world.version))
const bundled=await bundleWorldDocument(world,{sourceContext:rootSourceContext,documentLoader:loadProjectAnyoDocument})
const portable=makeProjectUrlsPortable(bundled,outputFile)
validateWorldDocument(portable)
await mkdir(path.dirname(outputFile),{recursive:true})
await writeFile(outputFile,JSON.stringify(portable,null,2)+'\\n')
console.log('Anyo standalone bundle: PASS')
console.log('Output:', outputFile)
`
}

function atlasRepositoryUrl(repository, ref, enter = false) {
  if (!repository) return null
  const params = new URLSearchParams({ world: repository, backend: 'webgl2' })
  if (ref) params.set('ref', ref)
  if (enter) params.set('enter', '1')
  return `http://127.0.0.1:4173/?${params}`
}

function worldLoaderRepositoryRoute(repository, ref) {
  if (!repository) return null
  const [owner, name] = repository.split('/')
  const route = `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  return ref ? `${route}?ref=${encodeURIComponent(ref)}` : route
}

function webAppFiles(appId, title) {
  const appTitle = `${title} Dashboard`
  const manifest = { schema: 'anyo-web-app@1', id: appId, title: appTitle, entry: './index.html', description: `${title} repository-hosted Web Surface application.` }
  const html = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${escapeHtml(appTitle)}</title>\n  <link rel="stylesheet" href="./style.css">\n</head>\n<body>\n  <main class="shell">\n    <header class="topbar">\n      <div><p class="eyebrow">ANYO WEB SURFACE</p><h1>${escapeHtml(title)}</h1></div>\n      <span class="status" id="status">ONLINE</span>\n    </header>\n    <section class="hero">\n      <div><p class="eyebrow">REPOSITORY APPLICATION</p><h2>Normal HTML, CSS and JavaScript inside your Anyo world.</h2><p>Edit this app under <code>web-surface/${escapeHtml(appId)}/</code>. World Loader discovers it automatically from <code>web-surface.json</code>.</p></div>\n      <button id="pulse" type="button">Run interaction</button>\n    </section>\n    <section class="grid" aria-label="Runtime cards">\n      <article><span>Surface</span><strong>Interactive</strong></article>\n      <article><span>Layout</span><strong>Responsive</strong></article>\n      <article><span>Security</span><strong>Sandboxed</strong></article>\n    </section>\n    <section class="log" aria-live="polite"><span>EVENT</span><output id="event">Ready for input.</output></section>\n  </main>\n  <script type="module" src="./app.js"></script>\n</body>\n</html>\n`
  const css = `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080c12;color:#f7fafc}*{box-sizing:border-box}body{margin:0;min-width:280px;min-height:100vh;background:radial-gradient(circle at 85% 0%,#12314a 0,transparent 36%),#080c12}.shell{min-height:100vh;padding:clamp(20px,4vw,64px);display:grid;align-content:center;gap:clamp(18px,3vw,36px)}.topbar,.hero,.grid,.log{width:min(1120px,100%);margin-inline:auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:24px}.eyebrow{margin:0 0 8px;color:#64d8ff;font-size:.72rem;font-weight:800;letter-spacing:.18em}.topbar h1,.hero h2{margin:0}.topbar h1{font-size:clamp(1.5rem,3vw,2.5rem)}.status{padding:8px 12px;border:1px solid #2b6279;border-radius:999px;color:#8ce7ff;font-size:.72rem;font-weight:800}.hero{padding:clamp(24px,5vw,56px);border:1px solid #203040;border-radius:28px;background:linear-gradient(145deg,rgba(18,29,42,.96),rgba(8,12,18,.94));box-shadow:0 22px 70px rgba(0,0,0,.32);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:28px}.hero h2{max-width:780px;font-size:clamp(2rem,5vw,4.8rem);line-height:.98;letter-spacing:-.045em}.hero p:not(.eyebrow){max-width:720px;color:#a8b7c6;line-height:1.7}.hero code{color:#d6f5ff}button{border:0;border-radius:14px;padding:14px 18px;background:#eafaff;color:#07121a;font:inherit;font-weight:800;cursor:pointer}button:hover,button:focus-visible{background:#7ee4ff;outline:none}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.grid article,.log{padding:18px 20px;border:1px solid #1f2d3a;border-radius:18px;background:#0d141d}.grid span,.log span{display:block;color:#6f8497;font-size:.72rem;letter-spacing:.12em}.grid strong{display:block;margin-top:6px;font-size:1.15rem}.log{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}.log output{color:#c8d5df}@media(max-width:760px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.topbar{align-items:flex-start}.status{margin-top:4px}}\n`
  const js = `const button=document.querySelector('#pulse');const output=document.querySelector('#event');const status=document.querySelector('#status');let count=0;button?.addEventListener('click',()=>{count+=1;output.value='Interaction '+count+' received at '+new Date().toLocaleTimeString();status.textContent=count%2?'ACTIVE':'ONLINE'});\n`
  return { manifest, html, css, js }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function fallbackSvg(title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#080c12"/><rect x="54" y="54" width="1172" height="612" rx="32" fill="#101924" stroke="#2a4253" stroke-width="2"/><text x="96" y="132" fill="#64d8ff" font-family="system-ui,sans-serif" font-size="24" font-weight="700" letter-spacing="4">ANYO WEB SURFACE</text><text x="96" y="232" fill="#f7fafc" font-family="system-ui,sans-serif" font-size="62" font-weight="750">${escapeHtml(title)}</text><text x="96" y="300" fill="#9eb0bf" font-family="system-ui,sans-serif" font-size="30">Repository app fallback snapshot</text><circle cx="1110" cy="126" r="12" fill="#64d8ff"/></svg>\n`
}

function generatedReadme({ title, mode, latitude, longitude, canonicalLotId, osm, localAtlasUrl, localDirectAtlasUrl, geographicAtlasUrl, github, publicAtlasUrl, directAtlasUrl, worldLoaderRoute, webApp, modular }) {
  const atlasEnabled = mode !== 'loader'
  const locationSection = atlasEnabled ? `## Location\n\n- Latitude: ${latitude.toFixed(6)}\n- Longitude: ${longitude.toFixed(6)}\n- Lot ID: \`${canonicalLotId}\`\n${osm ? `- OSM: \`${osm.type}/${osm.id}\`\n` : ''}\n` : ''
  const loaderSection = `## Anyo World Loader\n\nThe repository root \`world.anyo.json\` is the World Loader entry. ${github ? `Open the repository route after the Loader is running:\n\n\`\`\`text\nhttp://localhost:5173${worldLoaderRoute}\n\`\`\`\n` : 'After publishing, enter `OWNER/REPOSITORY` in World Loader or open its `/OWNER/REPOSITORY` route.\n'}\nWorld Loader resolves \`world.anyo.json\` from the selected repository ref. Do not add Loader-specific backend fields to the world document.\n\n`
  const atlasSection = atlasEnabled ? `## Atlas\n\nOpen Atlas against the local manifest:\n\n\`\`\`text\n${localAtlasUrl}\n\`\`\`\n\nOpen the authored world inside its streamed neighborhood:\n\n\`\`\`text\n${localDirectAtlasUrl}\n\`\`\`\n\nThe manifest owns the world location, so the Atlas URL does not need coordinates. Without an exact OSM ID the world is location-only: Atlas can discover it nearby but will not claim or replace an arbitrary building. Supply an exact OSM ID for deterministic building replacement.\n\n${github ? `Repository Atlas URL:\n\n\`\`\`text\n${publicAtlasUrl}\n\`\`\`\n\nDirect 3D URL:\n\n\`\`\`text\n${directAtlasUrl}\n\`\`\`\n\n` : ''}Geographic navigation remains available:\n\n\`\`\`text\n${geographicAtlasUrl}\n\`\`\`\n\n` : ''
  const authoringSection = modular ? `## Modular authoring\n\nThis starter keeps the repository entry at \`world.anyo.json\` and places one reusable native Anyo object at \`models/centerpiece.anyo.json\`. The root world imports it by alias. Add more Object 0.1 documents under \`models/\` as the project grows.\n\n` : `## Authoring\n\nThis starter intentionally keeps everything in one World 0.9 file. If you want an example native-object layout in a new project, regenerate with \`--modular\`.\n\n`
  const webSection = webApp ? `## Web Surface\n\nA framework-agnostic repository web application is included at:\n\n\`\`\`text\nweb-surface/${webApp.id}/\n├─ web-surface.json\n├─ index.html\n├─ style.css\n├─ app.js\n└─ assets/\n\`\`\`\n\nThe manifest uses \`anyo-web-app@1\`. World Loader discovers it automatically at the pinned repository ref. The matching world entity uses \`source.type = "app"\` and app id \`${webApp.id}\`. Its requested presentation resolution is **${webApp.resolution[0]}×${webApp.resolution[1]}**.\n\nKeep application HTML/CSS/JS in this folder; do not embed executable HTML inside \`world.anyo.json\`. Normal browser security and sandbox behavior still apply.\n\n` : ''
  return `# ${title}\n\nPortable Anyo world repository generated for **${mode === 'loader' ? 'World Loader' : mode === 'both' ? 'Atlas + World Loader' : 'Atlas (and directly loadable by World Loader)'}**.\n\n${locationSection}## Anyo project\n\nEdit \`world.anyo.json\` directly or open the folder in Anyo Editor using \`anyo.project.json\`. Local editor state in \`.anyo/\` is ignored.\n\n## Develop\n\n\`\`\`bash\nnpm install\nnpm run validate\nnpm run bundle\nnpm run dev\n\`\`\`\n\n\`npm run validate\` uses the pinned \`@blcklab/anyo\` package as the World 0.9 schema and import authority. \`npm run bundle\` writes a deterministic standalone document to \`dist/world.anyo.json\` with native Anyo object imports flattened.\n\nStart Anyo World Loader 0.6.0-rc.1 separately (\`npm run dev\` in its repository), then open:\n\n\`\`\`text\nhttp://localhost:5173/?registryRoot=http%3A%2F%2F127.0.0.1%3A4174%2F\n\`\`\`\n\nThe world dev server serves JSON and assets, not a second renderer. Refresh the Loader after editing. Use the printed URL if you change ports.\n\nRun multiple local worlds on separate ports with \`npm run dev -- --port=4175\` (or \`--port 4175\`).\n\n${loaderSection}${atlasSection}${authoringSection}${webSection}## Publish\n\n1. Push this folder to GitHub.\n2. Keep \`anyo.project.json\` and \`world.anyo.json\` at the repository root.${atlasEnabled ? '\n3. Keep `atlas.world.json` at the repository root for Atlas.\n4. Prefer a version tag for stable public links.' : '\n3. Prefer a version tag for stable public links.'}\n`
}

export async function scaffold(argv = process.argv.slice(2), io = {}) {
  const parsed = parseArgs(argv)
  if (parsed.options.version) { (io.log || console.log)(VERSION); return { version: VERSION } }
  if (parsed.options.help) { (io.log || console.log)(HELP); return { help: true } }
  const rl = io.readline || readline.createInterface({ input, output })
  const ownRl = !io.readline
  try {
    const rawName = parsed.projectName || await rl.question('Project name: ')
    const id = slug(rawName)
    const title = String(parsed.options.title || titleFromSlug(id)).trim() || titleFromSlug(id)
    const mode = normalizeMode(parsed.options.mode)
    const atlasEnabled = mode !== 'loader'
    const modular = parsed.options.modular === true

    let latitude = null
    let longitude = null
    let preferredZoom = null
    let osm = null
    let canonicalLotId = null
    if (atlasEnabled) {
      const latValue = parsed.options.lat ?? await rl.question('Latitude: ')
      const lngValue = parsed.options.lng ?? await rl.question('Longitude: ')
      latitude = coordinate(latValue, 90, 'Latitude')
      longitude = coordinate(lngValue, 180, 'Longitude')
      preferredZoom = zoom(parsed.options.zoom)
      osm = parseOsm(parsed.options.osm)
      if (!osm && parsed.options.osm === undefined && io.interactiveOsm === true) osm = parseOsm(await rl.question('OSM building (optional, e.g. way/123): '))
      canonicalLotId = lotId(latitude, longitude, osm)
    } else if (parsed.options.osm !== undefined || parsed.options.lat !== undefined || parsed.options.lng !== undefined || parsed.options.zoom !== undefined) {
      throw new Error('Latitude, longitude, zoom, and OSM options require --mode=atlas or --mode=both.')
    }

    const appId = normalizeWebAppId(parsed.options['web-surface'])
    const appResolution = appId ? webResolution(parsed.options['web-resolution']) : null
    if (!appId && parsed.options['web-resolution'] !== undefined) throw new Error('--web-resolution requires --web-surface.')
    const webApp = appId ? { id: appId, resolution: appResolution } : null

    const github = normalizeGitHubRepository(parsed.options.github)
    const gitRef = normalizeRef(parsed.options.ref)
    const target = path.resolve(io.cwd || process.cwd(), id)
    if (await exists(target) && !parsed.options.force) throw new Error(`Target ${target} already exists. Use --force to overwrite starter files.`)
    await mkdir(path.join(target, 'assets'), { recursive: true })
    await mkdir(path.join(target, 'scripts'), { recursive: true })
    await mkdir(path.join(target, 'web-surface'), { recursive: true })
    if (modular) await mkdir(path.join(target, 'models'), { recursive: true })
    if (webApp) await mkdir(path.join(target, 'web-surface', webApp.id, 'assets'), { recursive: true })

    const manifest = atlasEnabled ? {
      schema: 'anyo-world-manifest@1', id, title, version: '0.1.0', lotId: canonicalLotId,
      world: './world.anyo.json', assetsBase: './assets/',
      location: { latitude, longitude, zoom: preferredZoom, radiusMeters: 80, ...(osm ? { osm } : {}) },
      placement: {
        anchor: 'footprint-center', fit: 'uniform-contain', northAxis: '+x', groundLevel: 0,
        mapMatch: osm ? 'exact-building' : 'coordinate-only',
        maximumDistanceMeters: 120,
        portal: true,
      },
    } : null

    const publicAtlasUrl = atlasEnabled ? atlasRepositoryUrl(github, gitRef, false) : null
    const directAtlasUrl = atlasEnabled ? atlasRepositoryUrl(github, gitRef, true) : null
    const worldLoaderRoute = worldLoaderRepositoryRoute(github, gitRef)
    const localManifestUrl = atlasEnabled ? 'http://127.0.0.1:4174/atlas.world.json' : null
    const localAtlasUrl = atlasEnabled ? `http://127.0.0.1:4173/?manifest=${encodeURIComponent(localManifestUrl)}&backend=webgl2` : null
    const localDirectAtlasUrl = atlasEnabled ? `${localAtlasUrl}&enter=1` : null
    const geographicAtlasUrl = atlasEnabled ? `http://127.0.0.1:4173/?lat=${latitude.toFixed(6)}&lng=${longitude.toFixed(6)}&z=${preferredZoom}&backend=webgl2` : null
    const pkg = { name: id, version: '0.1.0', private: true, type: 'module', engines: { node: '>=20' }, scripts: { dev: 'node scripts/dev.mjs', validate: 'node scripts/validate.mjs', bundle: 'node scripts/bundle.mjs', check: 'npm run validate && npm run bundle' }, devDependencies: { '@blcklab/anyo': ANYO_TOOLING_VERSION } }
    const readme = generatedReadme({ title, mode, latitude, longitude, canonicalLotId, osm, localAtlasUrl, localDirectAtlasUrl, geographicAtlasUrl, github, publicAtlasUrl, directAtlasUrl, worldLoaderRoute, webApp, modular })

    const project = projectDocument({ id, title, atlasEnabled })
    const writes = [
      writeFile(path.join(target, 'world.anyo.json'), json(worldDocument({ id, title, latitude, longitude, atlasEnabled, webApp, modular }))),
      writeFile(path.join(target, 'package.json'), json(pkg)),
      writeFile(path.join(target, 'README.md'), readme),
      writeFile(path.join(target, '.gitignore'), 'node_modules/\n/dist/\n.DS_Store\n.anyo/\n.env\n.env.*\n!.env.example\n'),
      writeFile(path.join(target, 'assets', '.gitkeep'), ''),
      writeFile(path.join(target, 'web-surface', '.gitkeep'), ''),
      writeFile(path.join(target, 'scripts', 'dev.mjs'), devServerSource()),
      writeFile(path.join(target, 'scripts', 'validate.mjs'), validateSource()),
      writeFile(path.join(target, 'scripts', 'bundle.mjs'), bundleSource()),
      writeFile(path.join(target, 'scripts', 'anyo-documents.mjs'), anyoDocumentsSource()),
    ]
    if (modular) writes.push(writeFile(path.join(target, 'models', 'centerpiece.anyo.json'), json(modularObjectDocument({ title }))))
    if (manifest) writes.push(writeFile(path.join(target, 'atlas.world.json'), json(manifest)))
    if (webApp) {
      const files = webAppFiles(webApp.id, title)
      const appRoot = path.join(target, 'web-surface', webApp.id)
      writes.push(
        writeFile(path.join(appRoot, 'web-surface.json'), json(files.manifest)),
        writeFile(path.join(appRoot, 'index.html'), files.html),
        writeFile(path.join(appRoot, 'style.css'), files.css),
        writeFile(path.join(appRoot, 'app.js'), files.js),
        writeFile(path.join(appRoot, 'assets', '.gitkeep'), ''),
        writeFile(path.join(target, 'assets', 'web-surface-fallback.svg'), fallbackSvg(title)),
      )
    }
    await Promise.all(writes)
    await writeFile(path.join(target, 'anyo.project.json'), json(project))

    ;(io.log || console.log)(`Created ${id}`)
    ;(io.log || console.log)(`Mode: ${mode}`)
    if (canonicalLotId) (io.log || console.log)(`Lot: ${canonicalLotId}`)
    if (localAtlasUrl) (io.log || console.log)(`Local Atlas: ${localAtlasUrl}`)
    if (localDirectAtlasUrl) (io.log || console.log)(`Local neighborhood: ${localDirectAtlasUrl}`)
    if (publicAtlasUrl) (io.log || console.log)(`GitHub Atlas: ${publicAtlasUrl}`)
    if (worldLoaderRoute) (io.log || console.log)(`World Loader route: ${worldLoaderRoute}`)
    ;(io.log || console.log)(`Authoring: ${modular ? 'modular' : 'single-file'} World 0.9`)
    if (webApp) (io.log || console.log)(`Web Surface: ${webApp.id} (${webApp.resolution[0]}x${webApp.resolution[1]})`)
    return {
      target, id, title, mode, lotId: canonicalLotId, manifest, github, ref: gitRef,
      atlasUrl: publicAtlasUrl, directAtlasUrl, localAtlasUrl, localDirectAtlasUrl, geographicAtlasUrl,
      worldLoaderRoute, webSurface: webApp, authoring: modular ? 'modular' : 'single-file',
    }
  } finally { if (ownRl) rl.close() }
}

if (/^create-anyo-world(?:\.mjs)?$/i.test(path.basename(process.argv[1] || ''))) {
  scaffold().catch(error => { console.error(`create-anyo-world: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
