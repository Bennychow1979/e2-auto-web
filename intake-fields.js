import {sections as loanSections,visibleField} from './loan-fields.js';
export const sections=d=>loanSections(d).map(fields=>fields.map(s=>['email','g_email'].includes(s[0])?[s[0],s[1],'Optional / Tidak wajib',s[3],false]:s));
export const missing=d=>sections(d).map((fields,i)=>fields.some(([k,l,s,t,r])=>r&&visibleField(k,d)&&!String(d[k]??'').trim())?i:null).filter(i=>i!==null);
