import {benefitFields,benefitsHTML,factoryWarrantyActive} from './vehicle-benefits.mjs';
const booleans=['factory_warranty','factory_warranty_unlimited','warranty_unlimited','full_service_record'];
const numbers=['factory_warranty_km','warranty_months','warranty_km','warranty_price'];
export function setupBenefitsEditor(form) {
  const el=name=>form.elements.namedItem(name);
  function data() {
    const values={};
    for(const key of benefitFields)values[key]=booleans.includes(key)?el(key).checked:numbers.includes(key)?(el(key).value===''?null:Number(el(key).value)):el(key).value.trim();
    values.factory_warranty_expires||=null;
    if(!values.factory_warranty)Object.assign(values,{factory_warranty_expires:null,factory_warranty_km:null,factory_warranty_unlimited:false,factory_warranty_terms:''});
    if(values.factory_warranty_unlimited)values.factory_warranty_km=null;
    if(values.third_party_warranty==='none')Object.assign(values,{warranty_provider:'',warranty_package:'',warranty_months:null,warranty_km:null,warranty_unlimited:false,warranty_price:null,warranty_coverage:'',warranty_terms:''});
    if(values.warranty_unlimited)values.warranty_km=null;
    if(values.third_party_warranty!=='available')values.warranty_price=null;
    return values;
  }
  function update() {
    const factory=el('factory_warranty').checked,third=el('third_party_warranty').value!=='none';
    for(const [id,on] of [['factoryWarrantyFields',factory],['thirdPartyWarrantyFields',third]]){
      const panel=form.querySelector('#'+id);panel.hidden=!on;panel.querySelectorAll('input,textarea').forEach(input=>input.disabled=!on);
    }
    el('factory_warranty_expires').required=factory;
    el('factory_warranty_km').disabled=!factory||el('factory_warranty_unlimited').checked;el('factory_warranty_km').required=!el('factory_warranty_km').disabled;
    for(const key of ['warranty_provider','warranty_package','warranty_months'])el(key).required=third;
    el('warranty_km').disabled=!third||el('warranty_unlimited').checked;el('warranty_km').required=!el('warranty_km').disabled;
    el('warranty_price').disabled=!third||el('third_party_warranty').value!=='available';el('warranty_price').closest('label').hidden=el('warranty_price').disabled;
    const car={...data(),mileage:el('mileage').value===''?null:Number(el('mileage').value),mileage_confirmed:el('mileage_confirmed').checked};
    form.querySelector('#benefitPreview').innerHTML=benefitsHTML(car,{lang:'en'});
    form.querySelector('#factoryWarrantyWarning').hidden=!factory||factoryWarrantyActive(car);
  }
  form.addEventListener('input',update);form.addEventListener('change',update);
  return {
    populate(car){for(const key of benefitFields){if(booleans.includes(key))el(key).checked=car?.[key]===true;else el(key).value=car?.[key]??(key==='third_party_warranty'?'none':'');}update();},
    read(){const result=data();if(result.factory_warranty&&!factoryWarrantyActive({...result,mileage:el('mileage').value===''?null:Number(el('mileage').value),mileage_confirmed:el('mileage_confirmed').checked}))throw Error('Factory Warranty needs a current expiry date and either verified mileage below its limit or verified unlimited mileage.');return result;}
  };
}
