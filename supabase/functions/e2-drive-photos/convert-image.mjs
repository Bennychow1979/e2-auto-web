export function convertImage(ImageMagick,MagickFormat,bytes,width){
  return ImageMagick.read(bytes,img=>{
    img.autoOrient();
    if(img.width>width)img.resize(width,Math.max(1,Math.round(img.height*width/img.width)));
    // Keep colour management while removing unrelated EXIF/IPTC metadata.
    const profile=img.getProfile('icc');
    const colour=profile?new Uint8Array(profile.data):null;
    img.strip();if(colour)img.setProfile('icc',colour);img.quality=78;
    return img.write(MagickFormat.WebP,data=>new Uint8Array(data));
  });
}
