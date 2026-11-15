import {test} from 'node:test';
import assert from 'node:assert/strict';
import {benefits,benefitsHTML,benefitDetailsHTML,factoryWarrantyActive,batteryWarrantyActive,malaysiaDay} from '../../vehicle-benefits.mjs';
const now=new Date('2026-10-19T04:00:00Z');
const factory={factory_warranty:true,factory_warranty_expires:'2026-10-19',factory_warranty_km:100000,mileage:50000,mileage_confirmed:true};
const third={third_party_warranty:'included',warranty_provider:'Example provider',warranty_package:'Example package',warranty_months:12,warranty_km:20000};
const battery={battery_warranty:true,battery_warranty_expires:'2026-10-19',battery_warranty_km:160000,mileage:120000,mileage_confirmed:true};
test('battery cover is independent of factory cover and never inferred from BMW model/year',()=>{
  assert.deepEqual(benefits({brand:'BMW',model:'X5 xDrive45e',year:2021},now),[]);
  assert.deepEqual(benefits({...factory,...battery},now).map(x=>x[0]),['battery']);
  assert.deepEqual(benefits({...factory,...battery,mileage:50000},now).map(x=>x[0]),['factory','battery']);
  assert.deepEqual(benefits({...factory,...battery,battery_warranty:false,mileage:50000},now).map(x=>x[0]),['factory']);
});
test('battery cover validates dates and Malaysian midnight without an odometer gate',()=>{
  assert(batteryWarrantyActive(battery,now));
  for(const patch of [{battery_warranty:'true'},{battery_warranty_expires:'2026-02-30'},{battery_warranty_expires:'2026-10-18'},{battery_warranty_expires:null}])assert(!batteryWarrantyActive({...battery,...patch},now));
  for(const patch of [{battery_warranty_km:210000,mileage:210000},{battery_warranty_km:210000,mileage:220000},{battery_warranty_km:null,mileage:null,mileage_confirmed:false},{mileage_confirmed:false}])assert(batteryWarrantyActive({...battery,...patch},now));
  assert(batteryWarrantyActive(battery,new Date('2026-10-19T15:59:59Z')));
  assert(!batteryWarrantyActive(battery,new Date('2026-10-19T16:00:00Z')));
  assert.equal(benefitDetailsHTML(battery,{now:new Date('2026-10-20T00:00:00Z')}),'');
});
test('battery icon and public details are translated and escape verified notes',()=>{
  for(const [lang,label] of [['en','Battery Warranty'],['ms','Waranti Bateri'],['zh','高压电池保修']]){
    const badge=benefitsHTML(battery,{lang,now});assert(badge.includes(label));assert(badge.includes('<rect'));assert(badge.includes('aria-hidden="true"'));
    const details=benefitDetailsHTML({...battery,battery_warranty_terms:'<script>private</script>'},{lang,now});assert(details.includes(label));assert(details.includes('160,000 km'));assert(!details.includes('<script>'));assert(!details.includes('undefined'));
  }
});
test('missing/default fields, vehicle age and model never create a label',()=>{for(const car of [{},{year:2026,brand:'BMW'},{factory_warranty:false,full_service_record:false,third_party_warranty:'none'},{factory_warranty:'true',full_service_record:'true'}])assert.deepEqual(benefits(car,now),[])});
test('factory expires at Malaysian midnight and not UTC midnight',()=>{assert.equal(malaysiaDay(new Date('2026-10-19T16:00:00Z')),'2026-10-20');assert(factoryWarrantyActive(factory,new Date('2026-10-19T15:59:59Z')));assert(!factoryWarrantyActive(factory,new Date('2026-10-19T16:00:00Z')))});
test('factory requires positive limit, confirmed mileage below limit, or explicitly unlimited',()=>{assert(factoryWarrantyActive(factory,now));for(const patch of [{mileage:100000},{mileage:100001},{mileage:null},{mileage_confirmed:false},{factory_warranty_km:0},{factory_warranty_expires:null},{factory_warranty_expires:'expired'},{factory_warranty_expires:'2026-10-18'}])assert(!factoryWarrantyActive({...factory,...patch},now),JSON.stringify(patch));assert(factoryWarrantyActive({...factory,mileage:null,mileage_confirmed:false,factory_warranty_km:null,factory_warranty_unlimited:true},now))});
test('third-party mode is exclusive, service independent, and factory may coexist',()=>{assert.deepEqual(benefits({...factory,...third,full_service_record:true},now).map(x=>x[1]),['Factory Warranty','Warranty Included','Full Service Record']);assert.equal(benefits({...third,third_party_warranty:'available'},now)[0][1],'Warranty Available');assert.deepEqual(benefits({...third,warranty_provider:''},now),[])});
test('all labels use accessible generic icons and localised text',()=>{for(const lang of ['en','ms','zh']){const html=benefitsHTML({...factory,...third,full_service_record:true},{now,lang});assert.equal((html.match(/<svg /g)||[]).length,3);assert.equal((html.match(/aria-hidden="true"/g)||[]).length,3);assert(!html.includes('undefined'))}assert(benefitsHTML(factory,{now,lang:'zh'}).includes('原厂保修'));assert(benefitsHTML(factory,{now,lang:'ms'}).includes('Waranti Pengilang'))});
test('details escape stored content, distinguish offers from active cover, and handle unknown price',()=>{const html=benefitDetailsHTML({...third,third_party_warranty:'available',warranty_provider:'<img src=x onerror=alert(1)>',warranty_terms:'<script>x</script>',full_service_record:true},{now});assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(html.includes('Ask for a quote'));assert(html.includes('does not mean cover is active'));assert(html.includes('does not mean every service'));assert(benefitDetailsHTML({...third,warranty_price:999},{now}).includes('Included in vehicle price'));assert(benefitDetailsHTML({...third,third_party_warranty:'available',warranty_price:0},{now}).includes('RM0.00'))});
test('expired factory details disappear with its badge',()=>{assert.equal(benefitsHTML({...factory,factory_warranty_expires:'2026-01-01'},{now}),'');assert.equal(benefitDetailsHTML({...factory,factory_warranty_expires:'2026-01-01'},{now}),'')});

test('optional battery limit is displayed as entered, never as unlimited or an automatic odometer promise',()=>{const html=benefitDetailsHTML({...battery,battery_warranty_km:210000,mileage:220000,mileage_confirmed:false},{now});assert(html.includes('210,000 km'));assert(html.includes('verified battery warranty policy'));assert(!html.includes('whichever comes first'));const blank=benefitDetailsHTML({...battery,battery_warranty_km:null},{now});assert(!blank.includes('Odometer limit'));assert(!blank.includes('Unlimited'));assert(!blank.includes('NaN'));});
