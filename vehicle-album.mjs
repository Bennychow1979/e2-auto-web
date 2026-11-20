// Reuse only the first photo whose public identity was recorded in the HTML.
// Other photos, reordered covers and legacy/staff pages keep the signed URL path.
export async function resolveVehicleAlbum(photos,{cover,resolve}){
 const reuse=cover?.id&&cover.url&&photos[0]?.id===cover.id;
 const pending=reuse?photos.slice(1):photos;
 const resolved=pending.length?await resolve(pending):[];
 return reuse?[{...photos[0],url:cover.url},...resolved]:resolved;
}
