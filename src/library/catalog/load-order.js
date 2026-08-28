import { recordKey } from '../records/record-utils.js';

/** Apply object-record override semantics in explicit low-to-high load order. */
export function resolveLoadOrder(plugins) {
  const identities = new Map();
  for (const [index, plugin] of (plugins || []).entries()) {
    for (const record of plugin.records || []) {
      const key = recordKey(record);
      if (!key || key === ':') continue;
      let identity = identities.get(key);
      if (!identity) {
        identity = { key, overrides: [], winningRecord: null };
        identities.set(key, identity);
      }
      const occurrence = {
        record,
        pluginId: plugin.id,
        pluginName: plugin.filename || plugin.name || plugin.id,
        loadOrder: index,
      };
      identity.overrides.push(occurrence);
      identity.winningRecord = occurrence;
    }
  }

  const records = [];
  for (const identity of identities.values()) {
    const winner = identity.winningRecord;
    winner.record.metadata = {
      ...(winner.record.metadata || {}),
      loadOrder: {
        winningPlugin: winner.pluginName,
        winningPluginId: winner.pluginId,
        overrides: identity.overrides.map((entry) => ({
          plugin: entry.pluginName,
          pluginId: entry.pluginId,
          loadOrder: entry.loadOrder,
          deleted: !!(entry.record.raw?.deleted || entry.record.metadata?.plugin?.deleted),
        })),
      },
    };
    if (!winner.record.raw?.deleted && !winner.record.metadata?.plugin?.deleted) records.push(winner.record);
  }
  return { records, identities };
}

export function movePlugin(plugins, from, to) {
  const result = [...plugins];
  if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [value] = result.splice(from, 1);
  result.splice(to, 0, value);
  return result;
}
