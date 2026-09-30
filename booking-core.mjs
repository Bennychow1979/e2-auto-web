export const bookingStatuses=['Requested','Confirmed','Completed','Cancelled'];
export function malaysiaDate(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function dateLimit(now=new Date()){
  const day=new Date(malaysiaDate(now)+'T12:00:00+08:00');day.setUTCDate(day.getUTCDate()+90);return malaysiaDate(day);
}
export function viewingTimes(day,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||day<malaysiaDate(now)||day>dateLimit(now))return [];
  const parsed=new Date(day+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)return [];
  const sunday=parsed.getUTCDay()===0,result=[];
  for(let minute=sunday?600:570;minute<=(sunday?990:1080);minute+=30){
    const value=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    if(new Date(day+'T'+value+':00+08:00')>now)result.push(value);
  }
  return result;
}
export const bookingErrors={
  BOOKING_CONSENT:'Please agree to the viewing contact notice.',
  BOOKING_DETAILS:'Enter your name and a valid phone number.',
  BOOKING_PHONE:'Include your country code, for example +60.',
  BOOKING_TIME:'Choose a future date and time within the next 90 days.',
  BOOKING_REFERENCE:'The details have changed. Please submit again with a new reference.',
  BOOKING_VEHICLE:'This car is no longer available. Choose another car or a general showroom visit.',
  BOOKING_SALES:'This sales contact is unavailable. Remove the sales selection to contact the E2 team.',
  BOOKING_REFERRAL:'This referral is no longer active. You can continue without the referral.',
  BOOKING_LIMIT:'Too many requests. Please call E2 for help with your appointment.'
};
