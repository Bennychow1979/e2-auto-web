// Stable pagination avoids silently hiding records above the API row limit.
export async function allRows(makeQuery){
  const rows=[];
  for(let offset=0;;offset+=100){const result=await makeQuery().range(offset,offset+99);if(result.error)throw result.error;rows.push(...result.data);if(result.data.length<100)return rows}
}
