export function readLocalArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function getLeadIdentity(lead) {
  return `${lead?.name || ""}||${lead?.address || ""}`.toLowerCase().trim();
}

export function dedupeLeads(leads = []) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = getLeadIdentity(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countLeadsByField(leads = [], field) {
  return leads.filter((lead) => lead?.[field]).length;
}

export function getLeadStats(leads = []) {
  return {
    total: leads.length,
    phoneCount: countLeadsByField(leads, "phone"),
    webCount: countLeadsByField(leads, "website"),
    igCount: countLeadsByField(leads, "instagram"),
    emailCount: countLeadsByField(leads, "email"),
  };
}

export function getSearchLeadCount(leads = [], searchId) {
  return leads.filter((lead) => lead.searchId === searchId).length;
}
