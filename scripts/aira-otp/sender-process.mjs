import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// A short-lived lightweight client keeps idle memory low. OTP/recipient stay off
// argv and environment. There is one attempt only, including ambiguous timeouts.
export function runSender(request,{publicMode=false,signal,spawnProcess=spawn,timeoutMs=60000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('Sender aborted'));return}
  const child=spawnProcess(process.execPath,['--max-old-space-size=80',fileURLToPath(new URL('./gateway-sender.mjs',import.meta.url)),...(publicMode?['--public']:[])],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='',failed=false,finished=false;
  const kill=()=>{failed=true;child.kill('SIGKILL')};
  const timer=setTimeout(kill,timeoutMs);
  const abort=()=>kill();signal?.addEventListener('abort',abort,{once:true});
  const done=(error)=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   error?reject(Error('Sender unavailable')):resolve({stdout:output});
  };
  child.on('error',()=>done(true));
  child.stdout.on('data',chunk=>{if(failed)return;output+=chunk;if(Buffer.byteLength(output)>16384){output='';kill()}});
  child.stderr.on('data',()=>{}); // Drain, but never return dependency logs.
  child.stdin.on('error',()=>kill());
  child.on('close',code=>done(failed||code!==0));
  if(signal?.aborted)abort();
  child.stdin.end(JSON.stringify(request));
 });
}
