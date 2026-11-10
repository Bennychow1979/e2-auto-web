// Capture the requested presentation before the existing account initializer
// removes auth/query parameters. Keep session and recovery behavior unchanged.
const registrationRequested=new URLSearchParams(location.search).get('mode')==='register';
await import('./customer.js?v=session-initialization-20261012');
if(registrationRequested&&!document.getElementById('customerAuth').hidden){
  document.getElementById('showRegister').click();
}
