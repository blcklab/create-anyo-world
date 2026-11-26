import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { scaffold } from '../bin/create-anyo-world.mjs'

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const expectedAnyoVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).devDependencies['@blcklab/anyo']
const toolingError = 'Install the pinned @blcklab/anyo dependency with npm ci at the generator repository root. Check ANYO_TEST_PACKAGE_ROOT if set.'

async function resolveAnyoTooling() {
  try {
    const configured = process.env.ANYO_TEST_PACKAGE_ROOT
    const root = await realpath(configured
      ? path.resolve(configured)
      : path.dirname(fileURLToPath(import.meta.resolve('@blcklab/anyo/package.json'))))
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    assert.equal(manifest.name, '@blcklab/anyo')
    assert.equal(manifest.version, expectedAnyoVersion)
    // A built package must expose a public ESM entry, not an empty placeholder directory.
    const entry = manifest.exports?.['.']?.import
    assert.equal(typeof entry, 'string', 'Missing public Anyo ESM export')
    await readFile(path.resolve(root, entry))
    return root
  } catch (error) {
    throw new Error(`Anyo test dependency is missing or invalid: ${error.message}. ${toolingError}`, { cause: error })
  }
}

async function installGeneratedAnyoTooling(target) {
  const source = await resolveAnyoTooling()
  const scope = path.join(target, 'node_modules', '@blcklab')
  const destination = path.join(scope, 'anyo')
  await mkdir(scope, { recursive: true })
  // Tests use isolated copies of the real installed package. No symlink-based
  // package resolution, registry request, or mocked validation is necessary.
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

async function runGeneratedScript(target, script) {
  await installGeneratedAnyoTooling(target)
  return spawnSync(npmExecutable, ['run', script, '--silent'], { cwd: target, encoding: 'utf8' })
}

test('installed Anyo tooling resolves from an isolated generated project', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-tooling-'))
  try {
    await installGeneratedAnyoTooling(cwd)
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import * as anyo from '@blcklab/anyo';
      for (const name of ['inspectWorldDocument', 'resolveWorldDocumentImports', 'bundleWorldDocument', 'validateWorldDocument']) {
        assert.equal(typeof anyo[name], 'function', name);
      }
    `], { cwd, encoding: 'utf8' })
    assert.equal(run.status, 0, `${toolingError}\n${run.stderr || run.error || ''}`)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('scaffolds an exact OSM GitHub world with manifest-owned geography and no registry', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['black-lab', '--lat=14.556201', '--lng=121.024261', '--osm=way/9200000033', '--github=blcklab/black-lab', '--ref=v1.0.0'], { cwd, log() {} })
    const manifest = JSON.parse(await readFile(path.join(result.target, 'atlas.world.json'), 'utf8'))
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    const files = await readdir(result.target)
    assert.equal(manifest.schema, 'anyo-world-manifest@1')
    assert.equal(manifest.lotId, 'osm:way:9200000033')
    assert.deepEqual(manifest.location.osm, { provider: 'openstreetmap', type: 'way', id: '9200000033' })
    assert.equal(manifest.location.latitude, 14.556201)
    assert.equal(manifest.location.longitude, 121.024261)
    assert.equal(manifest.location.zoom, 20)
    assert.equal(manifest.placement.mapMatch, 'exact-building')
    assert.equal(manifest.placement.portal, true)
    const exterior = world.entities.find(entity => entity.id === 'map-exterior')
    assert.ok(exterior?.components?.some(component => component.type === 'anyo.mapExterior'))
    assert.ok(exterior.children.length >= 6)
    assert.ok(world.entities.some(entity => entity.components?.some(component => component.type === 'anyo.mapSpawn')))
    assert.ok(world.entities.some(entity => entity.components?.some(component => component.type === 'anyo.mapExit')))
    const exit = world.entities.find(entity => entity.id === 'map-interior-exit')
    assert.equal(exit.type, 'group')
    assert.ok(exit.children.some(child => child.id === 'map-exit-label' && child.text === 'E · EXIT'))
    assert.ok(exit.children.filter(child => child.type === 'box').every(child => child.collision === false))
    assert.deepEqual(world.data.atlas.entrance, { room: 'main', opening: 'entrance', targetSpawn: 'map-main-entrance', interactionDistance: 3.4, marker: 'none' })
    const authoredEntrance = world.building.floors[0].rooms[0].openings.find(opening => opening.id === world.data.atlas.entrance.opening)
    assert.equal(authoredEntrance.wall, 'south')
    assert.equal(authoredEntrance.offset, 'center')
    assert.equal(world.version, '0.9')
    assert.equal(world.$schema, 'https://anyo.blcklab.dev/schemas/world-0.9.schema.json')
    assert.equal(files.includes('registry-entry.json'), false)
    assert.equal(files.includes('registry'), false)
    const publicUrl = new URL(result.atlasUrl)
    assert.equal(publicUrl.searchParams.get('world'), 'blcklab/black-lab')
    assert.equal(publicUrl.searchParams.get('ref'), 'v1.0.0')
    assert.equal(publicUrl.searchParams.has('lat'), false)
    assert.equal(publicUrl.searchParams.has('lng'), false)
    assert.match(result.localAtlasUrl, /manifest=/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('coordinate-only starter keeps geography entirely in atlas.world.json', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['gallery', '--lat=14.5896', '--lng=120.9747'], { cwd, log() {} })
    const manifest = JSON.parse(await readFile(path.join(result.target, 'atlas.world.json'), 'utf8'))
    assert.equal(result.lotId, 'geo:14.589600:120.974700')
    assert.equal(manifest.location.latitude, 14.5896)
    assert.equal(manifest.location.longitude, 120.9747)
    assert.equal(manifest.location.osm, undefined)
    assert.equal(manifest.placement.mapMatch, 'coordinate-only')
    assert.equal(manifest.placement.maximumDistanceMeters, 120)
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    assert.ok(world.entities.find(entity => entity.id === 'map-exterior')?.components?.some(component => component.type === 'anyo.mapExterior'))
    assert.equal(result.atlasUrl, null)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated project validates without registry tooling', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['black-lab', '--lat=14.556201', '--lng=121.024261', '--github=blcklab/black-lab'], { cwd, log() {} })
    const run = await runGeneratedScript(result.target, 'validate')
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /Anyo World 0\.9 contract: PASS/)
    assert.match(run.stdout, /Local Atlas:/)
    const pkg = JSON.parse(await readFile(path.join(result.target, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['bundle', 'check', 'dev', 'validate'])
    assert.equal(pkg.devDependencies['@blcklab/anyo'], '0.11.0-rc.37')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})


test('generated bare repository URL intentionally omits ref so Atlas uses its main default', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['main-world', '--lat=14.5', '--lng=121.0', '--github=blcklab/main-world'], { cwd, log() {} })
    const url = new URL(result.atlasUrl)
    assert.equal(url.searchParams.get('world'), 'blcklab/main-world')
    assert.equal(url.searchParams.has('ref'), false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('CLI rejects repository identities and refs Atlas would reject', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    await assert.rejects(() => scaffold(['bad-owner', '--lat=14.5', '--lng=121.0', '--github=bad--owner/world'], { cwd, log() {} }), /owner/)
    await assert.rejects(() => scaffold(['bad-ref', '--lat=14.5', '--lng=121.0', '--github=blcklab/world', '--ref=feature/world'], { cwd, log() {} }), /ref/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated dev server honors --port=VALUE instead of hard-coding 4174', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  let child
  try {
    const result = await scaffold(['frontier', '--lat=14.556201', '--lng=121.024261'], { cwd, log() {} })
    const { createServer } = await import('node:http')
    const probe = createServer()
    await new Promise((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', resolve)
    })
    const address = probe.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise(resolve => probe.close(resolve))
    assert.ok(port > 0)

    const { spawn } = await import('node:child_process')
    child = spawn(process.execPath, ['scripts/dev.mjs', `--port=${port}`], {
      cwd: result.target,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })

    const deadline = Date.now() + 5000
    while (!stdout.includes(`:${port}/atlas.world.json`) && Date.now() < deadline) {
      if (child.exitCode !== null) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(child.exitCode, null, stderr)
    assert.match(stdout, new RegExp(`:${port}/atlas\\.world\\.json`))

    const response = await fetch(`http://127.0.0.1:${port}/atlas.world.json`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const manifest = await response.json()
    assert.equal(manifest.id, 'frontier')
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM')
    await rm(cwd, { recursive: true, force: true })
  }
})

