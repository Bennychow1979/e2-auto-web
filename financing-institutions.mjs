// Public review names only. This module never writes institution configuration.
export function parseInstitutionDraft(value) {
  if (value?.draft_only !== true || value?.apply_automatically !== false || !Array.isArray(value.institutions) || value.institutions.length > 50) throw Error('Institution checklist unavailable.');
  const seen = new Set();
  return value.institutions.map(item => {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const key = name.toLowerCase();
    if (!name || name.length > 120 || seen.has(key) || item.active !== false || ['kind','submission_channels','portal_url','email_to','required_documents'].some(field => item[field] !== null)) throw Error('Institution checklist requires review.');
    seen.add(key);
    return {name};
  });
}

export async function loadInstitutionDraft(fetcher = fetch) {
  const response = await fetcher(new URL('./config/finance-institutions.draft.json', import.meta.url), {credentials:'omit', cache:'no-cache'});
  if (!response.ok) throw Error('Institution checklist unavailable.');
  return parseInstitutionDraft(await response.json());
}

export function institutionChecklist(draft, configured) {
  return draft.map(item => ({...item, configured:configured.find(row => row.name.trim().toLowerCase() === item.name.toLowerCase()) || null}));
}
