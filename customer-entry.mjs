import {setupCustomerLanguage} from './customer-language.mjs?v=flow-20261113';
setupCustomerLanguage();
// Capture the requested presentation before the existing account initializer
// removes auth/query parameters. Keep session and recovery behavior unchanged.
const registrationRequested=new URLSearchParams(location.search).get('mode')==='register';
await import('./customer.js?v=flow-20261113');
if(registrationRequested&&!document.getElementById('customerAuth').hidden){
  document.getElementById('showRegister').click();
}
