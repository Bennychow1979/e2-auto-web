# Staff profiles

Migration 202609130005_staff_profiles.sql was applied to E2 WEB Project on 2026-09-13. No employee profile was prefilled or made public during deployment.

Active Super Admin, Admin, Salesman and Account users can save their own name, position, WhatsApp, languages, bio and portrait in profile.html. Customer users have no employee-profile editing access. Super Admin can select any staff member or follow Edit profile from team.html.

All writes use guarded RPCs with revision checks; direct table writes are denied. Only Super Admin can publish or hide a profile. Any save returns a published profile to private, requiring review before republication. An inactive staff member's public profile and photo are denied immediately on subsequent database/storage requests. Previously issued five-minute signed photo URLs or downloaded copies cannot be recalled.

The private staff-photos bucket accepts WebP up to 1 MB. The browser accepts JPG/PNG/WebP up to 10 MB and produces a centered square portrait up to 800 px, removing source metadata through canvas export. Uploads go into the staff member's UUID folder. Referenced photos cannot be deleted; replacement first saves the new reference and then attempts old-object cleanup. Failed cleanup or interrupted uploads can leave private orphan objects, which should be reviewed in Storage before removal.

Public consultant.html?id=... shows only customer-facing profile fields with a WhatsApp handoff. Login email, role and audit history are never stored in the public profile. Vehicle assignment and customer booking integration are a later step.

Validation: 42 database/number-format checks cover own-versus-other access, Super Admin publication, stale updates, photo ownership, public hiding, disabled staff and input validation. Isolated browser fixtures verify form saving, portrait preparation/upload handling, public preview and WhatsApp URL; they do not prove a real employee's hosted photo upload. No employee photo or contact details were published as test data.
