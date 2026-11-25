// Display helpers only; authorization always also checks e2_customer_allowed().
export function hasVerifiedContact(user){return !!(user?.email_confirmed_at||user?.phone_confirmed_at)}
export function normalizePhone(value){
 const raw=String(value||'').trim();
 if(!/^(?:\+|00)?[0-9 ()-]+$/.test(raw))throw Error('Invalid phone');
 let digits=raw.replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 else if(digits.startsWith('0'))digits='60'+digits.slice(1);
 if(!/^601[0-9]{8,9}$/.test(digits))throw Error('Invalid Malaysian mobile');
 return '+'+digits;
}
