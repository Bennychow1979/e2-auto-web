// Preserve the album order and let uploaded images work during a Drive outage.
export async function resolvePhotoURLs(photos,{uploaded,drive}) {
  if(!photos.length)return [];
  const local=photos.filter(p=>p.source!=='drive'),linked=photos.filter(p=>p.source==='drive');
  const urls=new Map();
  const jobs=[];
  if(local.length)jobs.push(uploaded(local).then(items=>items.forEach((item,i)=>urls.set(local[i].id,item.signedUrl||null))));
  if(linked.length)jobs.push((async()=>{
    for(let start=0;start<linked.length;start+=100) {
      try {
        const items=await drive(linked.slice(start,start+100).map(p=>p.id));
        for(const item of items)urls.set(item.id,item.url||null);
      }catch{/* Show an unavailable tile without breaking the uploaded photos. */}
    }
  })());
  await Promise.all(jobs);
  return photos.map(photo=>({...photo,url:urls.get(photo.id)||null}));
}
