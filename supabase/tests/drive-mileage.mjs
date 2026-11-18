import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectMileage,validateReading,recognizeMileage,runMileage,MILEAGE_MODEL} from '../functions/e2-vehicle-import/mileage.mjs';
const root='root_1234567890',folder={id:'folder_1234567890',name:'ABC123 HONDA CITY',mimeType:'application/vnd.google-apps.folder',parents:[root]},car={id:'car',plate:'ABC123',publication:'draft',lifecycle_state:'active',mileage_confirmed:false,updated_at:'2026-11-19T00:00:00Z'};
const photo={id:'photo_1234567890',name:'M.jpeg',mimeType:'image/jpeg',parents:[folder.id],size:20,md5Checksum:'a'.repeat(32),capabilities:{canDownload:true}};
test('only exact M image names; duplicate identical bytes accepted, conflicting M images rejected',()=>{
 assert.equal(selectMileage([{...photo,name:'m.PNG'}],folder.id).id,photo.id);
 assert.equal(selectMileage([{...photo,name:'M1.jpg'}],folder.id),null);
 assert.equal(selectMileage([photo,{...photo,id:'photo_2345678901'}],folder.id).md5Checksum,photo.md5Checksum);
 assert.throws(()=>selectMileage([photo,{...photo,id:'photo_2345678901',md5Checksum:'b'.repeat(32)}],folder.id),/Multiple/);
 assert.throws(()=>selectMileage([{...photo,parents:['elsewhere']}],folder.id),/inaccessible/);
});
test('readings require clear total odometer in km; no guesses, trips or mile conversion',()=>{
 const v={clear:true,display:'odometer',unit:'km',reading:105936,digits:'105936',digit_count:6};assert.equal(validateReading(v),105936);
 for(const patch of [{clear:false},{display:'trip'},{unit:'mile'},{reading:'105936'},{reading:105936.5},{reading:-1},{reading:1000000},{reading:null}])assert.equal(validateReading({...v,...patch}),null);
});
test('provider call has one image, pinned price model, bounded output, no retention or implicit retries',async()=>{
 let n=0;
 const result=await recognizeMileage(new Uint8Array([255,216,255]),'image/jpeg',{apiKey:'synthetic',request:async(url,opt)=>{
  n++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(opt.body);assert.equal(body.model,MILEAGE_MODEL);assert.equal(body.store,false);assert.equal(body.max_output_tokens,300);assert.equal(body.input[0].content.length,1);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({clear:true,display:'odometer',unit:'km',reading:105936,digits:'105936',digit_count:6})}]}],usage:{input_tokens:2000,output_tokens:40}});
 }});assert.equal(n,2);assert.equal(result.reading,105936);assert.equal(result.input_tokens,4000);assert.equal(result.verification.length,2);
 let failures=0;await assert.rejects(()=>recognizeMileage(new Uint8Array(),'image/jpeg',{apiKey:'test',request:async()=>{failures++;return new Response('',{status:429})}}));assert.equal(failures,1);
});
function fixture(){
 const f={cars:[car],prior:[],files:[photo],claims:0,reads:0,finishes:[],budget:false};
 f.drive={list:async id=>id===root?[folder]:f.files,metadata:async()=>folder,image:async()=>new Uint8Array([255,216,255])};
 f.store={inventory:async()=>f.cars,receipts:async()=>f.prior,claim:async()=>{f.claims++;return f.budget?{status:'budget'}:{status:'claimed',id:'claim'}},finish:async x=>{f.finishes.push(x);return {status:x.issue?'review':'applied',issue:x.issue}}};
 f.run=()=>runMileage({drive:f.drive,store:f.store,root,actor:'actor',recognize:async()=>{f.reads++;return {reading:105936}}});return f;
}
test('new or changed M only, with budget checked before paid call; published and confirmed never scanned',async()=>{
 const f=fixture();assert.equal((await f.run()).updated[0].mileage,105936);assert.equal(f.reads,1);
 f.prior=[{vehicle_id:'car',checksum:photo.md5Checksum}];await f.run();assert.equal(f.reads,1);
 f.files=[{...photo,id:'photo_9876543210'}];await f.run();assert.equal(f.reads,1,'Renaming/reuploading identical bytes does not charge');
 f.files=[{...photo,md5Checksum:'b'.repeat(32)}];await f.run();assert.equal(f.reads,2);
 f.budget=true;assert.equal((await f.run()).budget_paused,true);assert.equal(f.reads,2);
 f.cars=[{...car,publication:'published'},{...car,mileage_confirmed:true}];await f.run();assert.equal(f.reads,2);
});
test('photo changed during recognition is recorded for review, never applied',async()=>{
 const f=fixture();let calls=0;f.drive.list=async id=>{if(id===root)return [folder];calls++;return calls>=3?[{...photo,md5Checksum:'b'.repeat(32)}]:[photo]};
 const out=await f.run();assert.equal(out.updated.length,0);assert.equal(f.finishes[0].reading,null);assert.match(out.review[0].issue,/changed/);
});

test('independent reads reject a missing digit, unclear second pass and incorrect digit count',async()=>{
 const good={clear:true,display:'odometer',unit:'km',reading:91533,digits:'91533',digit_count:5};
 for(const bad of [{...good,reading:9533,digits:'9533',digit_count:4},{...good,clear:false},{...good,digit_count:4}]){
  let calls=0;const result=await recognizeMileage(new Uint8Array([255,216,255]),'image/jpeg',{apiKey:'test',request:async(_url,options)=>{
   assert.equal(JSON.parse(options.body).input.length,1,'No first-pass answer in second request');
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(++calls===1?good:bad)}]}]});
  }});assert.equal(calls,2);assert.equal(result.reading,null);
 }
 let calls=0;await recognizeMileage(new Uint8Array(),'image/jpeg',{apiKey:'test',request:async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...good,clear:false})}]}]});}});assert.equal(calls,1,'Unclear first pass does not spend on second');
});
