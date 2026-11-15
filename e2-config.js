// Browser-safe project configuration. Access is enforced by database and Storage policies.
// Never replace this publishable key with a secret or service_role key.
window.E2_CONFIG = Object.freeze({
  // Hosted endpoint and real Super Admin session verified before activation.
  managementDashboard: true,
  mileageChecks: true,
  // Keep off until separately approved migration and hosted Auth/Storage checks pass.
  financingCases: false,
  // Enable only after the Partner migration and hosted access checks pass.
  partnerReferrals: true,
  supabaseUrl: 'https://gkppiuuwsecojcnvkzjl.supabase.co',
  publishableKey: 'sb_publishable_Ns0eq6G5CFGNpK6dCmIJHw_Oi9oiMZ8'
});
