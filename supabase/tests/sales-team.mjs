import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicProfile, publicTeamSource, contactURL, profileFields} from '../../sales-team-data.mjs';
import {photoFrame, motionAllowed} from '../../sales-team-motion.mjs';
import {localizedURL, t} from '../../i18n.mjs';
import {localizedPage} from '../../scripts/build-languages.mjs';
import {teamContextURL} from '../../sales-team-navigation.mjs';
// Structural unit inputs only; never served by the preview. No fictional staff portraits or identities.
const id = '00000000-0000-4000-8000-000000000001';
const row = {user_id:id, display_name:'E2 AUTO', is_public:true, whatsapp:'60122785126', languages:'English', bio:'', position:'', photo_path:null};
test('only explicit public profiles are mapped; private fields never escape', () => {
  for (const bad of [null, {...row,is_public:false}, {...row,is_public:undefined}, {...row,user_id:'bad'}, {...row,display_name:' '}]) assert.equal(publicProfile(bad), null);
  const p = publicProfile({...row,email:'not exported',role:'not exported',photo_path:'../private.webp'});
  assert.deepEqual(Object.keys(p), ['id','name','position','bio','languages','phone','photo']); assert.equal(p.photo,'');
  assert(!profileFields.includes('email')); assert(!profileFields.includes('role'));
});
test('WhatsApp is exact country-code phone, absent or invalid means no link', () => {
  assert.equal(contactURL(publicProfile(row),'Hello & 您好'), 'https://wa.me/60122785126?text=Hello%20%26%20%E6%82%A8%E5%A5%BD');
  for (const phone of ['',null,'0123456789','javascript:alert(1)','+60122785126','6012/evil']) assert.equal(contactURL(publicProfile({...row,whatsapp:phone}),'Hi'),null);
});
test('anonymous source paginates, filters public rows and never inherits cookies or tokens', async () => {
  const requests=[];
  const source=publicTeamSource({supabaseUrl:'https://public-test.supabase.co',publishableKey:'sb_publishable_test'}, async (url,options) => {
    requests.push({url,options}); return {ok:true,json:async()=>requests.length===1?Array(100).fill(row):[{...row,is_public:false}]};
  });
  assert.equal((await source.profiles()).length,1); assert.equal(requests.length,2);
  for(const {url,options} of requests){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,undefined);assert.equal(new URL(url).searchParams.get('is_public'),'eq.true');}
  assert.equal(new URL(requests[1].url).searchParams.get('offset'),'100');
});
test('errors propagate instead of pretending an unavailable source is empty', async () => {
  await assert.rejects(publicTeamSource({},()=>{throw Error('must not call');}).profiles());
  await assert.rejects(publicTeamSource({supabaseUrl:'https://public-test.supabase.co',publishableKey:'sb_publishable_test'},async()=>({ok:false})).profiles());
});
test('portrait is restricted to its owner and signed URLs cannot redirect off-site',async()=>{
  assert.equal(publicProfile({...row,photo_path:'00000000-0000-4000-8000-000000000002/'+id+'.webp'}).photo,'');
  const p=publicProfile({...row,photo_path:id+'/'+id+'.webp'});assert(p.photo);
  const source=publicTeamSource({supabaseUrl:'https://public-test.supabase.co',publishableKey:'sb_publishable_test'},async()=>({ok:true,json:async()=>({signedURL:'https://other.example/photo'})}));
  await assert.rejects(source.portrait(p));assert.equal(await source.portrait(publicProfile(row)),null);
});
test('original nine-second cycle grows outward, fades and repeats for any supported team size',()=>{
  for(const count of [1,3,5,12])for(let index=0;index<count;index++){
    const a=photoFrame(index,count,1000,1100,520),b=photoFrame(index,count,10000,1100,520);
    for(const key of Object.keys(a))assert(Math.abs(a[key]-b[key])<1e-10);
    assert(a.opacity>=0&&a.opacity<=1);assert(a.scale>=.45&&a.scale<=1.15);
  }
  const a=photoFrame(0,3,0,390,470),b=photoFrame(0,3,1000,390,470);assert(b.scale>a.scale);assert(Math.abs(b.y)>Math.abs(a.y));
});
test('selected, hidden, reduced motion, keyboard and manual pause all stop animation',()=>{
  const state={count:3};assert(motionAllowed(state));
  for(const key of ['selected','hidden','reduced','keyboard','paused'])assert(!motionAllowed({...state,[key]:true}));
  assert(!motionAllowed({count:0}));assert(!motionAllowed({count:13}));
});
test('three-language routes preserve attribution and translate team UI',async()=>{
  const html=await readFile(new URL('../../sales-team.html',import.meta.url),'utf8');
  for(const lang of ['en','ms','zh']){
    const url=new URL(localizedURL('https://e2auto.my/sales-team.html?ref='+id+'#teamHeading',lang));
    assert.equal(url.searchParams.get('ref'),id);assert.equal(url.hash,'#teamHeading');
    if(lang!=='en'){
      const page=localizedPage(html,'sales-team.html',lang);
      assert(page.includes(t('Good cars. Great people.',{},lang)));assert(page.includes(t('Meet the team | E2 Auto',{},lang)));assert(page.includes('../sales-team.js'));
    }
  }
  assert(!html.includes('demoOnly'));assert(!html.includes('fixtures/'));assert(html.includes('customer-nav.js'));
});
test('team navigation carries existing referral context, never assigns the selected advisor',()=>{
  const base='https://e2auto.my/zh/sales-team.html?ref=E2TEST01&sales='+id;
  const destination=new URL(teamContextURL('index.html#cars',base));
  assert.equal(destination.searchParams.get('sales'),id);assert.equal(destination.searchParams.get('ref'),'E2TEST01');assert.equal(destination.hash,'#cars');
  assert.equal(teamContextURL('https://example.com/',base),'https://example.com/');
  assert.equal(teamContextURL('/customer.html',base),'https://e2auto.my/customer.html');
  assert(!teamContextURL('index.html','https://e2auto.my/sales-team.html?sales=bad').includes('sales='));
});
