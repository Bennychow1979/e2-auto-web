# Resending staff invitations

Super Admin → Users & permissions → active, unconfirmed employee → Resend invitation → confirm the displayed recipient.

The Edge Function revalidates the caller with Auth and e2_is_super_admin, resolves the recipient from e2_list_staff using user_id (never a client-supplied email), checks the current Auth email and confirmation state, and uses inviteUserByEmail to re-invite that same unconfirmed account. It does not change memberships or roles. Existing invitation quotas still apply. The UI prevents duplicate clicks and displays a 60-second wait after a request. SMTP limits remain the server-side authority.

Confirmed accounts use Forgot password on portal.html. Inactive accounts cannot be re-invited from the workspace. To stop access, use Edit access → turn Active off → Save permissions. Permanent deletion is not implemented.

A successful request is not proof of inbox delivery. Check Auth logs and the sender's delivery/bounce records when mail is missing. This update does not fix an unknown SMTP deliverability problem, and deployment itself sends no emails.

Validation: 19 mocked invitation-handler scenarios cover caller access, recipient identity, inactive/confirmed rejection, rate limits, and preservation of memberships. Browser fixture checks cover the recipient confirmation, pending-only button, feedback and mobile layout. No real email was sent during testing.
