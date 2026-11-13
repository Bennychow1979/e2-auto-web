import {escapeHTML as e,LANGUAGES,languageTags,t} from '../i18n.mjs';
import {vehiclePath} from '../vehicle-routes.mjs';
import {budgets,categoryMatches,categoryPath,relatedAvailable,modelSlug} from '../vehicle-discovery.mjs';
import {publicVehicleImageURL} from '../vehicle-public-image.mjs';
const origin='https://e2auto.my',json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
const money=v=>'RM'+Number(v).toLocaleString('en-MY',{maximumFractionDigits:0});
const name=v=>[v.year,v.brand,v.model,v.variant].filter(Boolean).join(' ');
const home=lang=>'/'+(lang==='en'?'':lang+'/');
const copy={
 en:{browse:'Browse used cars',brands:'By brand',models:'By model',budget:'By budget',empty:'Temporarily out of stock',ask:'Ask about this car',intro:'Browse current used-car availability at E2 Auto in Batu Caves, serving Kuala Lumpur and Selangor.',visit:'See the listed prices and vehicle details, then contact our team to confirm availability and arrange a viewing.',none:'There are no available vehicles in this category at the moment. Explore similar cars below or ask our team about upcoming stock.',related:'Available cars of the same model or a similar price',all:'View all available cars',book:'Arrange a viewing',model:'Explore this model',updated:'Published inventory — please confirm availability with E2.'},
 ms:{browse:'Cari kereta terpakai',brands:'Mengikut jenama',models:'Mengikut model',budget:'Mengikut bajet',empty:'Stok sementara habis',ask:'Tanya tentang kereta ini',intro:'Semak stok kereta terpakai semasa di E2 Auto, Batu Caves, untuk pelanggan Kuala Lumpur dan Selangor.',visit:'Lihat harga dan butiran kenderaan, kemudian hubungi pasukan kami untuk mengesahkan stok dan mengatur sesi melihat kereta.',none:'Tiada kenderaan tersedia dalam kategori ini buat masa ini. Lihat pilihan serupa di bawah atau tanya pasukan kami tentang stok akan datang.',related:'Kereta tersedia dengan model sama atau harga hampir sama',all:'Lihat semua kereta tersedia',book:'Atur sesi melihat kereta',model:'Lihat model ini',updated:'Stok yang diterbitkan — sila sahkan ketersediaan dengan E2.'},
 zh:{browse:'浏览二手车',brands:'按品牌',models:'按车款',budget:'按预算',empty:'暂时没货',ask:'咨询此车款',intro:'查看 E2 Auto Batu Caves 的二手车库存，服务吉隆坡与雪兰莪客户。',visit:'浏览售价和车辆资料，再联系我们确认库存并预约看车。',none:'这个分类目前没有在售车辆。可浏览下方相近车辆，或通过 WhatsApp 询问即将到店的库存。',related:'同款／相近价位的在售车',all:'查看全部在售车',book:'预约看车',model:'浏览此车款',updated:'已发布库存，请向 E2 确认最新供应情况。'},
};
export function discoveryCards(rows,lang,slugs,{imageOrigin,imageIDs=new Set(),compact=false}={}){
 return rows.map(car=>{
  const label=name(car)+' · '+money(car.price),url=vehiclePath(car.id,lang,slugs);
  const img=imageOrigin&&imageIDs.has(car.id)?'<img src="'+e(publicVehicleImageURL(imageOrigin,car.id))+'" alt="'+e(name(car))+'" loading="lazy">':'';
  if(compact)return '<a class="relatedCard" href="'+e(url)+'">'+img+'<small>'+e(t('Available',{},lang))+'</small><h3>'+e(name(car))+'</h3><p>'+e(money(car.price))+' ↗</p></a>';
  return '<article class="sampleRow">'+(img||'<span class="noPhoto">'+e(t('Photo unavailable',{},lang))+'</span>')+'<div class="sampleInfo"><span class="sampleLabel">'+e(car.plate||'')+' · '+e(t('Available',{},lang))+'</span><h3>'+e(car.brand+' '+car.model)+'</h3><span class="sampleMeta">'+e([car.year,car.variant,t(car.transmission,{},lang)].filter(Boolean).join(' · '))+'</span></div><span class="rowMoney">'+e(money(car.price))+'<small>'+e(t('Selling price',{},lang))+'</small></span><span class="rowGo" aria-hidden="true">↗</span><a class="rowVehicleLink" href="'+e(url)+'"><span class="srOnly">'+e(label)+'</span></a></article>';
 }).join('\n');
}
export function categoryNavigation(categories,lang,{footer=false}={}){
 const c=copy[lang];
 const link=v=>'<a href="'+categoryPath(v.slug,lang)+'">'+e(v.kind==='budget'?t(v.label,{},lang):v.label)+'</a>';
 const budgetLinks=budgets.map(b=>categories.find(v=>v.kind==='budget'&&v.slug===b.slug)).filter(Boolean);
 if(footer){
  const brands=['honda','toyota','proton','perodua'].map(slug=>categories.find(v=>v.kind==='brand'&&v.slug===slug)).filter(Boolean);
  return '<nav class="discoveryFooter" aria-label="'+e(c.browse)+'">'+[...brands,...budgetLinks].map(link).join('\n')+'</nav>';
 }
 return '<nav class="discoveryNav" aria-label="'+e(c.browse)+'"><h2>'+e(c.browse)+'</h2><div class="discoveryGroups">'+['brand','budget','model'].map(kind=>'<details><summary>'+e(c[{brand:'brands',model:'models',budget:'budget'}[kind]])+'</summary><div>'+(kind==='budget'?budgetLinks:categories.filter(v=>v.kind===kind)).map(link).join('\n')+'</div></details>').join('')+'</div></nav>';
}
export function renderListing(template,rows,lang,slugs,categories,options={}){
 const available=rows.filter(v=>v.stock_status==='Available');
 return template.replace('<div id="filterResults"></div>',()=>'<div id="filterResults">\n'+discoveryCards(available,lang,slugs,options)+'\n</div>')
  .replace(/(<div id="publicState"[^>]*>)[^<]*<\/div>/,(_,open)=>open+e(copy[lang].updated)+'</div>')
  .replace(/(<p id="resultCount"[^>]*>)[\s\S]*?<\/p>/,(_,open)=>open+e(t('{count} cars to explore',{count:available.length},lang))+'</p>')
  .replace('<form class="searchToolbar"',()=>categoryNavigation(categories,lang)+'<form class="searchToolbar"')
  .replace('</footer>',()=>categoryNavigation(categories,lang,{footer:true})+'</footer>');
}
export function categoryMetadata(category,lang){
 const label=category.kind==='budget'?t(category.label,{},lang):category.label;
 const subject=category.kind==='budget'?({en:'Used cars '+label,ms:'Kereta terpakai '+label,zh:label+'二手车'}[lang]):({en:'Used '+label+' for Sale',ms:label+' Terpakai Dijual',zh:'二手 '+label+' 出售'}[lang]);
 const h1=subject+({en:' in KL & Selangor',ms:' di KL & Selangor',zh:'｜吉隆坡 雪兰莪'}[lang]);
 const description=h1+'. '+copy[lang].intro+' '+copy[lang].visit;
 return {title:h1+({zh:'｜E2 Auto Batu Caves'}[lang]||' | E2 Auto Batu Caves'),h1,description};
}
export function renderCategory(category,rows,lang,slugs,categories,options={}){
 const c=copy[lang],meta=categoryMetadata(category,lang),path=categoryPath(category.slug,lang),matches=rows.filter(v=>categoryMatches(v,category));
 const comparable={id:'',brand:category.brand||'',model:category.model||'',price:category.kind==='budget'?({ 'under-rm30000':20000,'rm30000-50000':40000,'rm50000-80000':65000,'above-rm80000':90000}[category.slug]):40000};
 const related=matches.length?[]:relatedAvailable(comparable,rows,6);
 const message=({en:'Hi E2 Auto, I am looking for ',ms:'Hai E2 Auto, saya mencari ',zh:'你好 E2 Auto，我想询问 '}[lang])+meta.h1;
 const breadcrumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'E2 Auto',item:origin+home(lang)},{'@type':'ListItem',position:2,name:meta.h1,item:origin+path}]};
 return '<!doctype html><html lang="'+(lang==='zh'?'zh-Hans':lang)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(meta.title)+'</title><meta name="description" content="'+e(meta.description)+'"><link rel="canonical" href="'+origin+path+'">'+LANGUAGES.concat('x-default').map(l=>'<link rel="alternate" hreflang="'+(languageTags[l]||l)+'" href="'+origin+categoryPath(category.slug,l==='x-default'?'en':l)+'">').join('')+'<link rel="stylesheet" href="/discovery.css?v=nav-20261113"><script type="application/ld+json">'+json(breadcrumbs)+'</script></head><body class="categoryPage"><header><a href="'+home(lang)+'">E2 AUTO</a><nav aria-label="Language">'+LANGUAGES.map(l=>'<a lang="'+(l==='zh'?'zh-Hans':l)+'" href="'+categoryPath(category.slug,l)+'"'+(l===lang?' aria-current="page"':'')+'>'+({en:'EN',ms:'BM',zh:'华语'}[l])+'</a>').join('')+'</nav></header><main><p><a href="'+home(lang)+'#cars">← '+e(c.all)+'</a></p><h1>'+e(meta.h1)+'</h1><p>'+e(c.intro)+'</p><p>'+e(c.visit)+'</p>'+(matches.length?'<p>'+e(t('{count} cars to explore',{count:matches.length},lang))+'</p>':'<h2>'+e(c.empty)+'</h2><p>'+e(c.none)+'</p>')+'<p class="categoryActions"><a href="'+home(lang)+'booking.html">'+e(c.book)+'</a><a href="https://wa.me/60122785126?text='+encodeURIComponent(message)+'">WhatsApp · '+e(c.ask)+'</a></p>'+(!matches.length&&related.length?'<h2>'+e(c.related)+'</h2>':'')+'<div class="discoveryGrid">'+discoveryCards(matches.length?matches:related,lang,slugs,{...options,compact:true})+'</div><p>'+e(c.updated)+'</p></main><footer>'+categoryNavigation(categories,lang,{footer:true})+'</footer></body></html>';
}
export function renderRelated(car,rows,lang,slugs,options={}){
 const c=copy[lang];
 return '<section class="moreCars wrap" id="discoveryRelated"><h2>'+e(c.related)+'</h2><div id="relatedCars" class="relatedGrid">'+discoveryCards(relatedAvailable(car,rows),lang,slugs,{...options,compact:true})+'</div><p><a href="'+categoryPath(modelSlug(car),lang)+'">'+e(c.model)+' · '+e(car.brand+' '+car.model)+' ↗</a></p></section>';
}
