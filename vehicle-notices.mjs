import {language,escapeHTML as esc} from './i18n.mjs';

const copy={
  en:{mileage:'E2 Auto checks vehicle mileage against available records. However, we cannot guarantee that an odometer has never been altered.',pending:'Mileage is pending verification against available records. E2 Auto cannot guarantee that an odometer has never been altered.',warranty:'E2 Auto checks warranty information against available documents. Actual coverage and claim approval remain subject to the warranty provider’s written terms and assessment.',rights:'Nothing in this notice excludes or limits your statutory rights.',mileageLabel:'Mileage information',warrantyLabel:'Warranty information'},
  ms:{mileage:'E2 Auto menyemak perbatuan kenderaan berdasarkan rekod yang tersedia. Namun, kami tidak dapat menjamin bahawa odometer tidak pernah diubah.',pending:'Perbatuan masih menunggu pengesahan berdasarkan rekod yang tersedia. E2 Auto tidak dapat menjamin bahawa odometer tidak pernah diubah.',warranty:'E2 Auto menyemak maklumat waranti berdasarkan dokumen yang tersedia. Perlindungan sebenar dan kelulusan tuntutan tertakluk pada terma bertulis serta penilaian penyedia waranti.',rights:'Notis ini tidak mengecualikan atau mengehadkan hak anda di sisi undang-undang.',mileageLabel:'Maklumat perbatuan',warrantyLabel:'Maklumat waranti'},
  zh:{mileage:'E2 Auto 根据现有记录核查车辆里程，但无法保证里程表从未被更改。',pending:'车辆里程尚待依据现有记录核实。E2 Auto 无法保证里程表从未被更改。',warranty:'E2 Auto 根据现有文件核查保修信息。实际保障范围及索赔批准，仍以保修供应商的书面条款和审核为准。',rights:'本提示不排除或限制您依法享有的权利。',mileageLabel:'里程提示',warrantyLabel:'保修须知'}
};
export function vehicleNoticeHTML(kind,{lang=language,car={},className=''}={}){
  if(!['mileage','warranty'].includes(kind))throw Error('Unknown vehicle notice');
  const c=copy[lang]||copy.en;
  const checked=car.mileage_confirmed===true&&Number.isInteger(car.mileage)&&car.mileage>=0;
  const body=kind==='warranty'?c.warranty:checked?c.mileage:c.pending;
  return '<span class="vehicleNotice vehicleNotice--'+kind+(className?' '+esc(className):'')+'" role="note" aria-label="'+esc(c[kind+'Label'])+'"><span>'+esc(body)+'</span><span class="noticeRights">'+esc(c.rights)+'</span></span>';
}
