// First-party, opt-in campaign measurement. No names, email, phone or auth tokens.
export const VERSION='2026-11-20', CHOICE='e2-measurement-choice-v1', STATE='e2-campaign-v1';
export const TTL=30*86400000, SESSION=30*60000;
export const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function campaignFromURL(href){
 try{const u=new URL(href),q=u.searchParams;
  const source=q.get('utm_source'),medium=q.get('utm_medium'),campaign=q.get('utm_campaign'),content=q.get('utm_content');
  if(source!=='threads'||medium!=='organic_social')return null;
  const images=['22_zh_jazz','23_ms_insight','24_en_civic','25_zh_register','26_ms_jazz','27_en_weekend','28_zh_preferences'];
  const videos=['22_wb7988d','23_vqn8730','24_vhm9399','25_bpn177','26_xx2988','27_wc7649y','28_jrx8921'];
  if(!(campaign==='honda_week'&&images.includes(content)||campaign==='reels_week'&&videos.includes(content)||campaign==='tracking_qa'&&content==='e2_tracking_smoke'))return null;
  const path=u.pathname;
  if(!/^\/(?:ms\/|zh\/)?(?:cars\/[a-z0-9-]+\/|used-cars\/[a-z0-9-]+\/|(?:showroom|customer|index)\.html)$/.test(path))return null;
  return {source,medium,campaign,content,path};
 }catch{return null}
}
export function readState(raw,now=Date.now()){
 try{const s=JSON.parse(raw);if(!s||!uuid(s.visitor)||!uuid(s.request)||!Number.isFinite(s.at)||s.at>now||now-s.at>=TTL||!campaignFromURL('https://e2auto.my'+s.path+'?'+new URLSearchParams({utm_source:s.source,utm_medium:s.medium,utm_campaign:s.campaign,utm_content:s.content})))return null;if(s.token&&!uuid(s.token))return null;return s}catch{return null}
}
export function nextState(previous,incoming,id,now=Date.now()){
 if(!incoming)return previous;
 if(previous&&previous.campaign===incoming.campaign&&previous.content===incoming.content&&now-previous.at<SESSION)return previous;
 return {...incoming,visitor:previous?.visitor||id(),request:id(),at:now,token:null};
}
export function readChoice(raw,now=Date.now()){try{const c=JSON.parse(raw);return c.version===VERSION&&typeof c.allowed==='boolean'&&c.at<=now&&now-c.at<TTL?c.allowed:null}catch{return null}}