test('generated dev server accepts --port VALUE and reports friendly EADDRINUSE errors', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['port-contract', '--lat=14.5', '--lng=121.0'], { cwd, log() {} })
    const source = await readFile(path.join(result.target, 'scripts/dev.mjs'), 'utf8')
    assert.match(source, /argument\.startsWith\(name \+ '='\)/)
    assert.match(source, /process\.argv\.indexOf\(name\)/)
    assert.match(source, /EADDRINUSE/)
    assert.doesNotMatch(source, /server\.listen\(4174/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('loader mode creates a standalone World Loader repository without geography', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['loader-room', '--mode=loader', '--github=blcklab/loader-room', '--ref=v1.2.3'], { cwd, log() {} })
    const files = await readdir(result.target)
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    assert.equal(result.mode, 'loader')
    assert.equal(result.manifest, null)
    assert.equal(result.lotId, null)
    assert.equal(files.includes('atlas.world.json'), false)
    assert.equal(result.worldLoaderRoute, '/blcklab/loader-room?ref=v1.2.3')
    assert.equal(world.data?.location, undefined)
    assert.equal(world.data?.atlas, undefined)
    assert.equal(world.entities.some(entity => entity.components?.some(component => component.type === 'anyo.mapSpawn')), false)
    assert.equal(world.entities.some(entity => entity.components?.some(component => component.type === 'anyo.mapExit')), false)
    const readme = await readFile(path.join(result.target, 'README.md'), 'utf8')
    assert.match(readme, /Anyo World Loader/)
    assert.match(readme, /\/blcklab\/loader-room\?ref=v1\.2\.3/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('both mode remains geographic and is directly loadable by World Loader', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['hybrid-world', '--mode=both', '--lat=14.55', '--lng=121.02', '--github=blcklab/hybrid-world'], { cwd, log() {} })
    const files = await readdir(result.target)
    assert.equal(result.mode, 'both')
    assert.equal(files.includes('atlas.world.json'), true)
    assert.equal(files.includes('world.anyo.json'), true)
    assert.equal(result.worldLoaderRoute, '/blcklab/hybrid-world')
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    assert.equal(world.data.location.latitude, 14.55)
    assert.ok(world.entities.some(entity => entity.components?.some(component => component.type === 'anyo.mapSpawn')))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('web surface scaffold creates an anyo-web-app manifest and matching world entity', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['research-room', '--mode=loader', '--github=blcklab/research-room', '--web-surface=research-dashboard', '--web-resolution=full-hd'], { cwd, log() {} })
    assert.deepEqual(result.webSurface, { id: 'research-dashboard', resolution: [1920, 1080] })
    const appRoot = path.join(result.target, 'web-surface', 'research-dashboard')
    const manifest = JSON.parse(await readFile(path.join(appRoot, 'web-surface.json'), 'utf8'))
    assert.equal(manifest.schema, 'anyo-web-app@1')
    assert.equal(manifest.id, 'research-dashboard')
    assert.equal(manifest.entry, './index.html')
    for (const file of ['index.html', 'style.css', 'app.js']) await readFile(path.join(appRoot, file), 'utf8')
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    const surface = world.entities.find(entity => entity.type === 'web-surface')
    assert.ok(surface)
    assert.deepEqual(surface.webSurface.source, { type: 'app', app: 'research-dashboard' })
    assert.deepEqual(surface.webSurface.presentation.resolution, [1920, 1080])
    assert.equal(surface.webSurface.fallback.image, './assets/web-surface-fallback.svg')
    assert.equal(surface.webSurface.framePolicy.mode, 'on-change')
    const html = await readFile(path.join(appRoot, 'index.html'), 'utf8')
    assert.match(html, /<link rel="stylesheet" href="\.\/style\.css">/)
    assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/)
    const readme = await readFile(path.join(result.target, 'README.md'), 'utf8')
    assert.match(readme, /1920×1080/)

    const bundle = await runGeneratedScript(result.target, 'bundle')
    assert.equal(bundle.status, 0, bundle.stderr)
    const bundled = JSON.parse(await readFile(path.join(result.target, 'dist', 'world.anyo.json'), 'utf8'))
    const bundledSurface = bundled.entities.find(entity => entity.type === 'web-surface')
    assert.equal(bundledSurface.webSurface.fallback.image, '../assets/web-surface-fallback.svg')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('bare --web-surface uses dashboard and defaults to HD without accidental DPR multiplication', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['dashboard-world', '--mode=loader', '--web-surface'], { cwd, log() {} })
    assert.deepEqual(result.webSurface, { id: 'dashboard', resolution: [1280, 720] })
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    const surface = world.entities.find(entity => entity.id === 'web/dashboard')
    assert.deepEqual(surface.webSurface.presentation.resolution, [1280, 720])
    assert.equal(surface.webSurface.presentation.devicePixelRatio, undefined)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated validation checks World Loader and Web Surface contracts', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['validated-web', '--mode=loader', '--web-surface=panel'], { cwd, log() {} })
    const run = await runGeneratedScript(result.target, 'validate')
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /Web Surface apps: PASS \(1\)/)
    assert.match(run.stdout, /Anyo World Loader contract: PASS/)

    const manifestPath = path.join(result.target, 'web-surface', 'panel', 'web-surface.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.entry = '../escape.html'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    const { spawnSync } = await import('node:child_process')
    const rejected = spawnSync(npmExecutable, ['run', 'validate', '--silent'], { cwd: result.target, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /entry must stay inside the app directory/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})


test('default starter is a simple single-file World 0.9 project and bundles through Anyo core', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['single-world', '--mode=loader'], { cwd, log() {} })
    assert.equal(result.authoring, 'single-file')
    const files = await readdir(result.target)
    assert.equal(files.includes('models'), false)
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    assert.equal(world.version, '0.9')
    assert.equal(world.imports, undefined)

    const validation = await runGeneratedScript(result.target, 'validate')
    assert.equal(validation.status, 0, validation.stderr)
    assert.match(validation.stdout, /Anyo World 0\.9 contract: PASS/)

    const bundle = await runGeneratedScript(result.target, 'bundle')
    assert.equal(bundle.status, 0, bundle.stderr)
    assert.match(bundle.stdout, /Anyo standalone bundle: PASS/)
    const bundled = JSON.parse(await readFile(path.join(result.target, 'dist', 'world.anyo.json'), 'utf8'))
    assert.equal(bundled.version, '0.9')
    assert.equal(bundled.imports, undefined)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('--modular scaffolds models/, validates Object 0.1 imports, and bundles deterministically', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['modular-world', '--mode=loader', '--modular'], { cwd, log() {} })
    assert.equal(result.authoring, 'modular')
    const world = JSON.parse(await readFile(path.join(result.target, 'world.anyo.json'), 'utf8'))
    const object = JSON.parse(await readFile(path.join(result.target, 'models', 'centerpiece.anyo.json'), 'utf8'))
    assert.deepEqual(world.imports, { centerpiece: { src: './models/centerpiece.anyo.json' } })
    assert.equal(world.entities.find(entity => entity.id === 'centerpiece').composition, 'centerpiece')
    assert.equal(object.kind, 'anyo-object')
    assert.equal(object.version, '0.1')
    assert.equal(object.root.type, 'group')

    const validation = await runGeneratedScript(result.target, 'validate')
    assert.equal(validation.status, 0, validation.stderr)
    assert.match(validation.stdout, /Anyo object imports: PASS \(1\)/)

    const first = await runGeneratedScript(result.target, 'bundle')
    assert.equal(first.status, 0, first.stderr)
    const firstText = await readFile(path.join(result.target, 'dist', 'world.anyo.json'), 'utf8')
    const second = await runGeneratedScript(result.target, 'bundle')
    assert.equal(second.status, 0, second.stderr)
    const secondText = await readFile(path.join(result.target, 'dist', 'world.anyo.json'), 'utf8')
    assert.equal(secondText, firstText)

    const bundled = JSON.parse(firstText)
    assert.equal(bundled.imports, undefined)
    assert.ok(bundled.compositions['centerpiece::root'])
    assert.equal(bundled.entities.find(entity => entity.id === 'centerpiece').composition, 'centerpiece::root')
    assert.doesNotMatch(firstText, /anyo-project:\/\//)
    assert.doesNotMatch(firstText, /file:\/\//)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated validation rejects an invalid imported native object through Anyo core', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['invalid-object-world', '--mode=loader', '--modular'], { cwd, log() {} })
    const objectPath = path.join(result.target, 'models', 'centerpiece.anyo.json')
    const object = JSON.parse(await readFile(objectPath, 'utf8'))
    object.root.type = 'box'
    await writeFile(objectPath, JSON.stringify(object, null, 2) + '\n')
    const validation = await runGeneratedScript(result.target, 'validate')
    assert.notEqual(validation.status, 0)
    assert.match(validation.stderr, /ANYO_OBJECT_ROOT_TYPE_INVALID/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated local document loader refuses network imports instead of fetching implicitly', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['local-only-world', '--mode=loader', '--modular'], { cwd, log() {} })
    const worldPath = path.join(result.target, 'world.anyo.json')
    const world = JSON.parse(await readFile(worldPath, 'utf8'))
    world.imports.centerpiece.src = 'https://example.com/centerpiece.anyo.json'
    await writeFile(worldPath, JSON.stringify(world, null, 2) + '\n')
    const validation = await runGeneratedScript(result.target, 'validate')
    assert.notEqual(validation.status, 0)
    assert.match(validation.stderr, /resolves local project imports only/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('loader mode rejects geography and web resolution requires a web surface', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    await assert.rejects(() => scaffold(['bad-loader', '--mode=loader', '--lat=14.5'], { cwd, log() {} }), /require --mode=atlas or --mode=both/)
    await assert.rejects(() => scaffold(['bad-web', '--mode=loader', '--web-resolution=1080p'], { cwd, log() {} }), /requires --web-surface/)
    await assert.rejects(() => scaffold(['bad-mode', '--mode=desktop'], { cwd, log() {} }), /--mode must be atlas, loader, or both/)
    await assert.rejects(() => scaffold(['bad-app', '--mode=loader', '--web-surface=../escape'], { cwd, log() {} }), /portable app id/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated dev server serves Web Surface MIME types', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  let child
  try {
    const result = await scaffold(['web-dev', '--mode=loader', '--web-surface=panel'], { cwd, log() {} })
    const { createServer } = await import('node:http')
    const probe = createServer()
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
    const address = probe.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await new Promise(resolve => probe.close(resolve))

    const { spawn } = await import('node:child_process')
    child = spawn(process.execPath, ['scripts/dev.mjs', `--port=${port}`], { cwd: result.target, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    const deadline = Date.now() + 5000
    while (!stdout.includes(`:${port}/world.anyo.json`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    assert.match(stdout, new RegExp(`:${port}/world\\.anyo\\.json`))

    const css = await fetch(`http://127.0.0.1:${port}/web-surface/panel/style.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') || '', /text\/css/)
    const js = await fetch(`http://127.0.0.1:${port}/web-surface/panel/app.js`)
    assert.match(js.headers.get('content-type') || '', /text\/javascript/)
    const svg = await fetch(`http://127.0.0.1:${port}/assets/web-surface-fallback.svg`)
    assert.match(svg.headers.get('content-type') || '', /image\/svg\+xml/)
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM')
    await rm(cwd, { recursive: true, force: true })
  }
})

test('project contract is additive and preserves the root runtime world boundary', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['project-contract', '--mode=loader'], { cwd, log() {} })
    const project = JSON.parse(await readFile(path.join(result.target, 'anyo.project.json'), 'utf8'))
    const files = await readdir(result.target)
    assert.deepEqual(project, {
      schema: 'anyo-project@1',
      id: 'project-contract',
      title: 'Project Contract',
      world: './world.anyo.json',
      directories: { assets: './assets/', webSurfaces: './web-surface/' },
    })
    assert.ok(files.includes('world.anyo.json'))
    assert.ok(files.includes('anyo.project.json'))
    assert.ok(files.includes('web-surface'))
    const gitignore = await readFile(path.join(result.target, '.gitignore'), 'utf8')
    assert.match(gitignore, /^\.anyo\/$/m)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('generated validation rejects project metadata that would break the canonical loader boundary', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['invalid-project', '--mode=loader'], { cwd, log() {} })
    const projectPath = path.join(result.target, 'anyo.project.json')
    const project = JSON.parse(await readFile(projectPath, 'utf8'))
    project.world = './world/world.anyo.json'
    await writeFile(projectPath, JSON.stringify(project, null, 2) + '\n')
    const run = await runGeneratedScript(result.target, 'validate')
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /world must be \.\/world\.anyo\.json/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('Web Surface contract accepts framework build output without declaring a framework', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    const result = await scaffold(['framework-agnostic', '--mode=loader', '--web-surface=panel'], { cwd, log() {} })
    const appRoot = path.join(result.target, 'web-surface', 'panel')
    const manifestPath = path.join(appRoot, 'web-surface.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.framework, undefined)
    assert.equal(manifest.build, undefined)
    await mkdir(path.join(appRoot, 'dist'), { recursive: true })
    await writeFile(path.join(appRoot, 'dist', 'index.html'), '<!doctype html><title>framework output</title>\n')
    manifest.entry = './dist/index.html'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    const run = await runGeneratedScript(result.target, 'validate')
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /Web Surface apps: PASS \(1\)/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})


test('rejects dot-only names and empty coordinates without writing a scaffold', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  try {
    await assert.rejects(() => scaffold(['..', '--mode=loader', '--force'], {cwd,log(){}}), /Project name/)
    await assert.rejects(() => scaffold(['empty-lat','--lat=','--lng=121'], {cwd,log(){}}), /Latitude/)
    assert.deepEqual(await readdir(cwd), [])
  } finally { await rm(cwd,{recursive:true,force:true}) }
})

test('dev server exposes root world and modular assets with correct Loader preview URL but blocks private paths and escaping symlinks', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-anyo-world-'))
  let child
  try {
    const result = await scaffold(['preview','--mode=loader','--modular','--web-surface=panel'],{cwd,log(){}})
    await writeFile(path.join(cwd,'outside.txt'),'private')
    await writeFile(path.join(result.target,'.env'),'private')
    if(process.platform !== 'win32') await symlink(path.join(cwd,'outside.txt'),path.join(result.target,'assets','outside.txt'))
    const { createServer }=await import('node:http')
    const probe=createServer()
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)})
    const port=probe.address().port
    await new Promise(resolve=>probe.close(resolve))
    const { spawn }=await import('node:child_process')
    child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{cwd:result.target,stdio:['ignore','pipe','pipe']})
    let stdout='', stderr=''
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)
    const deadline=Date.now()+5000
    while(!stdout.includes('World Loader preview') && Date.now()<deadline && child.exitCode===null) await new Promise(resolve=>setTimeout(resolve,25))
    assert.equal(child.exitCode,null,stderr)
    const url=new URL(stdout.match(/http:\/\/localhost:5173\/\?registryRoot=\S+/)[0])
    const root=url.searchParams.get('registryRoot')
    assert.equal(root,`http://127.0.0.1:${port}/`)
    const world=await (await fetch(root+'world.anyo.json')).json()
    assert.equal(world.version,'0.9')
    assert.equal((await fetch(root+'models/centerpiece.anyo.json')).status,200)
    assert.equal((await fetch(root+'web-surface/panel/index.html')).status,200)
    assert.equal((await fetch(root+'world.anyo.json',{method:'HEAD'})).status,200)
    assert.equal((await fetch(root+'world.anyo.json',{method:'OPTIONS'})).status,204)
    for(const file of ['.env','scripts/dev.mjs','node_modules/x','assets/outside.txt']) assert.equal((await fetch(root+file)).status,404)
    assert.equal((await fetch(root+'world.anyo.json',{method:'POST'})).status,405)
  } finally { if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))} await rm(cwd,{recursive:true,force:true}) }
})
