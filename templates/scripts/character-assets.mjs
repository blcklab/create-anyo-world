// Generated-world tooling. Contract modules are exact snapshots from Loader M4.
import { lstat, realpath, readFile, mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { projectPath, validateProjectManifest } from './character-contract/project-manifest.mjs'
import { inspectAvatarBinary, inspectWorldVrma } from './character-contract/character-binary.mjs'
import { loadWorldCharacterCapability } from './character-contract/world-character-capability.mjs'

const ROOT_URL = 'https://anyo-project.invalid/'
const MAX_JSON = 1024 * 1024
const definitions = {
  avatars: { path: 'assets/avatars/avatars.json', value: {version:1,default:null,avatars:{}} },
  animations: { path:'assets/animations/animations.json', value:{version:4,clips:{},actions:{}} },
}
const record = x => x && typeof x === 'object' && !Array.isArray(x)
const json = x => JSON.stringify(x,null,2)+'\n'
const missing = async file => { try { await lstat(file); return false } catch(e) { if(e.code==='ENOENT')return true; throw e } }

function localPath(root, url) {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(ROOT_URL).origin || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Expected a local project asset URL.')
  const relative = decodeURIComponent(parsed.pathname.slice(1))
  const parts = relative.split('/')
  if (!relative || parts.some(s=>!s||s.startsWith('.')||s==='node_modules'||s.includes('\\')) || parts[0]==='scripts') throw Error(`Asset is not publicly served: ${relative}`)
  const candidate = path.resolve(root,relative)
  if(!candidate.startsWith(root+path.sep)) throw Error(`Asset escapes project: ${relative}`)
  return candidate
}
async function localFile(root, url, max) {
  const candidate = localPath(root,url)
  let actual
  try { actual = await realpath(candidate) } catch(e) { throw Error(`Missing project file: ${path.relative(root,candidate)}`,{cause:e}) }
  // Git repositories do not publish symlink target bytes as ordinary assets.
  if(actual!==candidate) throw Error(`Symlink or escaped asset is not portable: ${path.relative(root,candidate)}`)
  const info = await stat(actual)
  if(!info.isFile()||info.size<1||info.size>max) throw Error(`Invalid file size or type: ${path.relative(root,candidate)} (maximum ${max} bytes)`)
  return {actual,size:info.size}
}
async function readProject(root) {
  const {actual}=await localFile(root,new URL('anyo.project.json',ROOT_URL),MAX_JSON)
  return JSON.parse(await readFile(actual,'utf8'))
}
const projectUrl = p => new URL(projectPath(p).split('/').map(encodeURIComponent).join('/'),ROOT_URL).href

// Local authoring is intentionally stricter than runtime fallback: diagnostics fail validation.
export async function validateCharacterAssets(directory='.') {
  const root = await realpath(directory)
  return validateDeclaredAssets(root, await readProject(root))
}
async function validateDeclaredAssets(root, raw) {
  const declared = raw.capabilities
  if(declared===undefined) return {avatars:0,catalogs:0,clips:0,declared:false}
  if(!record(declared))throw Error('Invalid project capabilities.')
  if(!Object.hasOwn(declared,'avatars')&&!Object.hasOwn(declared,'animations'))return {avatars:0,catalogs:0,clips:0,declared:false}
  const project = validateProjectManifest(raw)
  const fetchImpl=async(url,{signal}={})=>{
    signal?.throwIfAborted()
    const {actual}=await localFile(root,url,MAX_JSON)
    const data=await readFile(actual,{signal})
    return new Response(data,{headers:{'content-length':String(data.byteLength)}})
  }
  const capability=await loadWorldCharacterCapability({project,rootUrl:ROOT_URL,worldUrl:projectUrl(project.world)},{fetchImpl})
  if(!capability||capability.diagnostics.length)throw Error(capability?.diagnostics.join('\n')||'Character discovery failed.')
  const avatars=Object.values(capability.avatarCatalog?.avatars??{})
  const catalogs=Object.values(capability.animationCatalogs)
  let clips=0
  for(const avatar of avatars){
    const {actual} = await localFile(root,avatar.src,64*1024*1024)
    try {
      const meta = inspectAvatarBinary(await readFile(actual),avatar.format,avatar.embeddedClip)
      if(avatar.embeddedClip&&meta.embeddedIndex===null)throw Error('Named embedded clip is missing, ambiguous or contains root translation.')
    } catch(error) { throw Error(`Avatar ${avatar.id}: ${error.message}`,{cause:error}) }
    if(avatar.thumbnail)await localFile(root,avatar.thumbnail,512*1024)
  }
  for(const catalog of catalogs){
    let bytes=0
    for(const clip of Object.values(catalog.clips)){
      const {size,actual}=await localFile(root,clip.src,16*1024*1024)
      bytes+=size;clips++
      if(bytes>64*1024*1024)throw Error('Animation catalog exceeds the 64 MiB attachment budget.')
      try { inspectWorldVrma(await readFile(actual)) } catch(error) { throw Error(`Animation ${clip.id}: ${error.message}`,{cause:error}) }
    }
  }
  return {avatars:avatars.length,catalogs:catalogs.length,clips,declared:true}
}

// Used by the future generator CLI and by already-scaffolded projects. No overwrite
// of existing catalogs, custom manifest paths or unrelated capabilities.
export async function scaffoldCharacterAssets(directory='.',{avatars=false,animations=false}={}){
  const root=await realpath(directory)
  const project=await readProject(root)
  if(project.schema!=='anyo-project@1'||project.world!=='./world.anyo.json')throw Error('Expected a canonical generated Anyo project.')
  if(project.capabilities!==undefined&&!record(project.capabilities))throw Error('Invalid project capabilities.')
  const requested=Object.entries({avatars,animations}).filter(([,enabled])=>enabled).map(([kind])=>kind)
  if(!requested.length)return {created:[],declared:[]}
  const capabilities={...project.capabilities};const pending=[]
  for(const kind of requested){
    if(Object.hasOwn(capabilities,kind)){
      // Preserve existing custom paths and data, but reject invalid declarations.
      const check=validateProjectManifest({...project,capabilities})
      if(check.invalidCharacterCapabilities?.includes(kind))throw Error(`Invalid existing ${kind} capability.`)
      await localFile(root,projectUrl(capabilities[kind].manifest),MAX_JSON)
      continue
    }
    const spec=definitions[kind];const candidate=localPath(root,projectUrl(spec.path));
    // Create only inside real, non-symlink directories.
    let parent=root
    for(const part of spec.path.split('/').slice(0,-1)){
      parent=path.join(parent,part)
      if(await missing(parent))await mkdir(parent)
      if(await realpath(parent)!==parent||!(await stat(parent)).isDirectory())throw Error(`Unsafe catalog directory: ${parent}`)
    }
    if(await missing(candidate))pending.push({candidate,spec})
    else await localFile(root,projectUrl(spec.path),MAX_JSON)
    capabilities[kind]={manifest:'./'+spec.path}
  }
  const created=[];let temp
  try{
    for(const {candidate,spec} of pending){await writeFile(candidate,json(spec.value),{flag:'wx'});created.push(candidate)}
    // Validate both new and existing requested declarations, even on a repeat run.
    await validateDeclaredAssets(root,{...project,capabilities})
    const target=path.join(root,'anyo.project.json')
    if(JSON.stringify(capabilities)!==JSON.stringify(project.capabilities)){
      temp=path.join(root,`.anyo.project.${randomUUID()}.tmp`)
      await writeFile(temp,json({...project,capabilities}),{flag:'wx'})
      await rename(temp,target);temp=undefined
    }
    return {created:created.map(p=>path.relative(root,p)),declared:requested}
  }catch(error){if(temp)await unlink(temp).catch(()=>{});for(const file of created)await unlink(file).catch(()=>{});throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2)
  try{
    if(args.some(a=>!['--avatars','--animations','--validate'].includes(a))||(!args.length))throw Error('Usage: node scripts/character-assets.mjs --avatars [--animations] | --validate')
    if(args.includes('--validate')&&(args.length!==1))throw Error('--validate must be used alone.')
    if(args.includes('--validate'))console.log('World character assets:',await validateCharacterAssets())
    else console.log('Character catalogs:',await scaffoldCharacterAssets('.',{avatars:args.includes('--avatars'),animations:args.includes('--animations')}))
  }catch(error){console.error(error.message);process.exitCode=1}
}
