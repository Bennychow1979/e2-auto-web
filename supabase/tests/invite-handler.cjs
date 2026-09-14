const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('supabase/functions/e2-invite-user/index.ts','utf8').replace(/^\s*import [^\n]*\n/,'');
async function scenario({authorization='Bearer test-user-token',origin='https://e2auto.my',allowed=true,validUser=true,body={action:'invite',email:'new@example.com',role:'sales'},inviteError=null,memberError=null,members=[],existingUser=null,userError=null,limitError=null}={}){
 let handler,sends=0,attached=0;
 const caller={auth:{getUser:async()=>({data:{user:validUser?{id:'owner'}:null},error:null})},rpc:async(name)=>{if(name==='e2_is_super_admin')return{data:allowed};if(name==='e2_list_staff')return{data:members};if(name==='e2_check_invite')return{error:limitError};if(name==='e2_add_staff_by_email'){attached++;return{data:'new-user',error:memberError}};throw Error(name)}};
 const admin={auth:{admin:{getUserById:async()=>({data:{user:existingUser},error:userError}),inviteUserByEmail:async(email,opts)=>{sends++;assert.equal(opts.redirectTo,'https://e2auto.my/accept-invite.html');return{data:{user:{id:existingUser?.id||'new-user'}},error:inviteError}}}}};
 vm.runInNewContext(source,{Deno:{env:{get:key=>key},serve:fn=>handler=fn},createClient:(url,key)=>key==='SUPABASE_SERVICE_ROLE_KEY'?admin:caller,Response,Request,Set,JSON});
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{Origin:origin,...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body)}));
 return {status:response.status,body:await response.json(),sends,attached};
}
(async()=>{
let office=await scenario({body:{action:'invite',email:'office@example.test',role:'office_admin'}});assert.equal(office.status,200);assert.equal(office.attached,1);
let r=await scenario({authorization:''});assert.equal(r.status,401);assert.equal(r.sends,0);
r=await scenario({validUser:false});assert.equal(r.status,401);assert.equal(r.sends,0);
r=await scenario({allowed:false});assert.equal(r.status,403);assert.equal(r.sends,0);
r=await scenario({origin:'https://malicious.example'});assert.equal(r.status,403);assert.equal(r.sends,0);
r=await scenario({body:{action:'invite',email:'new@example.com',role:'root'}});assert.equal(r.status,400);assert.equal(r.sends,0);
r=await scenario({body:{action:'status'}});assert.equal(r.status,200);assert.equal(r.sends,0);
r=await scenario({members:[{email:'new@example.com'}]});assert.equal(r.status,409);assert.equal(r.sends,0);
r=await scenario({inviteError:{message:'SMTP failed'}});assert.equal(r.status,400);assert.equal(r.attached,0);
r=await scenario({memberError:{message:'Caller revoked'}});assert.equal(r.status,409);assert.match(r.body.error,/access was not assigned/);
r=await scenario();assert.equal(r.status,200);assert.equal(r.sends,1);assert.equal(r.attached,1);
const id='00000000-0000-4000-8000-000000000001',resend={action:'resend',user_id:id};
const member={user_id:id,email:'staff@example.test',active:true,role:'sales'};
const existing={id,email:'staff@example.test',email_confirmed_at:null};
r=await scenario({body:resend,allowed:false,members:[member],existingUser:existing});assert.equal(r.status,403);assert.equal(r.sends,0);
r=await scenario({body:{action:'resend',user_id:'bad'}});assert.equal(r.status,400);assert.equal(r.sends,0);
r=await scenario({body:resend});assert.equal(r.status,409);assert.equal(r.sends,0);
r=await scenario({body:resend,members:[{...member,active:false}],existingUser:existing});assert.equal(r.status,409);assert.equal(r.sends,0);
r=await scenario({body:resend,members:[member],existingUser:{...existing,email_confirmed_at:'2026-09-13'}});assert.equal(r.status,409);assert.equal(r.sends,0);
r=await scenario({body:resend,members:[member],existingUser:{...existing,email:'changed@example.test'}});assert.equal(r.status,409);assert.equal(r.sends,0);
r=await scenario({body:resend,members:[member],existingUser:existing,limitError:{message:'Rate limited'}});assert.equal(r.status,429);assert.equal(r.sends,0);
r=await scenario({body:resend,members:[member],existingUser:existing,inviteError:{status:429}});assert.equal(r.status,429);assert.equal(r.attached,0);
r=await scenario({body:{...resend,email:'attacker@example.test',role:'super_admin'},members:[member],existingUser:existing});assert.equal(r.status,200);assert.equal(r.sends,1);assert.equal(r.attached,0);assert.equal(r.body.email,member.email);assert.equal(r.body.resent,true);
console.log('19 invitation handler checks passed; no real email was sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
