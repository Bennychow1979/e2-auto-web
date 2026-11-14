import {renderStock,STOCK_MAX_CHARACTERS} from './build-stock.mjs';
export const STOCK_FEED_MAX_CHARACTERS=STOCK_MAX_CHARACTERS;
export const SOLD_RETENTION_DAYS=90;
// Benny approved using the website's current Sold record update time at cutover.
// Freeze it across later price/text edits; a published return to active stock
// removes the entry, so a later Sold transition starts a new retention period.
export function resolveStockSoldDates(rows,prior={}){
 if(!prior||Array.isArray(prior)||typeof prior!=='object')throw Error('Invalid prior Sold date registry');
 const dates={};for(const car of rows.filter(v=>v.stock_status==='Sold')){
  const date=Object.hasOwn(prior,car.id)?prior[car.id]:car.updated_at,time=Date.parse(date);
  if(typeof date!=='string'||!Number.isFinite(time))throw Error('Sold record has no valid website update time: '+car.plate);
  dates[car.id]=new Date(time).toISOString();
 }
 return dates;
}
export function renderStockFeeds(rows,{soldAtById={},slugs,fetchedAt,builtAt,complete=false,maxCharacters=STOCK_FEED_MAX_CHARACTERS}={}){
 const asOf=Date.parse(fetchedAt);if(!Number.isFinite(asOf))throw Error('A valid stock snapshot time is required');
 const cutoff=asOf-SOLD_RETENTION_DAYS*86400000,active=[],recentSold=[],expiredSold=[],seen=new Set();
 for(const car of rows){
  if(seen.has(car.id))throw Error('Duplicate public vehicle in stock feeds');seen.add(car.id);
  if(car.publication!=='published'||!['Available','Reserved','Sold'].includes(car.stock_status)||!slugs?.[car.id])throw Error('Incomplete public stock feed facts');
  if(car.stock_status!=='Sold'){active.push(car);continue;}
  const raw=soldAtById[car.id];
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))throw Error('Verified sold date missing or invalid: '+car.plate+' ('+car.id+'). Do not substitute updated_at.');
  const soldAt=Date.parse(raw);if(!Number.isFinite(soldAt)||new Date(soldAt).toISOString().slice(0,19)!==raw.slice(0,19)||soldAt>asOf)throw Error('Invalid or future sold date: '+car.plate);
  (soldAt>=cutoff?recentSold:expiredSold).push(car);
 }
 const options={slugs,fetchedAt,builtAt,complete,maxCharacters};
 // Construct both fully before the caller can replace either published file.
 const stock=renderStock(active,{...options,feedName:'stock.txt'}),soldStock=renderStock(recentSold,{...options,feedName:'stock-sold.txt'});
 return {stock,soldStock,coverage:{version:1,published:rows.length,active:active.length,soldRecent:recentSold.length,soldExpired:expiredSold.length,soldCutoff:new Date(cutoff).toISOString(),retentionDays:SOLD_RETENTION_DAYS,maxCharacters}};
}
