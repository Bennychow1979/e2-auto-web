// Shared plain-text content. Job links require login and never accept on GET.
const kinds={puspakom:'PUSPAKOM',carsome_pickup:'Collect from Carsome / Carsome 取车',carro_pickup:'Collect from Carro / Carro 取车',send_invoice:'Send invoice / 送发票',workshop:'Workshop / 维修厂',delivery:'Delivery / 送车',other:'Other / 其他'};
const clean=v=>String(v??'').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,200);
export function jobLink(id){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw Error('Invalid job reference');
 return 'https://e2auto.my/operations.html?job='+id;
}
export function runnerMessage(job){
 const when=job.appointment_at?new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(job.appointment_at)):'To arrange / 待安排';
 return ['E2 AUTO · New job / 新任务','Runner: '+clean(job.runner_name),'Plate / 车牌: '+clean(job.plate),'Task / 任务: '+(kinds[job.kind]||clean(job.kind)),'From / 出发: '+clean(job.origin),'To / 目的地: '+clean(job.destination),'Appointment / 预约: '+when+' (Malaysia)', 'Please sign in, review and confirm acceptance. / 请登录查看并确认接单。',jobLink(job.id)].join('\n');
}
export function whatsappURL(phone,text){
 const digits=String(phone??'').replace(/^\+/,'');
 if(!/^[1-9]\d{7,14}$/.test(digits))throw Error('Verified international WhatsApp number required / 请先核实国际格式号码');
 return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
}
