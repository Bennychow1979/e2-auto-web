import {ImageMagick,initializeImageMagick,MagickFormat} from 'npm:@imagemagick/magick-wasm@0.0.30';
import {convertImage} from './convert-image.mjs';
let ready:Promise<void>|undefined;
export async function convertWebP(bytes:Uint8Array,width:number){
  ready??=Deno.readFile(new URL('magick.wasm',import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.30'))).then(initializeImageMagick);
  await ready;
  return convertImage(ImageMagick,MagickFormat,bytes,width);
}
