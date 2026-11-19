-- Read-only, authorized operator query. No account/visitor identifiers returned.
-- First 48 hours after each scheduled post; delayed confirmations reported apart.
with posts as (
 select c.*,
  count(distinct v.id) as visits,
  count(distinct v.visitor_id) as browsers,
  count(r.user_id) filter(where r.started_at < c.scheduled_at+interval '48 hours') as registrations_started_48h,
  count(r.user_id) filter(where r.confirmed_at < c.scheduled_at+interval '48 hours') as registrations_confirmed_48h,
  count(r.user_id) filter(where r.confirmed_at is not null) as registrations_confirmed_to_date
 from e2_campaign_private.campaigns c
 left join e2_campaign_private.visits v
  on (v.campaign,v.content)=(c.campaign,c.content)
  and v.created_at>=c.scheduled_at
  and v.created_at<c.scheduled_at+interval '48 hours'
 left join e2_campaign_private.registrations r on r.visit_id=v.id
 where not c.is_test
 group by c.campaign,c.content,c.format,c.language,c.scheduled_at,c.is_test
)
select campaign,content,format,language,scheduled_at,
 now()>=scheduled_at+interval '48 hours' as window_complete,
 visits,browsers,registrations_started_48h,registrations_confirmed_48h,
 registrations_confirmed_to_date,
 round(100.0*registrations_confirmed_48h/nullif(visits,0),2) as registration_conversion_percent
from posts order by scheduled_at;
