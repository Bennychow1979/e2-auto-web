# Personal vehicle sharing

In Workspace → My Profile, publish the employee profile (Super Admin), then choose a published vehicle under Personal vehicle links. Copy the link or preview it. No vehicle is assigned to one employee. Each employee can share the same inventory.

`car.html?id=<vehicle UUID>&sales=<staff UUID>` resolves only the active, published public profile using an anonymous REST request. No staff session, email, arbitrary phone parameter or secret is included. Existing staff profile RLS remains the authority. Missing, private, disabled, invalid or unreachable profiles fall back to company WhatsApp 60122785126. Links without `sales` use the company. The referral is not stored in browser storage and does not change later direct showroom visits.

The contact strip shows the public name, position/languages and portrait. Enquiry, finance estimate, trade-in, loan guidance and viewing preparation all use the same recipient and retain vehicle identity/plate. Related-car links preserve a resolved consultant. Returning to the general showroom resets to company contact. Contact information is refreshed on focus and each visible minute; already opened WhatsApp drafts cannot be recalled.

No messages are sent by copying or opening a vehicle link. This is contact routing, not commission attribution or a lead database. No database migration or role changes are required.

Validation: referral.mjs covers anonymous lookup, invalid/unavailable fallback, recipient selection, URL sanitization and message preservation. profiles.cjs checks public profile/portrait RLS including unpublish and inactive accounts.
