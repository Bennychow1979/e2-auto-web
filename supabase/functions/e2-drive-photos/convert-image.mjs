export function convertImage(ImageMagick,MagickFormat,bytes,width){
  return ImageMagick.read(bytes,img=>{
    img.autoOrient();
    if(img.width>width)img.resize(width,Math.max(1,Math.round(img.height*width/img.width)));
    img.strip();img.quality=78;
    return img.write(MagickFormat.WebP,data=>new Uint8Array(data));
  });
}
