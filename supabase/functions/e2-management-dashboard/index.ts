import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import ExcelJS from 'npm:exceljs@4.4.0';
import JSZip from 'npm:jszip@3.10.2';
import {SaxesParser} from 'npm:saxes@5.0.1';
import {googleDrive} from '../e2-drive-photos/google.mjs';
import {MASTERLIST,period} from '../e2-vehicle-import/plan.mjs';
import {createWorkbookLoader} from '../e2-vehicle-import/workbook.mjs';
import {fleetSummary} from './fleet.mjs';
import {createHandler,paged,loanSummary} from './handler.mjs';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const url=Deno.env.get('SUPABASE_URL')||'';
const authClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')||'',options);
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',options);
let credentials=null;try{credentials=JSON.parse(Deno.env.get('E2_DRIVE_SERVICE_ACCOUNT_JSON')||'null')}catch{}
const drive=googleDrive(credentials),load=createWorkbookLoader({ExcelJS,JSZip,SaxesParser});
const checked=r=>{if(r.error)throw Error('Read failed');return r.data};
const count=async query=>{const r=await query;if(r.error||!Number.isSafeInteger(r.count))throw Error('Count unavailable');return r.count};
Deno.serve(createHandler({
  authenticate:async token=>{const r=await authClient.auth.getUser(token);return r.error?null:r.data.user},
  membership:async id=>checked(await admin.from('staff_memberships').select('role,active').eq('user_id',id).maybeSingle()),
  readMembers:async start=>({total:await count(admin.from('customer_profiles').select('user_id',{count:'exact',head:true})),month:await count(admin.from('customer_profiles').select('user_id',{count:'exact',head:true}).gte('created_at',start))}),
  readLoans:async()=>{
    const [loans,intakes]=await Promise.all([
      paged(()=>admin.from('loan_applications').select('id,status').not('submitted_at','is',null).order('id')),
      paged(()=>admin.from('intake_submissions').select('id,status').not('submitted_at','is',null).order('id'))
    ]);return loanSummary(loans,intakes);
  },
  readCommissions:async()=>({pending:await count(admin.from('e2_referral_commissions').select('id',{count:'exact',head:true}).eq('status','Pending'))}),
  readFleet:async date=>{
    const meta=await drive.metadata(MASTERLIST);
    if(meta.trashed||meta.mimeType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')throw Error('Invalid source');
    const fleet=fleetSummary(await load(await drive.workbook(MASTERLIST,meta.md5Checksum),period(date)),date);
    const latest=await drive.metadata(MASTERLIST);if(latest.md5Checksum!==meta.md5Checksum)throw Error('Source changed');
    return {...fleet,source:'MASTERLIST',sourceModifiedAt:meta.modifiedTime};
  }
}));
