import {descriptionFor} from './vehicle-translations.mjs';

export function currentTranslation(car,lang,row) {
  if(!['en','ms','zh'].includes(lang)||!car.description||row?.source_text!==car.description)return null;
  return typeof row[lang]==='string'&&row[lang].trim()?row[lang]:null;
}
export async function loadVehicleDescription(db,car,lang) {
  const fallback=descriptionFor(car.description,lang);
  if(!car.description?.trim())return fallback;
  try {
    const result=await db.from('vehicle_description_translations').select('source_text,en,ms,zh').eq('vehicle_id',car.id).maybeSingle();
    if(result.error)return fallback;
    return currentTranslation(car,lang,result.data)??fallback;
  }catch{return fallback;}
}
