import {validId} from './saved-intent.js';
const key='e2-loan-return';
export function loanRoute(search){const source=new URLSearchParams(search),params=new URLSearchParams();for(const k of ['car','sales','application'])if(validId(source.get(k)))params.set(k,source.get(k));return 'my-e2.html'+(params.size?'?'+params:'')}
export function rememberLoan(search){try{sessionStorage.setItem(key,JSON.stringify({route:loanRoute(search),at:Date.now()}))}catch{}}
export function takeLoan(){try{const item=JSON.parse(sessionStorage.getItem(key));sessionStorage.removeItem(key);if(item&&Date.now()-item.at>=0&&Date.now()-item.at<1800000&&typeof item.route==='string'&&item.route===loanRoute(item.route.split('?')[1]||''))return item.route}catch{}return null}
