// Rollout compatibility only. Database RLS/RPC checks remain authoritative.
// Missing/false configuration must preserve the pre-financing production flow.
export const financingEnabled = () => globalThis.E2_CONFIG?.financingCases === true;
