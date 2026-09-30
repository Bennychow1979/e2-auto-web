import {language,localizedURL} from './i18n.mjs';
const links = document.querySelectorAll('[data-language]');
function update(){for(const link of links){
  const lang=link.dataset.language;
  link.href=localizedURL(location.href,lang);
  link.setAttribute('aria-current',lang===language?'page':'false');
}}
update();window.addEventListener('hashchange',update);
