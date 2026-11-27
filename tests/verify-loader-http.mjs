// Run against a prepared generated world and the exact M4 Loader source.
// No model assets are distributed by this kit; use owned/cleared test fixtures.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const [worldDir,loaderDir]=process.argv.slice(2)
if(!worldDir||!loaderDir)throw Error('Usage: node tests/verify-loader-http.mjs WORLD_DIR LOADER_M4_DIR')
const {fetchRegistryWorld}=await import(pathToFileURL(resolve(loaderDir,'src/lib/registry-source.mjs')))
const {loadWorldCharacterCapability}=await import(pathToFileURL(resolve(loaderDir,'src/lib/world-character-capability.mjs')))
const {inspectAvatarBinary}=await import(pathToFileURL(resolve(loaderDir,'src/lib/world-avatar-runtime.mjs')))
const {inspectWorldVrma}=await import(pathToFileURL(resolve(loaderDir,'src/lib/world-animation-runtime.mjs')))
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const {port}=probe.address();await new Promise(r=>probe.close(r));
const root=`http://127.0.0.1:${port}/`
const child=spawn(process.execPath,['scripts/dev.mjs',`--port=${port}`],{cwd:resolve(worldDir),stdio:['ignore','pipe','inherit']})
const exited=once(child,'exit');try{
  let ready=false
  for(let i=0;i<60;i++){try{const r=await fetch(root+'anyo.project.json');if(r.ok){ready=true;break}}catch{};await new Promise(r=>setTimeout(r,50))}
  assert.ok(ready,'dev server unavailable')
  const result=await fetchRegistryWorld(root,{discoverProject:true})
  const cap=await loadWorldCharacterCapability(result)
  assert.ok(cap);assert.deepEqual(cap.diagnostics,[])
  const avatars=Object.values(cap.avatarCatalog?.avatars??{});let clips=0
  for(const avatar of avatars){const r=await fetch(avatar.src);assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('content-type'),'model/gltf-binary');inspectAvatarBinary(new Uint8Array(await r.arrayBuffer()),avatar.format,avatar.embeddedClip)}
  for(const catalog of Object.values(cap.animationCatalogs))for(const clip of Object.values(catalog.clips)){const r=await fetch(clip.src);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'model/gltf-binary');assert.equal(r.headers.get('access-control-allow-origin'),'*');inspectWorldVrma(new Uint8Array(await r.arrayBuffer()));clips++}
  assert.equal((await fetch(root+'scripts/character-assets.mjs')).status,404)
  assert.equal((await fetch(root+'world.anyo.json')).status,200)
  console.log(JSON.stringify({root,world:result.worldUrl,avatars:avatars.length,catalogs:Object.keys(cap.animationCatalogs).length,clips,verified:'M4 discovery + binary inspection over generated dev server'},null,2))
}finally{child.kill();await exited}
