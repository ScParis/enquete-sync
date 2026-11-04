import { parseHeaderAndSample } from './source-inspector.mjs';
import {
  createSuggestedProfile,
  validateProfileAgainstStructure,
  normalizeTable,
  profileFitsUse,
  TARGET_MODELS
} from './mapping-engine.mjs';
import { parseCsvTable, parseCsv } from './data.mjs';

/**
 * Resolve e normaliza uma fonte tabular (CSV/XLSX) aplicando o perfil adequado de mapeamento.
 * Unifica a lógica repetida em /api/tasks, /api/mappings/plan, /api/mappings/preview e /api/mappings/apply.
 * 
 * @param {object} payload
 * @param {{ loadSource: Function, savedProfiles?: Array, defaultModel?: string }} options
 * @returns {Promise<{
 *   source: { csv: string, label: string, stale: boolean },
 *   sheetId: string,
 *   structure: object,
 *   profile: object | null,
 *   table: { columns: string[], rows: string[][] },
 *   rows: Array<object>,
 *   audit: object | null
 * }>}
 */
export async function resolveNormalizedSource(payload, {
  loadSource,
  savedProfiles = [],
  defaultModel = 'enquete_automacao'
}) {
  const source = await loadSource(payload);
  const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
  const structure = parseHeaderAndSample(source.csv, { headerRow: payload.headerRow ?? 1 });
  const accountId = payload.accountId ? String(payload.accountId).trim() : '';

  let profile = payload.profile ?? savedProfiles.find(p =>
    p.accountId === accountId &&
    profileFitsUse(p, defaultModel) &&
    (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId)
  );

  if (profile) {
    const val = validateProfileAgainstStructure(profile, structure);
    if (!val.valid) {
      const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, defaultModel);
      const valSug = validateProfileAgainstStructure(suggested, structure);
      if (valSug.valid) profile = suggested;
    }
  } else {
    const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, defaultModel);
    const valSug = validateProfileAgainstStructure(suggested, structure);
    if (valSug.valid) profile = suggested;
  }

  const table = parseCsvTable(source.csv);
  let rows = [];
  let audit = null;

  if (profile) {
    const normResult = normalizeTable(table, profile);
    rows = normResult.normalizedRows;
    audit = normResult.audit;
  } else {
    rows = parseCsv(source.csv);
  }

  return {
    source,
    sheetId,
    structure,
    profile,
    table,
    rows,
    audit
  };
}
