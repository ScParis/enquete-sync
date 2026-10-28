// Roteador Modular de Fontes e Perfis de Normalização
// Responsabilidade Única: rotas /api/source/inspect, /api/source/load, /api/mapping/profiles/*

export async function handleSourceProfileRoutes(req, res, {
  url,
  payload,
  loadSource,
  parseHeaderAndSample,
  createSuggestedProfile,
  validateProfileAgainstStructure,
  parseCsvTable,
  normalizeTable,
  savedProfiles,
  saveProfiles,
  targetModels,
  availableFields,
  previewStateRef,
  send
}) {
  if (url.pathname === '/api/source/inspect') {
    const source = await loadSource(payload);
    const headerRow = Number.isInteger(payload.headerRow) ? payload.headerRow : 1;
    const structure = parseHeaderAndSample(source.csv, { headerRow });
    const accountId = payload.accountId ? String(payload.accountId).trim() : '';
    const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
    const existing = savedProfiles.find(p => p.accountId === accountId && (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId));
    const suggested = createSuggestedProfile(accountId || '0000', source.label, sheetId, structure, payload.targetModel || 'enquete_automacao');
    return send(res, 200, {
      source: source.label,
      stale: source.stale,
      structure,
      existingProfile: existing ?? null,
      suggestedProfile: suggested,
      targetModels,
      availableFields
    });
  }

  if (url.pathname === '/api/mapping/profiles') {
    const accountId = payload.accountId ? String(payload.accountId).trim() : '';
    const profiles = accountId ? savedProfiles.filter(p => p.accountId === accountId) : savedProfiles;
    return send(res, 200, { profiles });
  }

  if (url.pathname === '/api/mapping/profiles/save') {
    const profile = payload.profile;
    if (!profile || typeof profile !== 'object') throw new Error('Perfil inválido');
    previewStateRef.value = null;
    profile.version = (profile.version || 0) + 1;
    profile.updatedAt = new Date().toISOString();
    const idx = savedProfiles.findIndex(p => p.id === profile.id || (p.accountId === profile.accountId && p.sourceFingerprint === profile.sourceFingerprint && p.sheetIdentifier === profile.sheetIdentifier));
    if (idx >= 0) savedProfiles[idx] = profile;
    else savedProfiles.push(profile);
    await saveProfiles();
    return send(res, 200, { success: true, profile, savedProfiles });
  }

  if (url.pathname === '/api/source/load') {
    previewStateRef.value = null;
    const source = await loadSource(payload);
    const table = parseCsvTable(source.csv);
    const accountId = payload.accountId ? String(payload.accountId).trim() : '';
    const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
    const profile = payload.profile ?? savedProfiles.find(p => p.accountId === accountId && (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId));
    if (profile) {
      const normResult = normalizeTable(table, profile);
      return send(res, 200, {
        source: source.label,
        stale: source.stale,
        rowCount: table.rows.length,
        profile,
        normalized: normResult.normalizedRows,
        audit: normResult.audit,
        table: { columns: table.columns, rows: table.rows }
      });
    }
    return send(res, 200, {
      source: source.label,
      stale: source.stale,
      rowCount: table.rows.length,
      table: { columns: table.columns, rows: table.rows }
    });
  }

  return false;
}
