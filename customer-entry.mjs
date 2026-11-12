import {setupCustomerLanguage} from './customer-language.mjs';
setupCustomerLanguage();
// Capture the requested presentation before the existing account initializer
// removes auth/query parameters. Keep session and recovery behavior unchanged.
const registrationRequested=new URLSearchParams(location.search).get('mode')==='register';
await import('./customer.js?v=customer-language-20261112');
if(registrationRequested&&!document.getElementById('customerAuth').hidden){
  document.getElementById('showRegister').click();
}
