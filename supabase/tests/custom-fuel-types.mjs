import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {operationsDatabase} from '../../tests/fixtures/operations-db.mjs';
const {db,ids,as}=await operationsDatabase();
try {
 await db.exec('reset role');
 await db.exec(await readFile('supabase/migrations/202610210004_plate_drafts.sql','utf8'));
 const sql=await readFile('supabase/migrations/202611010001_custom_fuel_types.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 await as('admin');
 for(const fuel of ['PHEV','HYDROGEN','LPG','PETROL','DIESEL','HYBRID','ELECTRIC']) {
  const r=await db.query('update vehicles set fuel_type=$1 where id=$2 returning fuel_type',[fuel,ids.car]);assert.equal(r.rows[0].fuel_type,fuel);
 }
 for(const fuel of ['', ' ', ' PHEV','PHEV ', 'A'.repeat(41),'PHEV\n','__manual__','__MANUAL__']) await assert.rejects(()=>db.query('update vehicles set fuel_type=$1 where id=$2',[fuel,ids.car]),/vehicles_fuel_type_check/);
 await db.query('update vehicles set fuel_type=null,import_pending=true where id=$1',[ids.car]);
 await db.query('update vehicles set fuel_type=$1,import_pending=false where id=$2',['PHEV',ids.car]);
 await as('sales');
 const r=await db.query('update vehicles set fuel_type=$1 where id=$2 returning id',['LPG',ids.car]);assert.equal(r.rows.length,0);
 await as('admin');assert.equal((await db.query('select fuel_type from vehicles where id=$1',[ids.car])).rows[0].fuel_type,'PHEV');
 console.log('PASS custom fuel: save/read PHEV and custom values, original types, nullable draft, validation, repeat migration and unchanged staff permissions.');
} finally {await db.close();}
