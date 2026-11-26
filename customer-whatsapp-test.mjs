import {customerDB as db,check} from './customer-data.js?v=customer-1';
import {captureSave,saveReturnURL,bindSave} from './saved-intent.js?v=mail-save-20261119';
import {customerLanguage as language,accountURL,rememberCustomerLanguage} from './customer-language.mjs?v=password6-20261125';
import {normalizePhone,hasVerifiedContact} from './customer-phone-auth.mjs';
const texts={
 en:{title:'Sign in with WhatsApp',intro:'Limited test. Email sign-in remains available.',email:'Use email instead',login:'Sign in',register:'Create account',phone:'WhatsApp number',name:'Full name',consent:'I agree to the customer privacy notice.',privacy:'Read notice',existing:'Already registered by email? Use email to access your existing saved cars. Accounts are not automatically merged by phone number.',request:'Send verification code',code:'6-digit code',verify:'Verify and continue',change:'Change number / resend',signed:'You are signed in.',profile:'My profile',saved:'Saved cars',signout:'Sign out',sending:'Requesting your code…',sent:'Code requested. Check WhatsApp. Use the newest code within 5 minutes.',failed:'Could not request a code. Check your number and account option, wait, or use email. This test is limited to approved numbers.',invalid:'Enter a valid Malaysian mobile number.',wrong:'The code could not be verified. Check the newest code and try again, or request a new one.',wait:'Please wait 60 seconds between requests.',unavailable:'WhatsApp sign-in is unavailable. Please use email.',verifying:'Verifying…'},
 ms:{title:'Log masuk dengan WhatsApp',intro:'Ujian terhad. Log masuk melalui e-mel masih tersedia.',email:'Gunakan e-mel',login:'Log masuk',register:'Daftar akaun',phone:'Nombor WhatsApp',name:'Nama penuh',consent:'Saya bersetuju dengan notis privasi pelanggan.',privacy:'Baca notis',existing:'Sudah berdaftar melalui e-mel? Gunakan e-mel untuk melihat kereta simpanan anda. Akaun tidak digabungkan secara automatik berdasarkan nombor telefon.',request:'Hantar kod pengesahan',code:'Kod 6 digit',verify:'Sahkan dan teruskan',change:'Tukar nombor / hantar semula',signed:'Anda telah log masuk.',profile:'Profil saya',saved:'Kereta simpanan',signout:'Log keluar',sending:'Meminta kod…',sent:'Kod telah diminta. Semak WhatsApp. Gunakan kod terkini dalam 5 minit.',failed:'Kod tidak dapat diminta. Semak nombor dan pilihan akaun, tunggu atau gunakan e-mel. Ujian ini terhad kepada nombor yang dibenarkan.',invalid:'Masukkan nombor telefon bimbit Malaysia yang sah.',wrong:'Kod tidak dapat disahkan. Semak kod terkini atau minta kod baharu.',wait:'Sila tunggu 60 saat sebelum meminta semula.',unavailable:'Log masuk WhatsApp tidak tersedia. Sila gunakan e-mel.',verifying:'Mengesahkan…'},
 zh:{title:'使用 WhatsApp 登录',intro:'限指定号码测试，邮箱登录照常保留。',email:'改用邮箱',login:'登录',register:'注册账号',phone:'WhatsApp 手机号码',name:'姓名',consent:'我同意顾客隐私声明。',privacy:'阅读声明',existing:'已用邮箱注册？请用邮箱查看原有收藏。系统不会仅凭相同手机号自动合并账号。',request:'发送验证码',code:'6 位验证码',verify:'验证并继续',change:'修改号码／重新发送',signed:'已登录。',profile:'个人资料',saved:'已收藏车辆',signout:'退出登录',sending:'正在请求验证码…',sent:'已请求验证码，请查看 WhatsApp，并在 5 分钟内输入最新验证码。',failed:'暂时无法请求验证码。请核对号码及登录／注册选项，稍后重试或改用邮箱。测试仅限指定号码。',invalid:'请输入有效的马来西亚手机号码。',wrong:'验证码验证失败，请核对最新验证码或重新请求。',wait:'两次发送之间请等候 60 秒。',unavailable:'WhatsApp 登录暂时不可用，请改用邮箱。',verifying:'正在验证…'}
};
const passwordTexts={
 en:{passwordLogin:'Password sign-in',codeLogin:'Code sign-in',password:'Password',forgot:'Forgot / set password',resetHint:'Verify your WhatsApp number before setting a new password. This does not create a new account.',registerHint:'Verify your number, then set a password for future sign-ins.',setPassword:'Set your password',passwordHint:'At least 6 characters. Enter it only on this website.',newPassword:'New password',repeatPassword:'Confirm password',savePassword:'Save password',changePassword:'Set / change password',passwordMismatch:'Use at least 6 characters and enter the same password twice.',passwordFailed:'Could not sign in. Check your number and password, or use a verification code.',savingPassword:'Saving your password…',passwordSaveFailed:'Could not save your password. Try a different password, or verify your number again.',passwordSaved:'Password saved. Next time, sign in with your phone number and password.',verifyAgain:'Please verify your WhatsApp number again before setting a password.'},
 ms:{passwordLogin:'Guna kata laluan',codeLogin:'Guna kod',password:'Kata laluan',forgot:'Lupa / tetapkan kata laluan',resetHint:'Sahkan nombor WhatsApp sebelum menetapkan kata laluan baharu. Akaun baharu tidak akan dicipta.',registerHint:'Sahkan nombor, kemudian tetapkan kata laluan untuk log masuk seterusnya.',setPassword:'Tetapkan kata laluan',passwordHint:'Sekurang-kurangnya 6 aksara. Masukkan hanya di laman web ini.',newPassword:'Kata laluan baharu',repeatPassword:'Sahkan kata laluan',savePassword:'Simpan kata laluan',changePassword:'Tetapkan / tukar kata laluan',passwordMismatch:'Gunakan sekurang-kurangnya 6 aksara dan masukkan kata laluan yang sama dua kali.',passwordFailed:'Tidak dapat log masuk. Semak nombor dan kata laluan atau gunakan kod pengesahan.',savingPassword:'Menyimpan kata laluan…',passwordSaveFailed:'Kata laluan tidak dapat disimpan. Cuba kata laluan lain atau sahkan nombor semula.',passwordSaved:'Kata laluan disimpan. Selepas ini, log masuk dengan nombor telefon dan kata laluan.',verifyAgain:'Sahkan nombor WhatsApp sekali lagi sebelum menetapkan kata laluan.'},
 zh:{passwordLogin:'密码登录',codeLogin:'验证码登录',password:'密码',forgot:'忘记／设置密码',resetHint:'先验证 WhatsApp 号码，再设置新密码。不会建立新账号。',registerHint:'先验证手机号码，再设置密码，方便以后直接登录。',setPassword:'设置登录密码',passwordHint:'至少 6 个字符，只需在本网页输入。',newPassword:'新密码',repeatPassword:'再次输入密码',savePassword:'保存密码',changePassword:'设置／更改密码',passwordMismatch:'密码至少 6 个字符，两次输入必须相同。',passwordFailed:'登录失败，请检查号码和密码，或改用验证码登录。',savingPassword:'正在保存密码…',passwordSaveFailed:'密码保存失败，请尝试其他密码，或重新验证号码。',passwordSaved:'密码已保存。下次可使用手机号和密码登录。',verifyAgain:'请重新验证 WhatsApp 号码后再设置密码。'}
};
const copy={...(texts[language]||texts.en),...(passwordTexts[language]||passwordTexts.en)},$=id=>document.getElementById(id),request=$('otpRequest'),verify=$('otpVerify'),passwordLogin=$('phonePassword'),passwordSetup=$('setPhonePassword');
rememberCustomerLanguage(language);captureSave();
document.documentElement.lang=language==='zh'?'zh-Hans':language;
document.querySelectorAll('[data-copy]').forEach(el=>el.textContent=copy[el.dataset.copy]);
for(const [id,path] of [['emailLink','customer.html'],['privacyLink','customer-privacy.html'],['profileLink','customer.html'],['savedLink','saved.html']])$(id).href=saveReturnURL(accountURL(path));
let currentMode='password',busy=false,phone='',waitUntil=0,freshVerification=null,signedUser=null;
function note(key){$('otpStatus').textContent=copy[key]||key}
function lock(value){busy=value;document.querySelectorAll('input,button').forEach(el=>el.disabled=value)}
function mode(value){
 if(busy)return;currentMode=value;freshVerification=null;
 const create=value==='register';
 $('otpRegistration').hidden=!create;request.elements.full_name.required=create;request.elements.privacy.required=create;
 for(const [id,m] of [['passwordLogin','password'],['otpLogin','login'],['otpRegister','register']])$(id).setAttribute('aria-pressed',String(value===m));
 document.querySelector('.authTabs').hidden=false;$('otpSignedIn').hidden=true;
 request.hidden=value==='password';passwordLogin.hidden=value!=='password';verify.hidden=true;passwordSetup.hidden=true;
 phone='';verify.reset();passwordSetup.reset();passwordLogin.elements.password.value='';
 $('otpPurpose').textContent=value==='reset'?copy.resetHint:create?copy.registerHint:'';
 note('');
}
function showSignedIn(user){
 signedUser=user;freshVerification=null;
 for(const form of [request,verify,passwordLogin,passwordSetup])form.hidden=true;
 document.querySelector('.authTabs').hidden=true;$('otpSignedIn').hidden=false;
 $('changePhonePassword').hidden=!user.phone_confirmed_at||!user.phone;
}
async function allowedUser(result,expectedPhone){
 const user=result?.user;
 if(!result?.session||!hasVerifiedContact(user)||expectedPhone&&(!user.phone_confirmed_at||'+'+user.phone.replace(/^\+/,'')!==expectedPhone)||!check(await db.rpc('e2_customer_allowed'))){
  await db.auth.signOut({scope:'local'});throw Error('Unavailable');
 }
 return user;
}
function continueToProfile(user){bindSave(user.id);location.assign(saveReturnURL(accountURL('customer.html')))}
$('passwordLogin').onclick=()=>mode('password');$('otpLogin').onclick=()=>mode('login');$('otpRegister').onclick=()=>mode('register');
$('forgotPassword').onclick=()=>{const number=passwordLogin.elements.phone.value;mode('reset');request.elements.phone.value=number};
$('changePhonePassword').onclick=()=>{const number=signedUser?.phone||'';mode('reset');request.elements.phone.value=number?'+'+number.replace(/^\+/,''):''};
passwordLogin.onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 let number;try{number=normalizePhone(passwordLogin.elements.phone.value)}catch{note('invalid');return}
 lock(true);note('verifying');
 try{const result=check(await db.auth.signInWithPassword({phone:number,password:passwordLogin.elements.password.value}));continueToProfile(await allowedUser(result,number))}
 catch{note('passwordFailed')}finally{passwordLogin.elements.password.value='';lock(false)}
};
request.onsubmit=async e=>{
 e.preventDefault();if(busy)return;if(Date.now()<waitUntil){note('wait');return}
 try{phone=normalizePhone(request.elements.phone.value)}catch{note('invalid');return}
 const create=currentMode==='register';
 if(create&&(!request.elements.full_name.value.trim()||!request.elements.privacy.checked)){request.reportValidity();return}
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
  const user=await allowedUser(result,phone);
  verify.reset();
  if(currentMode==='register'||currentMode==='reset'){
   signedUser=user;freshVerification={id:user.id,phone,until:Date.now()+5*60*1000};
   verify.hidden=true;passwordSetup.hidden=false;document.querySelector('.authTabs').hidden=true;note('');passwordSetup.elements.password.focus();
  }else continueToProfile(user);
 }catch{verify.elements.code.value='';note('wrong')}finally{lock(false)}
};
$('otpChange').onclick=()=>{if(busy)return;phone='';verify.reset();verify.hidden=true;request.hidden=false;note('')};
passwordSetup.onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 if(!freshVerification||Date.now()>freshVerification.until){mode('reset');note('verifyAgain');return}
 const password=passwordSetup.elements.password.value;
 if(password.length<6||password.length>128||password!==passwordSetup.elements.confirm_password.value){note('passwordMismatch');return}
 lock(true);note('savingPassword');
 try{
  // A refreshed page or another account's session must not inherit this form's verification.
  const user=check(await db.auth.getUser()).user;
  if(user?.id!==freshVerification.id||!user.phone_confirmed_at||'+'+user.phone.replace(/^\+/,'')!==freshVerification.phone||!check(await db.rpc('e2_customer_allowed')))throw Error();
  const updated=check(await db.auth.updateUser({password})).user;
  if(updated?.id!==user.id)throw Error();
  bindSave(user.id);passwordSetup.reset();showSignedIn(updated);note('passwordSaved');
 }catch{passwordSetup.reset();note('passwordSaveFailed')}finally{lock(false)}
};
$('otpSignOut').onclick=async()=>{if(busy)return;lock(true);try{check(await db.auth.signOut({scope:'local'}));location.reload()}catch{note('unavailable');lock(false)}};
if(!db){lock(true);note('unavailable')}else{
 try{
  const session=check(await db.auth.getSession()).session;
  if(session){const user=check(await db.auth.getUser()).user;if(hasVerifiedContact(user)&&check(await db.rpc('e2_customer_allowed')))showSignedIn(user)}
  lock(false);
 }catch{lock(true);note('unavailable')}
}
