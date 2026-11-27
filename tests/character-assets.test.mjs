import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, copyFile, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scaffoldCharacterAssets, validateCharacterAssets } from '../templates/scripts/character-assets.mjs'
const base={schema:'anyo-project@1',id:'test-world',title:'Test World',world:'./world.anyo.json',directories:{assets:'./assets/',webSurfaces:'./web-surface/'}}
const fixture=async(t,project=base)=>{const root=await mkdtemp(path.join(tmpdir(),'anyo-m5-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));await writeFile(path.join(root,'anyo.project.json'),JSON.stringify(project));return root}
const put=async(root,p,value)=>{const file=path.join(root,p);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));return file}
const read=async(root,p='anyo.project.json')=>JSON.parse(await readFile(path.join(root,p),'utf8'))
// Synthetic container fixtures for validation only (not playable render assets).
function binary(doc){const text=Buffer.from(JSON.stringify(doc));const j=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const b=Buffer.alloc(28+j.length+4);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(j.length,12);b.writeUInt32LE(0x4e4f534a,16);j.copy(b,20);b.writeUInt32LE(4,20+j.length);b.writeUInt32LE(0x004e4942,24+j.length);return b}
const model=binary({asset:{version:'2.0'},nodes:[{mesh:0}],meshes:[{primitives:[]}],buffers:[{byteLength:4}],extensions:{VRMC_vrm:{}}})
const motion=binary({asset:{version:'2.0'},buffers:[{byteLength:4}],extensions:{VRMC_vrm_animation:{humanoid:{}}},animations:[{}]})
const both={avatars:true,animations:true}
const avatar=(src='./pilot.vrm',animations)=>({version:1,default:'pilot',avatars:{pilot:{name:'Pilot',src,...(animations?{animations}:{})}}})
const anim=(src='./idle.vrma')=>({version:4,clips:{idle:{src,format:'vrma'}},actions:{idle:{clip:'idle',mode:'locomotion'}}})
test('legacy/no flags preserve original manifest byte-for-byte',async t=>{const root=await fixture(t);const before=await readFile(path.join(root,'anyo.project.json'));assert.deepEqual(await scaffoldCharacterAssets(root),{created:[],declared:[]});assert.equal((await validateCharacterAssets(root)).declared,false);assert.deepEqual(await readFile(path.join(root,'anyo.project.json')),before)})
for(const options of [{avatars:true},{animations:true},both])test('optional empty starter: '+JSON.stringify(options),async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,options);const result=await validateCharacterAssets(root);assert.equal(result.avatars,0);assert.equal(result.catalogs,options.animations?1:0);assert.equal(result.declared,true);assert.equal((await read(root)).world,base.world);assert.deepEqual((await scaffoldCharacterAssets(root,options)).created,[])})
test('preserve existing unrelated and custom declarations',async t=>{const root=await fixture(t,{...base,manifests:{atlas:'./atlas.world.json'},capabilities:{audio:{manifest:'./assets/audio.json'},avatars:{manifest:'./custom/people.json'}}});await put(root,'custom/people.json',{version:1,avatars:{}});await scaffoldCharacterAssets(root,both);const p=await read(root);assert.equal(p.capabilities.avatars.manifest,'./custom/people.json');assert.equal(p.capabilities.audio.manifest,'./assets/audio.json');assert.equal(p.manifests.atlas,'./atlas.world.json');assert.deepEqual(await read(root,'custom/people.json'),{version:1,avatars:{}})})
test('shared and per-avatar relative references resolve, catalog v1 also accepted',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/avatars/avatars.json',avatar('./pilot.vrm','../animations/custom/animations.json'));await put(root,'assets/avatars/pilot.vrm',model);await put(root,'assets/animations/animations.json',anim());await put(root,'assets/animations/idle.vrma',motion);await put(root,'assets/animations/custom/animations.json',{version:1,actions:{wave:'../idle.vrma'}});assert.deepEqual(await validateCharacterAssets(root),{avatars:1,catalogs:2,clips:2,declared:true})})
test('malformed existing catalog is not overwritten or declared',async t=>{const root=await fixture(t);await put(root,'assets/avatars/avatars.json','not json');await assert.rejects(scaffoldCharacterAssets(root,both),/Avatar catalog/);assert.equal(await readFile(path.join(root,'assets/avatars/avatars.json'),'utf8'),'not json');assert.equal((await read(root)).capabilities,undefined);await assert.rejects(readFile(path.join(root,'assets/animations/animations.json')), {code:'ENOENT'})})
test('missing model or thumbnail fails author validation',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/avatars/avatars.json',avatar());await assert.rejects(validateCharacterAssets(root),/Missing project file/);await put(root,'assets/avatars/pilot.vrm',model);const a=avatar();a.avatars.pilot.thumbnail='./pilot.png';await put(root,'assets/avatars/avatars.json',a);await assert.rejects(validateCharacterAssets(root),/pilot.png/)})
test('missing animation clip and unknown action fail',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/animations/animations.json',anim());await assert.rejects(validateCharacterAssets(root),/Missing project file/);const a=anim();a.actions.idle.clip='missing';await put(root,'assets/animations/animations.json',a);await assert.rejects(validateCharacterAssets(root),/unknown clip/)})
test('invalid default, unsafe path and GLB external animation rejected',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);for(const a of [{...avatar(),default:'missing'},avatar('../../../outside.vrm'),avatar('https://other.test/pilot.vrm'),avatar('./pilot.glb','../animations/animations.json')]){await put(root,'assets/avatars/avatars.json',a);await assert.rejects(validateCharacterAssets(root),/Avatar catalog/)}})
test('missing declared manifest, malformed declaration rejected',async t=>{const root=await fixture(t,{...base,capabilities:{avatars:{manifest:'./missing.json'}}});await assert.rejects(validateCharacterAssets(root),/Missing project file/);await put(root,'anyo.project.json',{...base,capabilities:{avatars:{manifest:'../bad.json'}}});await assert.rejects(validateCharacterAssets(root),/capability ignored/);await assert.rejects(scaffoldCharacterAssets(root,{avatars:true}),/Invalid existing/)} )
test('symlinked files refused when the OS permits creating them', async t => {
  const root = await fixture(t)
  const other = await fixture(t)
  await scaffoldCharacterAssets(root, both)
  await put(root, 'assets/avatars/avatars.json', avatar())
  const outside = await put(other, 'pilot.vrm', 'test')
  try {
    await symlink(outside, path.join(root, 'assets/avatars/pilot.vrm'), 'file')
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows file symlink creation requires Developer Mode or the appropriate privilege')
      return
    }
    throw error
  }
  await assert.rejects(validateCharacterAssets(root), /Symlink/)
})
test('symlinked directories (Windows junctions) refused', async t => {
  const root = await fixture(t)
  const other = await fixture(t)
  await put(other, 'pilot.vrm', 'test')
  // Junctions work for directory links on Windows without symlink privilege.
  await symlink(other, path.join(root, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(scaffoldCharacterAssets(root, both), /Unsafe catalog directory/)
})
test('private asset and oversized thumbnail rejected',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/avatars/avatars.json',avatar('../../scripts/pilot.vrm'));await put(root,'scripts/pilot.vrm','test');await assert.rejects(validateCharacterAssets(root),/not publicly served/);await put(root,'assets/avatars/pilot.vrm',model);const a=avatar();a.avatars.pilot.thumbnail='./pilot.png';await put(root,'assets/avatars/avatars.json',a);const thumb=await put(root,'assets/avatars/pilot.png','test');await truncate(thumb,512*1024+1);await assert.rejects(validateCharacterAssets(root),/Invalid file size/)})

test('invalid avatar and VRMA binary rejected',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/avatars/avatars.json',avatar());await put(root,'assets/avatars/pilot.vrm','fake');await assert.rejects(validateCharacterAssets(root),/Invalid avatar binary/);await put(root,'assets/avatars/pilot.vrm',model);await put(root,'assets/animations/animations.json',anim());await put(root,'assets/animations/idle.vrma','fake');await assert.rejects(validateCharacterAssets(root),/Invalid VRMA binary/)})

test('nullable populated catalog validates while missing and invalid defaults still fail',async t=>{const root=await fixture(t);await scaffoldCharacterAssets(root,both);await put(root,'assets/avatars/pilot.vrm',model);const a=avatar();a.default=null;await put(root,'assets/avatars/avatars.json',a);assert.equal((await validateCharacterAssets(root)).avatars,1);delete a.default;await put(root,'assets/avatars/avatars.json',a);await assert.rejects(validateCharacterAssets(root),/Avatar catalog/);a.default=false;await put(root,'assets/avatars/avatars.json',a);await assert.rejects(validateCharacterAssets(root),/Avatar catalog/)})
