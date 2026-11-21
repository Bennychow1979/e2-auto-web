import {calculateCarLoan} from './car-loan-core.mjs';
import {carLoanCopy} from './car-loan-copy.mjs';
const form=document.getElementById('cl-form');
if(form){
 const c=carLoanCopy[form.dataset.language]||carLoanCopy.en;
 const result=document.getElementById('cl-result'),error=document.getElementById('cl-error');
 const money=new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR',minimumFractionDigits:2,maximumFractionDigits:2});
 const fields=['price','deposit','rate','years'];
 function update(report=false){
  const values=Object.fromEntries(fields.map(name=>[name,name==='years'?Number(form.elements.namedItem(name).value):form.elements.namedItem(name).valueAsNumber]));
  // Clear stale results while a field is empty/invalid; never treat empty as zero.
  try{
   if(!fields.every(name=>form.elements.namedItem(name).validity.valid))throw Error('invalid');
   const estimate=calculateCarLoan(values);
   for(const key of ['monthly','principal','interest','repayment','total'])document.getElementById('cl-'+key).textContent=money.format(estimate[key]);
   document.getElementById('cl-months').textContent=estimate.months+' '+c.months;
   result.hidden=false;error.hidden=true;
  }catch{
   result.hidden=true;error.textContent=report?c.error:c.invalid;error.hidden=false;
  }
 }
 form.addEventListener('submit',event=>{event.preventDefault();update(true)});
 form.addEventListener('input',()=>update(false));
 form.addEventListener('change',()=>update(false));
 form.addEventListener('reset',()=>setTimeout(()=>update(false),0));
 update();
}
