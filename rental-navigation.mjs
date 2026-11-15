// UI discovery only; rental and audit APIs independently enforce authorization.
export function setupRentalNavigation(db){
 const rental=[...document.querySelectorAll('[data-rental-link]')],audit=[...document.querySelectorAll('[data-rental-audit-link]')];
 let epoch=0,user=null,busy=false;
 const hide=()=>{for(const link of [...rental,...audit])link.hidden=true;};hide();
 async function refresh(){if(!user||busy)return;busy=true;const token=epoch;
  try{const [r,s]=await Promise.all([db.rpc('rental_ok'),db.rpc('e2_is_super_admin')]);if(token!==epoch)return;for(const link of rental)link.hidden=!!r.error||r.data!==true;for(const link of audit)link.hidden=!!s.error||s.data!==true;}catch{if(token===epoch)hide();}finally{busy=false;}
 }
 db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){epoch++;user=null;hide();return;}if(user!==session.user.id){epoch++;hide();}user=session.user.id;setTimeout(refresh,0);});
 window.addEventListener('focus',refresh);setInterval(refresh,15000);
}
