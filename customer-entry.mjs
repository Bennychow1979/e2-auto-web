import {setupCustomerLanguage,customerLanguage} from './customer-language.mjs?v=password6-20261125';
import {saveReturnURL,captureSave} from './saved-intent.js?v=whatsapp-public-20261126';
setupCustomerLanguage();
captureSave();
const phoneCopy={
 en:['Sign in / register with WhatsApp','Or use email below','Set / change WhatsApp account password'],
 ms:['Log masuk / daftar dengan WhatsApp','Atau gunakan e-mel di bawah','Tetapkan / tukar kata laluan akaun WhatsApp'],
 zh:['使用 WhatsApp 登录／注册','或在下方使用邮箱','设置／更改 WhatsApp 账号密码']
}[customerLanguage];
const phoneLink=document.getElementById('whatsappEntry');
phoneLink.textContent=phoneCopy[0];
document.getElementById('emailAlternative').textContent=phoneCopy[1];
const settingsLink=document.querySelector('#phonePasswordSettings a');settingsLink.textContent=phoneCopy[2];
function phoneURL(register=false){
 const url=new URL('customer-whatsapp.html',location.href);url.searchParams.set('lang',customerLanguage);
 if(register)url.searchParams.set('mode','register');
 return saveReturnURL(url.href);
}
settingsLink.href=phoneURL();
phoneLink.href=phoneURL(new URLSearchParams(location.search).get('mode')==='register');

// Capture the requested presentation before the existing account initializer
// removes auth/query parameters. Keep session and recovery behavior unchanged.
const registrationRequested=new URLSearchParams(location.search).get('mode')==='register';
await import('./customer.js?v=whatsapp-public-20261126');
if(registrationRequested&&!document.getElementById('customerAuth').hidden){
  document.getElementById('showRegister').click();
}

document.getElementById('showRegister').addEventListener('click',()=>phoneLink.href=phoneURL(true));
document.getElementById('showSignIn').addEventListener('click',()=>phoneLink.href=phoneURL());
