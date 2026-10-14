import {escapeHTML,t} from './i18n.mjs';
import {enquiryURL,withVehicleLink} from './referral.js';
const copy={
 title:['This vehicle is sold. Looking for a similar car?','Kereta ini sudah dijual. Mahu mencari kereta yang serupa?','这台车已售出，还想找同款或类似车？'],
 body:['Tell E2 what you are looking for. We can help look for another vehicle. This enquiry does not reserve the sold car.','Beritahu E2 kereta yang anda cari. Kami boleh membantu mencari kereta lain. Pertanyaan ini bukan tempahan kereta yang telah dijual.','告诉 E2 您想找的车，我们可以协助寻找另一台车。此咨询是找车需求，不代表预订这台已售车辆。'],
 action:['Ask E2 to find a similar car ↗','Minta E2 cari kereta serupa ↗','请 E2 帮我找类似车 ↗'],
 price:['LISTED PRICE · SOLD','HARGA DISENARAI · DIJUAL','刊登价格 · 已售出'],
 request:['This car is sold. Please help me find a similar or matching car. This is a stock request, not a reservation of the sold vehicle.','Kereta ini sudah dijual. Tolong bantu saya mencari kereta serupa. Ini permintaan stok, bukan tempahan kereta yang telah dijual.','这台车已售出。请帮我找同款或类似车。这是找车需求，不是预订这台已售车辆。']
};
export const stockCopy=(key,lang='en')=>copy[key][{en:0,ms:1,zh:2}[lang]??0];
export const stockRequestText=(car,lang='en')=>stockCopy('request',lang)+' '+[car.year,car.brand,car.model,car.variant].filter(Boolean).join(' ');
export function stockRequestHTML(car,lang,link){return '<section id="stockRequest" class="wrap"'+(car.stock_status==='Sold'?'':' hidden')+'><h2>'+escapeHTML(stockCopy('title',lang))+'</h2><p>'+escapeHTML(stockCopy('body',lang))+'</p><a id="stockRequestLink" class="pill dark" target="_blank" rel="noopener noreferrer" href="'+escapeHTML(enquiryURL(null,withVehicleLink(stockRequestText(car,lang),link)))+'">'+escapeHTML(stockCopy('action',lang))+'</a></section>';}
export function applyStockRequestDisplay(car,{lang='en',contact=null,link}={}){
 if(globalThis.document?.documentElement?.dataset?.vehiclePages!=='static-v1')return;
 const sold=car.stock_status==='Sold',main=document.getElementById('carMain');if(!main)return;
 document.documentElement.dataset.stockStatus=car.stock_status;
 if(!document.getElementById('stockRequest'))main.insertAdjacentHTML('afterbegin',stockRequestHTML(car,lang,link));
 const section=document.getElementById('stockRequest');section.hidden=!sold;
 const href=enquiryURL(contact,withVehicleLink(stockRequestText(car,lang),link));document.getElementById('stockRequestLink').href=href;
 for(const button of document.querySelectorAll('[data-book]'))button.hidden=sold;
 document.getElementById('finance').hidden=sold;
 for(const anchor of document.querySelectorAll('[href="#finance"]'))anchor.hidden=sold;
 document.querySelector('.sampleLabel').textContent=sold?stockCopy('price',lang):t('SELLING PRICE',{},lang);
 if(sold){
  const enquiry=document.getElementById('enquire');enquiry.textContent=stockCopy('action',lang);enquiry.href=href;enquiry.setAttribute('aria-label',stockCopy('action',lang));
 }
}
