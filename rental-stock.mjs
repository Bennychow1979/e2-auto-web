// Read the existing inventory with the current staff client and its RLS rules.
// Only vehicle basics are needed; photos and financial details are not fetched.
export async function loadRentalStock(client,checkAccess){
 await checkAccess();
 const cars=[];
 for(let start=0;;start+=200){
  const {data,error}=await client.from('vehicles')
   .select('id,plate,brand,model,variant,year,stock_status')
   .eq('lifecycle_state','active').order('plate').order('id').range(start,start+199);
  if(error)throw error;
  cars.push(...data);
  if(data.length<200)break;
 }
 await checkAccess();
 return cars;
}
export const plateKey=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function rentalStockMatches(cars,query){
 const key=plateKey(query);
 return cars.filter(car=>plateKey(car.plate)&&plateKey(car.plate).includes(key));
}
export function rentalStockDetails(car){
 return {plate:String(car.plate??'').trim().toUpperCase(),brand:String(car.brand??''),
  model:[car.model,car.variant].filter(Boolean).join(' '),year:car.year??''};
}
