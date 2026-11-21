import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ImageMagick,initializeImageMagick,MagickFormat,MagickColor} from '@imagemagick/magick-wasm';
import {createImageVariants,jpegDimensions} from '../supabase/functions/e2-drive-photos/image-variants.mjs';
import {convertImage} from '../supabase/functions/e2-drive-photos/convert-image.mjs';
await initializeImageMagick(await readFile(new URL('magick.wasm',import.meta.resolve('@imagemagick/magick-wasm'))));
const jpeg=ImageMagick.read(new MagickColor('#c4b580'),1200,900,img=>img.write(MagickFormat.Jpeg,data=>new Uint8Array(data)));
test('real JPEG converts to smaller uncropped WebP at supported widths',()=>{
 assert.deepEqual(jpegDimensions(jpeg),{width:1200,height:900});
 for(const width of [400,800,1280]){const bytes=convertImage(ImageMagick,MagickFormat,jpeg,width);assert(bytes.length<jpeg.length);ImageMagick.read(bytes,img=>{assert.equal(img.format,MagickFormat.WebP);assert.equal(img.width,Math.min(width,1200));assert.equal(img.height,img.width*3/4);});}
});
test('cache is bounded, expires, and separates checksums and sizes',async()=>{
 let loads=0,clock=0;const load=async()=>{loads++;return jpeg;};
 const variant=createImageVariants({convert:(b,w)=>convertImage(ImageMagick,MagickFormat,b,w),now:()=>clock,maxBytes:50000,ttl:10});
 const request={key:'car:photo:checksum1',width:400,mime:'image/jpeg',load};
 await variant(request);await variant(request);assert.equal(loads,1);
 await variant({...request,key:'car:photo:checksum2'});await variant({...request,width:800});assert.equal(loads,3);
 clock=11;await variant(request);assert.equal(loads,4);
 const tiny=createImageVariants({convert:async()=>new Uint8Array(50),maxBytes:60});
 await tiny({...request,key:'a'});await tiny({...request,key:'b'});await tiny({...request,key:'a'});assert.equal(loads,7);
});
test('unsupported bytes, excessive dimensions, and converter errors retain verified original',async()=>{
 const variant=createImageVariants({convert:()=>{throw Error('Conversion unavailable')}});
 const result=await variant({key:'fallback',width:800,mime:'image/jpeg',load:async()=>jpeg});assert.equal(result.mime,'image/jpeg');assert.deepEqual(result.bytes,jpeg);
 assert.equal(jpegDimensions(new Uint8Array([255,216,255,192,255,255])),null);
 await assert.rejects(variant({key:'bad',width:801}),/Invalid image width/);
});

test('full-size requests retain exact original bytes and never initialize conversion',async()=>{
 let conversions=0;const variant=createImageVariants({convert:()=>{conversions++;throw Error('Must not convert')}});
 const result=await variant({key:'full-size',width:1280,mime:'image/jpeg',load:async()=>jpeg});
 assert.equal(conversions,0);assert.equal(result.mime,'image/jpeg');assert.deepEqual(result.bytes,jpeg);
});

test('simultaneous requests share only image work and failed loads remain retryable',async()=>{
 let loads=0,release;
 const variant=createImageVariants({convert:()=>{throw Error('No full-size conversion')}});
 const request={key:'same-photo',width:1280,mime:'image/jpeg',load:()=>{loads++;return new Promise(resolve=>release=resolve);}};
 const waiting=Array.from({length:8},()=>variant(request));
 assert.equal(loads,1);release(jpeg);
 for(const result of await Promise.all(waiting))assert.deepEqual(result.bytes,jpeg);
 let failures=0;
 const fail={...request,key:'retry',load:async()=>{failures++;throw Error('Transient')}};
 const rejected=await Promise.allSettled(Array.from({length:8},()=>variant(fail)));
 assert.equal(failures,1);assert(rejected.every(r=>r.status==='rejected'));
 assert.deepEqual((await variant({...fail,load:async()=>jpeg})).bytes,jpeg);
});

test('colour profile survives metadata stripping without cropping or upscaling',()=>{
 const profile=new Uint8Array([1,2,3,4]),events=[];
 const img={width:1280,height:960,autoOrient(){events.push('orient')},resize(w,h){assert.equal(w,800);assert.equal(h,600)},getProfile(name){assert.equal(name,'icc');return {data:profile}},strip(){profile.fill(0);events.push('strip')},setProfile(name,data){assert.equal(name,'icc');assert.deepEqual([...data],[1,2,3,4]);events.push('profile')},write(format,callback){return callback(new Uint8Array([9]))}};
 convertImage({read:(_,callback)=>callback(img)},{WebP:'webp'},jpeg,800);
 assert.deepEqual(events,['orient','strip','profile']);
});
