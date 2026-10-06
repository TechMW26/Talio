import {getImage,getImageInfo} from '@/lib/mediaStorage'

// OCR reads only tenant-scoped private media or retained ImageKit references.
// No filesystem reads, arbitrary hosts, redirects or unbounded remote bodies.
export async function readProfileDocumentImage(document,databaseName){
 const url=String(document?.url||'')
 const mediaId=/^[a-f0-9]{24}$/i.test(document?.fileId||'')?document.fileId:/^\/api\/images\/([a-f0-9]{24})$/i.exec(url)?.[1]
 if(mediaId){const[buffer,info]=await Promise.all([getImage(mediaId,{databaseName}),getImageInfo(mediaId,{databaseName})]);return {base64:buffer.toString('base64'),mimeType:info?.contentType||'image/webp'}}
 let parsed
 try{parsed=new URL(url)}catch{throw new Error('This legacy document has no migrated media reference; please upload it again')}
 let trusted=parsed.protocol==='https:'&&parsed.hostname==='ik.imagekit.io'
 const endpoint=process.env.IMAGEKIT_URL_ENDPOINT||process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
 if(endpoint){try{const expected=new URL(endpoint);trusted=parsed.protocol==='https:'&&parsed.origin===expected.origin&&(parsed.pathname===expected.pathname||parsed.pathname.startsWith(expected.pathname.replace(/\/$/,'')+'/'))}catch{}}
 if(!trusted||parsed.username||parsed.password)throw new Error('Document image source is not an approved media provider')
 const response=await fetch(parsed.href,{redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!response.ok||!response.body)throw new Error('Document image could not be loaded')
 const mimeType=response.headers.get('content-type')?.split(';')[0]
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mimeType))throw new Error('Unsupported document image format')
 const maximum=10*1024*1024,reader=response.body.getReader(),chunks=[]
 let size=0
 try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new Error('Document image exceeds 10 MB')}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
 return {base64:Buffer.concat(chunks).toString('base64'),mimeType}
}
