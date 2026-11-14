import {localizedPage} from './build-languages.mjs';
import {categoryNavigation} from './build-discovery.mjs';
export function rootLinks(html,lang){
 const home='/'+(lang==='en'?'':lang+'/'),base='https://e2auto.my'+home+'index.html';
 return html.replace(/\b(href|src)="([^\"]*)"/g,(whole,attr,value)=>{
  if(!value||/^(?:[a-z]+:|\/)/i.test(value))return whole;
  if(value.startsWith('#'))return attr+'="'+home+(value==='#top'?'':value)+'"';
  const url=new URL(value.replace(/&amp;/g,'&'),base);
  return attr+'="'+(url.pathname+url.search+url.hash).replace(/&/g,'&amp;')+'"';
 });
}
export function publicPageShell(homepage,lang,paths,categories=[]){
 const shell=lang==='en'?homepage:localizedPage(homepage,'index.html',lang);
 const header=/<header\b[\s\S]*?<\/header>/.exec(shell)?.[0],footer=/<footer\b[\s\S]*?<\/footer>/.exec(shell)?.[0];
 if(!header||!footer)throw Error('Existing E2 page shell is required');
 const pageHeader=rootLinks(header,lang).replace(/<a ([^>]*data-language="(en|ms|zh)"[^>]*)>/g,(_,attrs,target)=>'<a '+attrs.replace(/href="[^\"]*"/,'href="'+paths[target]+'"')+'>');
 const pageFooter=rootLinks(footer,lang).replace('</footer>',()=>categoryNavigation(categories,lang,{footer:true})+'</footer>');
 const head=/<head>([\s\S]*?)<\/head>/.exec(shell)[1];
 const styles=(head.match(/<link rel="(?:stylesheet|icon|apple-touch-icon)"[^>]*>|<style>[\s\S]*?<\/style>/g)||[]).join('\n');
 return {header:pageHeader,footer:pageFooter,styles:rootLinks(styles,lang)};
}
