begin;
-- Daily import health: one shared report per Malaysia day, read by the owner's
-- Telegram alert and by the Claude follow-up. Telegram is sent only for a new
-- problem, a recovery or the Monday all-clear, so one fault is reported once.
-- The bot token and chat ID live in Vault as e2_telegram_bot_token and
-- e2_telegram_chat_id; they are never stored in tables, logs or cron commands.
create table public.import_health_reports (
  report_day date primary key,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('ok','warning','failed')),
  fingerprint text not null,
  findings jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  notify_reason text check (notify_reason in ('new_issue','recovered','weekly_ok')),
  telegram_request bigint,
  telegram_error text
);
alter table public.import_health_reports enable row level security;
revoke all on public.import_health_reports from public,anon,authenticated;
grant all on public.import_health_reports to service_role;
grant select on public.import_health_reports to authenticated;
create policy admin_read_import_health on public.import_health_reports for select to authenticated using (
  exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and active and role in ('super_admin','admin')));

-- Message text is built from the stored report only; vehicle details are limited
-- to plates and prices already shown to admins in the portal.
create function public.e2_send_import_health_telegram(day date) returns void language plpgsql security definer set search_path='' as $$
declare report public.import_health_reports%rowtype; bot text; chat text; body text; request bigint; item jsonb; lines text[]:='{}';
begin
  select * into report from public.import_health_reports where report_day=day;
  if not found then return; end if;
  select decrypted_secret into bot from vault.decrypted_secrets where name='e2_telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name='e2_telegram_chat_id';
  if coalesce(bot,'')='' or coalesce(chat,'')='' then
    update public.import_health_reports set telegram_error='Telegram is not configured in Vault.' where report_day=day;
    return;
  end if;
  lines:=lines||((case report.notify_reason when 'new_issue' then '⚠️ E2 导入异常 · ' when 'recovered' then '✅ E2 导入已恢复正常 · ' else '✅ E2 导入本周正常 · ' end)||to_char(day,'DD/MM/YYYY'));
  for item in select value from jsonb_array_elements(report.findings) with ordinality t(value,n) where n<=10 loop
    lines:=lines||('• '||(item->>'message'));
  end loop;
  if jsonb_array_length(report.findings)>10 then lines:=lines||('…另有 '||(jsonb_array_length(report.findings)-10)||' 项'); end if;
  lines:=lines||('今日新建草稿 '||coalesce(report.metrics->>'created','0')||' · 待核对文件夹 '||coalesce(report.metrics->>'blocked_open','0')
    ||' · 车辆 '||coalesce(report.metrics->>'vehicles','0')||'（草稿 '||coalesce(report.metrics->>'drafts','0')||'）');
  if jsonb_array_length(coalesce(report.metrics->'created_list','[]'::jsonb))>0 then
    lines:=lines||('新建草稿: '||(select string_agg((c->>'plate')||' RM'||to_char((c->>'price')::numeric,'FM999,999,990'),', ') from (select c from jsonb_array_elements(report.metrics->'created_list') with ordinality t(c,n) where n<=10) x));
  end if;
  lines:=lines||'门户: https://e2auto.my/portal.html'::text;
  body:=array_to_string(lines,E'\n');
  select net.http_post(
    url:='https://api.telegram.org/bot'||bot||'/sendMessage',
    body:=jsonb_build_object('chat_id',chat,'text',left(body,3500),'disable_web_page_preview',true),
    headers:=jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=15000) into request;
  update public.import_health_reports set telegram_request=request,telegram_error=null where report_day=day;
end;
$$;
revoke all on function public.e2_send_import_health_telegram(date) from public,anon,authenticated,service_role;

