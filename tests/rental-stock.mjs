import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRentalStock,rentalStockMatches,rentalStockDetails} from '../rental-stock.mjs';
test('stock pagination reads all visible active vehicles using only basic fields',async()=>{
 const inventory=Array.from({length:201},(_,i)=>({id:String(i),plate:'ABC'+i}));let calls=0,checks=0;
 const client={from(table){assert.equal(table,'vehicles');return {
  select(fields){assert.equal(fields,'id,plate,brand,model,variant,year,stock_status');return this;},
  eq(k,v){assert.equal(k,'lifecycle_state');assert.equal(v,'active');return this;},order(){return this;},
  async range(start,end){calls++;return {data:inventory.slice(start,end+1),error:null};}
 };}};
 assert.deepEqual(await loadRentalStock(client,async()=>checks++),inventory);assert.equal(calls,2);assert.equal(checks,2);
});
test('denied users never query inventory and access loss after reading rejects the result',async()=>{
 await assert.rejects(()=>loadRentalStock({from(){assert.fail('must not query');}},async()=>{throw Error('Denied');}),/Denied/);
 let checks=0;
 const client={from(){return {select(){return this},eq(){return this},order(){return this},range:async()=>({data:[],error:null})}}};
 await assert.rejects(()=>loadRentalStock(client,async()=>{if(++checks===2)throw Error('Revoked');}),/Revoked/);
});
test('partial plate lookup ignores case/separators; only basic fields are copied',()=>{
 const car={id:'id',plate:'ABC1234',brand:'HONDA',model:'CITY',variant:'V',year:2021,price:50000,owner_name:'DO NOT COPY'};
 assert.deepEqual(rentalStockMatches([car],'a b-c 12'),[car]);assert.deepEqual(rentalStockMatches([car],'999'),[]);
 assert.deepEqual(rentalStockDetails(car),{plate:'ABC1234',brand:'HONDA',model:'CITY V',year:2021});
 assert.deepEqual(rentalStockDetails({plate:'DRAFT1'}),{plate:'DRAFT1',brand:'',model:'',year:''});
});
