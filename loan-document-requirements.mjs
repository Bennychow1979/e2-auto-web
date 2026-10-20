import {checklist,documentCoverage} from './document-fields.js';
const labels={ic_front:'IC — front',ic_back:'IC — back',driving_license:'Driving licence',payslip:'Payslips / commission statements',bank_statement:'Personal bank statements',company_bank_statement:'Company bank statements',epf:'EPF statement',ssm:'SSM business documents',employment:'Employment confirmation',tax:'Income tax documents',financials:'Business financial statements',vehicle:'Vehicle documents',guarantor:'Guarantor documents'};
export function requirementItems(type,requirements){
 if(requirements?.status!=='selected')return checklist(type);
 return requirements.items.map(i=>{const includeCurrentMonth=['worker','commission'].includes(type)&&i.key==='bank_statement';return {...i,includeCurrentMonth,label:includeCurrentMonth?'Bank statements / transaction history':labels[i.key]||i.key,hint:i.months?(includeCurrentMonth?`Latest ${i.months} months including the month of checklist selection · show ${type==='commission'?'commission':'salary'} credited to your personal bank account`:`Latest ${i.months} completed months before checklist selection`):'Required by selected institution'}});
}
export function retainedItems(items,rows){return [...new Set(rows.filter(r=>!r.removed_at).map(r=>r.category))].filter(key=>!items.some(i=>i.key===key)).map(key=>({key,label:labels[key]||key,hint:'Previously uploaded · retained for reference',retained:true}));}
export function requirementSummary(items,rows,requirements){
 if(!items.length)return 'Choose the applicant type to see required uploads.';
 const date=requirements?.status==='selected'?new Date(requirements.selected_at):new Date();
 const missing=items.filter(i=>!documentCoverage(i,rows,date).complete);
 return missing.length?`Missing uploads: ${missing.map(i=>i.label).join(', ')}.`:'Required uploads received. Staff verification is still needed.';
}
export function requirementNotice(requirements){
 if(requirements?.status==='selected')return `Selected institution: ${requirements.institution}. These are this application's saved requirements. Uploaded files still need staff verification; this is not loan approval.`;
 if(requirements?.status==='review_required')return `Institution requirements need staff review (${requirements.institution}). Showing the general applicant checklist; institution compliance is not confirmed.`;
 return 'General applicant checklist. An employee will select a confirmed institution. Uploading these files does not confirm that institution requirements have been met.';
}
