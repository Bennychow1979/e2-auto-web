import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFavourites} from '../../showroom-favourites.mjs';

function harness(overrides={}){
  const saved=new Set(),messages=[],auth=[],writes=[];
  const app=createFavourites({customer:async()=>({id:'customer'}),savedRows:async()=>[...saved].map(vehicle_id=>({vehicle_id})),setSaved:async(id,keep)=>{writes.push([id,keep]);if(keep)saved.add(id);else saved.delete(id);return keep},onChange:(_,message)=>{if(message)messages.push(message)},onAuthRequired:id=>auth.push(id),...overrides});
  return {app,saved,messages,auth,writes};
}
test('guest opens account reminder without saving',async()=>{
  const h=harness({customer:async()=>null});await h.app.toggle('car');
  assert.deepEqual(h.auth,['car']);assert.equal(h.writes.length,0);assert.equal(h.app.state().ids.size,0);
});
test('save and remove use current account records, including another tab',async()=>{
  const h=harness();await h.app.toggle('car');assert(h.app.state().ids.has('car'));
  h.saved.delete('car');await h.app.toggle('car');assert.deepEqual(h.writes,[['car',true],['car',true]]);
  await h.app.toggle('car');assert.equal(h.app.state().ids.size,0);assert.equal(h.messages.at(-1),'Removed from your saved cars.');
});
test('failed write never shows successful favourite state',async()=>{
  const h=harness({setSaved:async()=>{throw Error('Offline')}});await h.app.toggle('car');
  assert.equal(h.app.state().ids.size,0);assert.equal(h.app.state().busy,null);assert.deepEqual(h.messages,['Offline']);
});
test('rapid taps cannot duplicate an in-flight write',async()=>{
  let finish;const hold=new Promise(resolve=>finish=resolve);let writes=0;
  const h=harness({setSaved:async()=>{writes++;await hold;return true}});
  const first=h.app.toggle('car');await h.app.toggle('car');finish();await first;
  assert.equal(writes,1);assert(h.app.state().ids.has('car'));
});
test('sign-out discards a delayed saved-list response',async()=>{
  let finish;const h=harness({savedRows:()=>new Promise(resolve=>finish=resolve)});
  const read=h.app.refresh();await Promise.resolve();h.app.reset();finish([{vehicle_id:'private-car'}]);await read;
  assert.equal(h.app.state().ids.size,0);
});
test('sign-out during save never restores the previous account heart',async()=>{
  let finish,user={id:'customer'};const h=harness({customer:async()=>user,setSaved:()=>new Promise(resolve=>finish=resolve)});
  const write=h.app.toggle('car');await Promise.resolve();await Promise.resolve();
  user=null;h.app.reset();finish(true);await write;await Promise.resolve();
  assert.equal(h.app.state().ids.size,0);assert(!h.messages.includes('Saved to your account.'));
});
