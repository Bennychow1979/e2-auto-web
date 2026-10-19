// Options are conveniences for the owner, never lender requirements or defaults.
export const documentOptions = [
  ['ic_front','IC front / 身份证正面'], ['ic_back','IC back / 身份证背面'],
  ['driving_licence','Driving licence / 驾驶执照'], ['payslips','Payslips / 薪水单'],
  ['personal_bank','Personal bank statements / 个人银行流水'], ['epf','EPF statement / 公积金结单'],
  ['employment','Employment confirmation / 在职证明'], ['tax','Income tax documents / 所得税资料'],
  ['ssm','SSM business documents / 公司注册资料'], ['company_bank','Company bank statements / 公司银行流水'],
  ['financials','Business financial statements / 公司财务报表'], ['guarantor','Guarantor documents / 担保人资料'],
  ['vehicle','Vehicle documents / 车辆资料']
];
export function draftPayload(form) {
  const selected=[...new Set(form.getAll('document'))];
  if(selected.some(key=>!documentOptions.some(([id])=>id===key))) throw Error('Unknown document option.');
  const portal=String(form.get('portal')||'').trim(), email=String(form.get('email')||'').trim();
  if(portal){let url;try{url=new URL(portal)}catch{}if(!url||url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Portal must be an HTTPS URL without credentials or a fragment.');}
  if(email&&!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))throw Error('Enter one email recipient.');
  const number=name=>{const raw=String(form.get(name)||'').trim();if(!raw)return null;const value=Number(raw);if(!Number.isInteger(value)||value<1||value>50)throw Error('Use a whole number of years from 1 to 50.');return value;};
  return {portal_url:portal||null,email_to:email||null,required_documents:selected,
    document_notes:String(form.get('notes')||'').trim(),other_documents:String(form.get('other')||'').trim(),
    checklist_confirmed:form.has('confirmed'),blacklist_policy:String(form.get('blacklist')||'pending'),
    max_loan_years:number('maxYears'),max_vehicle_age_at_end:number('maxAge')};
}
export function maximumLoanYears(registrationYear,currentYear,termCap,ageCap){
 if(!Number.isInteger(registrationYear)||registrationYear<1900||registrationYear>currentYear||!Number.isInteger(currentYear))return null;
 if(!Number.isInteger(termCap)||!Number.isInteger(ageCap)||termCap<1||ageCap<1)return null;
 return Math.max(0,Math.min(termCap,ageCap-(currentYear-registrationYear)));
}
