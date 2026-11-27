// Repository-owned declarations, not permissions. No code is executed here.
export function projectPath(value, { directory = false } = {}) {
  if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid project path.')
  const relative = value.replace(/^\.\//, '')
  const path = directory ? relative.replace(/\/$/, '') : relative
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_. -]+$/.test(part))) {
    throw new Error('Project path must be relative and contained in its repository.')
  }
  return directory ? `${path}/` : path
}

export function validateProjectManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== 'anyo-project@1') throw new Error('Expected anyo-project@1.')
  const world = projectPath(raw.world ?? 'world.anyo.json')
  if (!world.endsWith('.json')) throw new Error('Project world must be JSON.')
  const directories = Object.freeze({
    assets: projectPath(raw.directories?.assets ?? 'assets/', { directory: true }),
    webSurfaces: projectPath(raw.directories?.webSurfaces ?? 'web-surface/', { directory: true }),
  })
  /** @type {{audio?: Readonly<{manifest: string}>, navigation?: Readonly<{manifest: string, app?: string, tours?: string, protocol?: string, launcher?: Readonly<{image?: string}>}>, webSurfaces?: Readonly<{directory: string}>, textures?: Readonly<{manifest:string}>, avatars?: Readonly<{manifest:string}>, animations?: Readonly<{manifest:string}>}} */
  const capabilities = {}
  const declared = raw.capabilities ?? {}
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) throw new Error('Invalid capabilities object.')
  for (const kind of ['audio', 'navigation']) {
    if (declared[kind] === undefined) continue
    const manifest = projectPath(declared[kind]?.manifest)
    if (!manifest.endsWith('.json')) throw new Error(`${kind} manifest must be JSON.`)
    if (kind === 'navigation') {
      const { app, tours, protocol, launcher } = declared[kind]
      if (app !== undefined && (typeof app !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(app))) throw new Error('Invalid navigation app ID.')
      if (protocol !== undefined && !['anyo-navigation@1','aeternum-navigation@1'].includes(protocol)) throw new Error('Invalid navigation protocol.')
      const tourPath = tours === undefined ? undefined : projectPath(tours)
      if (tourPath && !tourPath.endsWith('.json')) throw new Error('Tours manifest must be JSON.')
      let launch
      if (launcher !== undefined) {
        if (!app || !launcher || typeof launcher !== 'object' || Array.isArray(launcher)) throw new Error('Invalid navigation launcher.')
        const image = launcher.image === undefined ? undefined : projectPath(launcher.image)
        if (image && !/\.(png|webp|jpe?g)$/i.test(image)) throw new Error('Launcher image must be PNG, WebP or JPEG.')
        launch = Object.freeze(image ? {image} : {})
      }
      capabilities.navigation = Object.freeze({ manifest, ...(launch ? { launcher: launch } : {}), ...(app === undefined ? {} : { app }), ...(tourPath ? { tours: tourPath } : {}), ...(protocol ? { protocol } : {}) })
    } else capabilities.audio = Object.freeze({ manifest })
  }
  if (declared.textures !== undefined) {
    const manifest = projectPath(declared.textures?.manifest)
    if (!manifest.endsWith('.json')) throw new Error('Texture profile manifest must be JSON.')
    capabilities.textures = Object.freeze({manifest})
  }
  const capabilityDiagnostics = []
  const invalidCharacterCapabilities = []
  for (const kind of ['avatars', 'animations']) {
    if (declared[kind] === undefined) continue
    try {
      const spec = declared[kind]
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Expected capability object.')
      const manifest = projectPath(spec.manifest)
      if (!manifest.endsWith('.json')) throw new Error('Manifest must be JSON.')
      capabilities[kind] = Object.freeze({ manifest })
    } catch (error) {
      invalidCharacterCapabilities.push(kind)
      capabilityDiagnostics.push(`Optional ${kind} capability ignored: ${error.message}`)
    }
  }
  if (declared.webSurfaces !== undefined) capabilities.webSurfaces = Object.freeze({
    directory: projectPath(declared.webSurfaces?.directory, { directory: true }),
  })
  return Object.freeze({ schema: raw.schema, id: typeof raw.id === 'string' ? raw.id.slice(0,128) : '',
    title: typeof raw.title === 'string' ? raw.title.slice(0,256) : '', world, directories,
    capabilities: Object.freeze(capabilities), ...(capabilityDiagnostics.length ? { capabilityDiagnostics: Object.freeze(capabilityDiagnostics), invalidCharacterCapabilities: Object.freeze(invalidCharacterCapabilities) } : {}), unknownCapabilities: Object.freeze(Object.keys(declared).filter(key => !['audio','navigation','webSurfaces','textures','avatars','animations'].includes(key))) })
}

export async function readProjectManifest(rootUrl, options = {}) {
  const url = new URL('anyo.project.json', rootUrl).href
  try {
    const response = await (options.fetchImpl || fetch)(url, { signal: options.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })
    if ([400,404,410].includes(response.status)) return { project: null, diagnostics: [] }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (response.url && response.url !== url) throw new Error('Unexpected project manifest response URL.')
    const project = validateProjectManifest(await response.json())
    return { project, diagnostics: [...project.unknownCapabilities.map(name => `Unsupported project capability: ${name}`), ...(project.capabilityDiagnostics ?? [])] }
  } catch (error) {
    if (error?.name === 'AbortError' || options.signal?.aborted) throw error
    return { project: null, diagnostics: [`Optional anyo.project.json ignored: ${error instanceof Error ? error.message : String(error)}`] }
  }
}
