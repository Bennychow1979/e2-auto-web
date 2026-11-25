import {customerDB as db,check} from './customer-data.js?v=customer-1';
import {captureSave,saveReturnURL,bindSave} from './saved-intent.js?v=mail-save-20261119';
import {customerLanguage as language,accountURL,rememberCustomerLanguage} from './customer-language.mjs?v=password6-20261125';
import {normalizePhone,hasVerifiedContact} from './customer-phone-auth.mjs';
const texts={
 en:{title:'Sign in with WhatsApp',intro:'Limited test. Email sign-in remains available.',email:'Use email instead',login:'Sign in',register:'Create account',phone:'WhatsApp number',name:'Full name',consent:'I agree to the customer privacy notice.',privacy:'Read notice',existing:'Already registered by email? Use email to access your existing saved cars. Accounts are not automatically merged by phone number.',request:'Send verification code',code:'6-digit code',verify:'Verify and continue',change:'Change number / resend',signed:'You are signed in.',profile:'My profile',saved:'Saved cars',signout:'Sign out',sending:'Requesting your code…',sent:'Code requested. Check WhatsApp. Use the newest code within 5 minutes.',failed:'Could not request a code. Check your number and account option, wait, or use email. This test is limited to approved numbers.',invalid:'Enter a valid Malaysian mobile number.',wrong:'The code could not be verified. Check the newest code and try again, or request a new one.',wait:'Please wait 60 seconds between requests.',unavailable:'WhatsApp sign-in is unavailable. Please use email.',verifying:'Verifying…'},
 ms:{title:'Log masuk dengan WhatsApp',intro:'Ujian terhad. Log masuk melalui e-mel masih tersedia.',email:'Gunakan e-mel',login:'Log masuk',register:'Daftar akaun',phone:'Nombor WhatsApp',name:'Nama penuh',consent:'Saya bersetuju dengan notis privasi pelanggan.',privacy:'Baca notis',existing:'Sudah berdaftar melalui e-mel? Gunakan e-mel untuk melihat kereta simpanan anda. Akaun tidak digabungkan secara automatik berdasarkan nombor telefon.',request:'Hantar kod pengesahan',code:'Kod 6 digit',verify:'Sahkan dan teruskan',change:'Tukar nombor / hantar semula',signed:'Anda telah log masuk.',profile:'Profil saya',saved:'Kereta simpanan',signout:'Log keluar',sending:'Meminta kod…',sent:'Kod telah diminta. Semak WhatsApp. Gunakan kod terkini dalam 5 minit.',failed:'Kod tidak dapat diminta. Semak nombor dan pilihan akaun, tunggu atau gunakan e-mel. Ujian ini terhad kepada nombor yang dibenarkan.',invalid:'Masukkan nombor telefon bimbit Malaysia yang sah.',wrong:'Kod tidak dapat disahkan. Semak kod terkini atau minta kod baharu.',wait:'Sila tunggu 60 saat sebelum meminta semula.',unavailable:'Log masuk WhatsApp tidak tersedia. Sila gunakan e-mel.',verifying:'Mengesahkan…'},
 zh:{title:'使用 WhatsApp 登录',intro:'限指定号码测试，邮箱登录照常保留。',email:'改用邮箱',login:'登录',register:'注册账号',phone:'WhatsApp 手机号码',name:'姓名',consent:'我同意顾客隐私声明。',privacy:'阅读声明',existing:'已用邮箱注册？请用邮箱查看原有收藏。系统不会仅凭相同手机号自动合并账号。',request:'发送验证码',code:'6 位验证码',verify:'验证并继续',change:'修改号码／重新发送',signed:'已登录。',profile:'个人资料',saved:'已收藏车辆',signout:'退出登录',sending:'正在请求验证码…',sent:'已请求验证码，请查看 WhatsApp，并在 5 分钟内输入最新验证码。',failed:'暂时无法请求验证码。请核对号码及登录／注册选项，稍后重试或改用邮箱。测试仅限指定号码。',invalid:'请输入有效的马来西亚手机号码。',wrong:'验证码验证失败，请核对最新验证码或重新请求。',wait:'两次发送之间请等候 60 秒。',unavailable:'WhatsApp 登录暂时不可用，请改用邮箱。',verifying:'正在验证…'}
};
const copy=texts[language]||texts.en,$=id=>document.getElementById(id),request=$('otpRequest'),verify=$('otpVerify');
rememberCustomerLanguage(language);captureSave();
document.documentElement.lang=language==='zh'?'zh-Hans':language;
document.querySelectorAll('[data-copy]').forEach(el=>el.textContent=copy[el.dataset.copy]);
for(const [id,path] of [['emailLink','customer.html'],['privacyLink','customer-privacy.html'],['profileLink','customer.html'],['savedLink','saved.html']])$(id).href=saveReturnURL(accountURL(path));
let create=false,busy=false,phone='',waitUntil=0;
function note(key){$('otpStatus').textContent=copy[key]||key}
function lock(value){busy=value;document.querySelectorAll('input,button').forEach(el=>el.disabled=value)}
function mode(value){if(busy)return;create=value;$('otpRegistration').hidden=!value;request.elements.full_name.required=value;request.elements.privacy.required=value;$('otpLogin').setAttribute('aria-pressed',String(!value));$('otpRegister').setAttribute('aria-pressed',String(value));request.hidden=false;verify.hidden=true;phone='';verify.reset();note('')}
$('otpLogin').onclick=()=>mode(false);$('otpRegister').onclick=()=>mode(true);
request.onsubmit=async e=>{
 e.preventDefault();if(busy)return;if(Date.now()<waitUntil){note('wait');return}
 try{phone=normalizePhone(request.elements.phone.value)}catch{note('invalid');return}
 if(create&&!request.elements.full_name.value.trim()){request.elements.full_name.focus();return}
 lock(true);note('sending');
 try{
  const options={shouldCreateUser:create};
  if(create)options.data={e2_customer_signup:true,full_name:request.elements.full_name.value.trim(),phone:phone.slice(1),privacy_version:'2026-09-13'};
  check(await db.auth.signInWithOtp({phone,options}));waitUntil=Date.now()+60000;
  request.hidden=true;verify.hidden=false;$('otpDestination').textContent=phone;note('sent');
 }catch{note('failed')}finally{lock(false)}
};
verify.onsubmit=async e=>{
 e.preventDefault();if(busy||!phone)return;lock(true);note('verifying');
 try{
  const result=check(await db.auth.verifyOtp({phone,token:verify.elements.code.value.trim(),type:'sms'}));
  if(!result.session||!hasVerifiedContact(result.user))throw Error();
  if(!check(await db.rpc('e2_customer_allowed')))throw Error();
  verify.reset();bindSave(result.user.id);location.assign(saveReturnURL(accountURL('customer.html')));
 }catch{verify.elements.code.value='';note('wrong')}finally{lock(false)}
};
$('otpChange').onclick=()=>{if(busy)return;phone='';verify.reset();verify.hidden=true;request.hidden=false;note('')};
$('otpSignOut').onclick=async()=>{if(busy)return;lock(true);try{check(await db.auth.signOut({scope:'local'}));location.reload()}catch{note('unavailable');lock(false)}};
if(!db){lock(true);note('unavailable')}else{
 try{
  const session=check(await db.auth.getSession()).session;
  if(session){const user=check(await db.auth.getUser()).user;if(hasVerifiedContact(user)&&check(await db.rpc('e2_customer_allowed'))){request.hidden=true;verify.hidden=true;$('otpSignedIn').hidden=false;document.querySelector('.authTabs').hidden=true}}
  lock(false);
 }catch{lock(true);note('unavailable')}
}
