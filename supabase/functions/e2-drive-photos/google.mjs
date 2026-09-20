import {createHash} from 'node:crypto';
import {b64,FILE_ID,MAX_BYTES,imageType} from './core.mjs';
const fields='id,name,mimeType,parents,trashed,size,md5Checksum,modifiedTime,version,capabilities(canDownload)';
export function googleDrive(credentials,fetcher=fetch) {
  let cached=null;
  async function accessToken() {
    if(cached&&cached.until>Date.now()+60000)return cached.token;
    if(!credentials?.client_email||!credentials?.private_key)throw new Error('Google Drive is not connected. Uploaded photos still work.');
    const now=Math.floor(Date.now()/1000),enc=new TextEncoder();
    const header=b64(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
    const payload=b64(enc.encode(JSON.stringify({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
    const pem=credentials.private_key.replace(/-----[^-]+-----|\s/g,'');
    const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const input=header+'.'+payload,sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(input));
    const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+b64(sig)}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Google Drive access needs attention. Uploaded photos still work.');
    const result=await response.json();
    if(!result.access_token)throw new Error('Google Drive access needs attention.');
    cached={token:result.access_token,until:Date.now()+Math.min(Number(result.expires_in)||3600,3600)*1000};
    return cached.token;
  }
  async function request(path,params={}) {
    const url=new URL('https://www.googleapis.com/drive/v3/'+path);
    for(const [name,value] of Object.entries({...params,supportsAllDrives:'true'}))url.searchParams.set(name,String(value));
    const response=await fetcher(url,{headers:{Authorization:'Bearer '+await accessToken()},signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!response.ok) {
      await response.body?.cancel();
      throw new Error('Drive photo or folder is unavailable. Check access and try again.');
    }
    return response;
  }
  return {
    async workbook(id,checksum) {
      if(!FILE_ID.test(id)||!(/^[a-f0-9]{32}$/).test(checksum))throw new Error('MASTERLIST must be an XLSX file with a checksum.');
      const response=await request('files/'+id,{alt:'media'}),limit=10*1024*1024;
      if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('MASTERLIST exceeds 10 MB.')}
      const reader=response.body.getReader(),chunks=[];let length=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('MASTERLIST exceeds 10 MB.');chunks.push(value)}}finally{await reader.cancel()}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      if(createHash('md5').update(bytes).digest('hex')!==checksum)throw new Error('MASTERLIST changed while reading. Retry with the latest version.');
      return bytes;
    },
    async metadata(id) {
      if(!FILE_ID.test(id))throw new Error('Invalid Drive file.');
      return (await request('files/'+id,{fields})).json();
    },
    async list(folder) {
      if(!FILE_ID.test(folder))throw new Error('Invalid Drive folder.');
      const files=[];let pageToken='';
      do {
        const result=await (await request('files',{q:"'"+folder+"' in parents and trashed=false",fields:'nextPageToken,incompleteSearch,files('+fields+')',pageSize:100,orderBy:'name_natural',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})})).json();
        if(result.incompleteSearch)throw new Error('Drive returned an incomplete folder. Try again.');
        files.push(...(result.files||[]));pageToken=result.nextPageToken;
        if(files.length>300)throw new Error('This folder has more than 300 files. Choose a vehicle photo folder.');
      }while(pageToken);
      return files;
    },
    async image(id,checksum,expectedType) {
      if(!FILE_ID.test(id)||!(/^[a-f0-9]{32}$/).test(checksum))throw new Error('Invalid photo.');
      const response=await request('files/'+id,{alt:'media'});
      if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('Photo exceeds 20 MB.')}
      const reader=response.body.getReader(),chunks=[];let length=0;
      try {
        for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES)throw new Error('Photo exceeds 20 MB.');chunks.push(value)}
      }finally{await reader.cancel()}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      if(!length||imageType(bytes)!==expectedType)throw new Error('This file is not a supported vehicle photo.');
      if(createHash('md5').update(bytes).digest('hex')!==checksum)throw new Error('This Drive photo changed. Review and link it again.');
      return bytes;
    }
  };
}
