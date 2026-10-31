export function inventoryReceipt(revision='',dispatch=''){
 if(!revision&&!dispatch)return undefined;
 if(typeof revision!=='string'||!/^[1-9]\d{0,17}$/.test(revision)||typeof dispatch!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(dispatch))throw Error('Invalid inventory refresh receipt');
 return {revision,dispatch};
}
