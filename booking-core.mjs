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

// Customer-initiated contact only. Opening this link neither sends nor verifies a message.
export function viewingWhatsAppLink(reference,lang='en'){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference||''))throw Error('Invalid viewing reference');
 const messages={en:`Hi E2 AUTO, I submitted a viewing request. My reference is ${reference}. Please use this WhatsApp number to contact me.`,ms:`Hai E2 AUTO, saya telah menghantar permintaan lawatan. Nombor rujukan saya ialah ${reference}. Sila hubungi saya melalui nombor WhatsApp ini.`,zh:`你好 E2 AUTO，我已提交看车预约。预约编号：${reference}。请通过这个 WhatsApp 号码联系我。`};
 return 'https://wa.me/60122785126?text='+encodeURIComponent(messages[lang]||messages.en);
}
