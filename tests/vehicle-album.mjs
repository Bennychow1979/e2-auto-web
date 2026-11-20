import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVehicleAlbum} from '../vehicle-album.mjs';
test('matching public cover is reused without signing or downloading a second identity',async()=>{
 const photos=[{id:'cover',position:0},{id:'other',position:1}],calls=[];
 const result=await resolveVehicleAlbum(photos,{cover:{id:'cover',url:'/public-cover'},resolve:async rows=>{calls.push(rows.map(p=>p.id));return rows.map(p=>({...p,url:'/signed-'+p.id}));}});
 assert.deepEqual(calls,[['other']]);assert.deepEqual(result.map(p=>p.url),['/public-cover','/signed-other']);assert.equal(result[0].position,0);
});
test('changed order, missing identity and explicit retry use fresh signed links',async()=>{
 for(const cover of [null,{url:'/old'},{id:'removed',url:'/old'}]){
  let called;const result=await resolveVehicleAlbum([{id:'new'}],{cover,resolve:async rows=>{called=rows;return rows.map(p=>({...p,url:'/fresh'}));}});
  assert.deepEqual(called,[{id:'new'}]);assert.equal(result[0].url,'/fresh');
 }
});
test('a single public cover requires no resolver; withdrawn photos never resurrect a cover',async()=>{
 const cover={id:'cover',url:'/public'},resolve=()=>{throw Error('Unexpected URL request');};
 assert.equal((await resolveVehicleAlbum([{id:'cover'}],{cover,resolve}))[0].url,'/public');
 assert.deepEqual(await resolveVehicleAlbum([],{cover,resolve}),[]);
});
