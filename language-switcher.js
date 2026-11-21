import {language,localizedURL} from './i18n.mjs?v=car-loan-20261121';
const links = document.querySelectorAll('[data-language]');
function update(){for(const link of links){
  const lang=link.dataset.language;
  link.href=localizedURL(location.href,lang);
  link.setAttribute('aria-current',lang===language?'page':'false');
}}
update();window.addEventListener('hashchange',update);

try{localStorage.setItem('e2-customer-language',language)}catch{}
