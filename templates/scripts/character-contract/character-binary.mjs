// Pure binary validators extracted verbatim from Loader M4; no renderer dependencies.
const MAX_MODEL_BYTES = 64 * 1024 * 1024
const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_CLIP_BYTES = 16 * 1024 * 1024
const MAX_JSON = 4 * 1024 * 1024

export function inspectAvatarBinary(bytes, format, embeddedClip) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > MAX_MODEL_BYTES) throw Error('Invalid avatar binary size.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==bytes.byteLength) throw Error('Expected a valid GLB v2 container.')
  let cursor=12, document=null, binLength=0, seenBin=false
  while (cursor<bytes.byteLength) {
    if (cursor+8>bytes.byteLength) throw Error('Truncated GLB chunk.')
    const size=view.getUint32(cursor,true), type=view.getUint32(cursor+4,true); cursor+=8
    if (size%4 || cursor+size>bytes.byteLength) throw Error('Invalid GLB chunk length.')
    if (document===null) {
      if (type!==0x4e4f534a || size>MAX_JSON_BYTES) throw Error('Invalid GLB JSON chunk.')
      document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor,cursor+size)))
    } else if(type===0x004e4942 && !seenBin) {seenBin=true;binLength=size}
    else throw Error('Unsupported GLB chunk.')
    cursor+=size
  }
  if (!document || document.asset?.version!=='2.0' || !Array.isArray(document.nodes) || !document.nodes.length || !Array.isArray(document.meshes) || !document.meshes.length) throw Error('Avatar must contain a glTF 2.0 mesh and nodes.')
  // No external or data-URI resources: embedded buffer views only. Also reject
  // URI-bearing extension data, rather than allowing a nested network request.
  const stack=[document]; let count=0
  while(stack.length) {
    const obj=stack.pop(); if(++count>300000)throw Error('Avatar metadata is too complex.')
    for(const [key,value] of Object.entries(obj)) {
      if(key.toLowerCase()==='uri')throw Error('Avatar must be self-contained; URI resources are unsupported.')
      if(value && typeof value==='object')stack.push(value)
    }
  }
  const buffers=document.buffers??[]
  if (!Array.isArray(buffers) || buffers.length!==1 || !seenBin || !Number.isInteger(buffers[0]?.byteLength) || buffers[0].byteLength<1 || buffers[0].byteLength>binLength) throw Error('Avatar must contain one embedded binary buffer.')
  if (!Array.isArray(document.images??[]) || (document.images??[]).some(image=>!Number.isInteger(image.bufferView) || !['image/png','image/jpeg','image/webp'].includes(image.mimeType)))throw Error('Avatar images must use embedded PNG/JPEG/WebP buffer views.')
  const vrm=document.extensions?.VRMC_vrm?'1.0':document.extensions?.VRM?'0.x':null
  if(format==='vrm' && !vrm)throw Error('VRM metadata is missing.')
  if(format==='glb' && vrm)throw Error('VRM avatars must use the .vrm format.')
  return {vrm, yawOffset:vrm==='1.0'?Math.PI:0, animations:(document.animations??[]).map(item=>item.name).filter(name=>typeof name==='string'), embeddedIndex: format==='glb' ? selectEmbeddedAnimation(document,embeddedClip) : null}
}

export function inspectWorldVrma(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length<28 || bytes.length>MAX_CLIP_BYTES) throw Error('Invalid VRMA binary size.')
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(v.getUint32(0,true)!==0x46546c67 || v.getUint32(4,true)!==2 || v.getUint32(8,true)!==bytes.length)throw Error('Expected GLB v2 VRMA container.')
  let pos=12, doc=null, bin=null
  while(pos<bytes.length){
    if(pos+8>bytes.length)throw Error('Truncated VRMA chunk.')
    const size=v.getUint32(pos,true),type=v.getUint32(pos+4,true);pos+=8
    if(size%4||pos+size>bytes.length)throw Error('Invalid VRMA chunk length.')
    if(doc===null){if(type!==0x4e4f534a||size>MAX_JSON)throw Error('Invalid VRMA JSON chunk.');doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos,pos+size)))}
    else if(type===0x004e4942&&bin===null)bin=size
    else throw Error('Unsupported VRMA chunk.')
    pos+=size
  }
  if(doc?.asset?.version!=='2.0'||!doc.extensions?.VRMC_vrm_animation?.humanoid||!Array.isArray(doc.animations)||!doc.animations.length)throw Error('VRMA humanoid animation metadata missing.')
  const stack=[doc];let count=0
  while(stack.length){const item=stack.pop();if(++count>300000)throw Error('VRMA metadata too complex.');for(const [key,value] of Object.entries(item)){if(key.toLowerCase()==='uri')throw Error('VRMA must be self-contained; URI resources are unsupported.');if(value&&typeof value==='object')stack.push(value)}}
  if(!Array.isArray(doc.buffers)||doc.buffers.length!==1||bin===null||!Number.isInteger(doc.buffers[0]?.byteLength)||doc.buffers[0].byteLength<1||doc.buffers[0].byteLength>bin)throw Error('VRMA must contain one embedded binary buffer.')
  return doc
}

export function selectEmbeddedAnimation(document, name) {
  if(!name)return null
  const matches=(document.animations??[]).map((clip,index)=>({clip,index})).filter(item=>item.clip.name===name)
  if(matches.length!==1)return null
  const {clip,index}=matches[0]
  const nodes=document.nodes??[]
  const parents=new Map();for(const [index,node] of nodes.entries())for(const child of node.children??[])parents.set(child,index)
  const roots=new Set([...(document.scenes??[]).flatMap(scene=>scene.nodes??[]),...nodes.map((_,index)=>index).filter(index=>!parents.has(index))])
  for(const skin of document.skins??[]){
    if(Number.isInteger(skin.skeleton))roots.add(skin.skeleton)
    const joints=new Set(skin.joints??[])
    for(const joint of joints)if(!joints.has(parents.get(joint)))roots.add(joint)
  }
  if(!Array.isArray(clip.channels)||!clip.channels.length||clip.channels.some(channel=>channel.target?.path==='translation'&&roots.has(channel.target.node)))return null
  return index
}