-- Read-only check of today's import; writes only the shared report row.
create function public.e2_import_health_check(at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare day date:=(at at time zone 'Asia/Kuala_Lumpur')::date; run public.vehicle_import_runs%rowtype;
  v_findings jsonb:='[]'::jsonb; v_metrics jsonb; item jsonb; v_status text; v_fingerprint text; v_reason text;
  previous public.import_health_reports%rowtype; existing public.import_health_reports%rowtype; dupes text; v_enabled boolean;
begin
  perform pg_advisory_xact_lock(17102026);
  select s.enabled into v_enabled from public.vehicle_import_schedule s where singleton;
  if not coalesce(v_enabled,false) then
    v_findings:=v_findings||jsonb_build_object('severity','warning','code','schedule_off','message','自动导入已关闭 (Automatic import is off).');
  end if;
  select * into run from public.vehicle_import_runs r where r.run_kind='daily' and r.scheduled_day=day;
  if run.id is null then
    if coalesce(v_enabled,false) then v_findings:=v_findings||jsonb_build_object('severity','failed','code','no_run','message','今天 09:00 没有导入记录 (No daily import run today).'); end if;
  elsif run.status in ('queued','running') then
    v_findings:=v_findings||jsonb_build_object('severity','warning','code','still_running','message','09:00 导入仍在进行中 (Import still running).');
  elsif run.status='failed' then
    v_findings:=v_findings||jsonb_build_object('severity','failed','code','run_failed','message','09:00 导入失败: '||coalesce(run.summary->>'error','unknown error'));
  end if;
  -- The importer only reports a blocked folder when its issue is new or changed.
  if run.id is not null then
    for item in select value from jsonb_array_elements(coalesce(run.summary->'blocked','[]'::jsonb)) loop
      v_findings:=v_findings||jsonb_build_object('severity','warning','code','blocked','message','需核对 '||coalesce(item->>'plate','?')||': '||coalesce(item->>'issue',''));
    end loop;
  end if;
  if exists(select 1 from public.vehicle_import_runs r where r.status in ('queued','running') and r.lease_until<=at) then
    v_findings:=v_findings||jsonb_build_object('severity','warning','code','stuck_run','message','有导入记录卡住未结束 (A run passed its lease).');
  end if;
  select string_agg(p,', ' order by p) into dupes from (select upper(regexp_replace(v.plate,'[^A-Za-z0-9]','','g')) p from public.vehicles v group by 1 having count(*)>1) d;
  if dupes is not null then
    v_findings:=v_findings||jsonb_build_object('severity','warning','code','duplicate_plates','message','库存有重复车牌: '||dupes);
  end if;
  v_metrics:=jsonb_build_object(
    'run_status',run.status,'batches',run.batches,
    'created',coalesce(jsonb_array_length(run.summary->'created'),0),
    'created_list',coalesce((select jsonb_agg(jsonb_build_object('plate',c->>'plate','price',c->'price')) from jsonb_array_elements(run.summary->'created') c),'[]'::jsonb),
    'blocked_open',(select count(*) from public.vehicle_import_jobs j where j.status='blocked'),
    'vehicles',(select count(*) from public.vehicles),
    'drafts',(select count(*) from public.vehicles v where v.publication='draft'),
    'published',(select count(*) from public.vehicles v where v.publication='published'));
  v_status:=case when v_findings @> '[{"severity":"failed"}]' then 'failed' when jsonb_array_length(v_findings)>0 then 'warning' else 'ok' end;
  -- Counts and times are excluded so an unchanged fault keeps the same fingerprint.
  v_fingerprint:=encode(sha256(convert_to(coalesce((select string_agg(f->>'code'||'|'||(f->>'message'),E'\n' order by f->>'code',f->>'message') from jsonb_array_elements(v_findings) f),''),'UTF8')),'hex');
  select * into previous from public.import_health_reports h where h.report_day<day order by h.report_day desc limit 1;
  select * into existing from public.import_health_reports h where h.report_day=day;
  v_reason:=case
    when v_status<>'ok' and (previous.report_day is null or previous.fingerprint<>v_fingerprint) then 'new_issue'
    when v_status='ok' and previous.report_day is not null and previous.status<>'ok' then 'recovered'
    when v_status='ok' and extract(isodow from day)=1 then 'weekly_ok' end;
  -- A same-day re-check with an unchanged result never sends a second message.
  if existing.report_day is not null and existing.fingerprint=v_fingerprint then v_reason:=null; end if;
  insert into public.import_health_reports(report_day,checked_at,status,fingerprint,findings,metrics,notify_reason)
    values(day,at,v_status,v_fingerprint,v_findings,v_metrics,v_reason)
    on conflict(report_day) do update set checked_at=excluded.checked_at,status=excluded.status,fingerprint=excluded.fingerprint,
      findings=excluded.findings,metrics=excluded.metrics,
      notify_reason=coalesce(excluded.notify_reason,public.import_health_reports.notify_reason),
      telegram_request=case when excluded.notify_reason is null then public.import_health_reports.telegram_request end,
      telegram_error=case when excluded.notify_reason is null then public.import_health_reports.telegram_error end;
  if v_reason is not null then perform public.e2_send_import_health_telegram(day); end if;
  return (select to_jsonb(h)-'telegram_request' from public.import_health_reports h where h.report_day=day);
end;
$$;
revoke all on function public.e2_import_health_check(timestamptz) from public,anon,authenticated,service_role;
commit;
