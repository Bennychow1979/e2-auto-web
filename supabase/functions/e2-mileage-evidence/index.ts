import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createHandler} from './handler.mjs';
import * as magick from 'npm:@imagemagick/magick-wasm@0.0.44';
import {createImageInspector} from './image-validation.mjs';
// Bundle the pinned WASM with the function; never fetch a decoder per request.
await magick.initializeImageMagick(await Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.44/magick.wasm'))));
const inspectImage=createImageInspector(magick);
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Optional non-secret exact HTTPS origin list for an approved isolated staging UI.
// Never use wildcards. Auth and active Sales checks remain mandatory.
const origins=new Set((Deno.env.get('E2_MILEAGE_ALLOWED_ORIGINS')||'https://e2auto.my,https://bennychow1979.github.io').split(',').map(value=>value.trim()).filter(Boolean));
for(const origin of origins){const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error('Configure exact HTTPS mileage origins');}
Deno.serve(createHandler(admin,{origins,inspectImage}));
