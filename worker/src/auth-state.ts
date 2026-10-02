import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys';
import { check, db } from './db.js';

const CREDS_KEY = 'creds';

const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
const deserialize = (value: unknown) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);

/**
 * Guarda a sessão do WhatsApp (Baileys) no Postgres, na tabela wa_auth_state.
 * Assim o worker pode ser reiniciado/reimplantado na nuvem sem precisar
 * ler o QR code novamente.
 */
export async function usePostgresAuthState(instanceId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const read = async (key: string) => {
    const res = await db
      .from('wa_auth_state')
      .select('value')
      .eq('instance_id', instanceId)
      .eq('key', key)
      .maybeSingle();
    const row = check(res, 'auth-state read');
    return row ? deserialize(row.value) : null;
  };

  const creds: AuthenticationCreds = (await read(CREDS_KEY)) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          if (ids.length === 0) return result;
          const res = await db
            .from('wa_auth_state')
            .select('key, value')
            .eq('instance_id', instanceId)
            .in(
              'key',
              ids.map((id) => `${type}-${id}`),
            );
          const rows = check(res, 'auth-state keys.get') ?? [];
          for (const row of rows) {
            const id = row.key.slice(type.length + 1);
            let value = deserialize(row.value);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          const upserts: { instance_id: string; key: string; value: unknown; updated_at: string }[] = [];
          const deletes: string[] = [];
          const now = new Date().toISOString();
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const entries = data[category] ?? {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const key = `${category}-${id}`;
              if (value) upserts.push({ instance_id: instanceId, key, value: serialize(value), updated_at: now });
              else deletes.push(key);
            }
          }
          if (upserts.length) {
            check(await db.from('wa_auth_state').upsert(upserts), 'auth-state keys.set');
          }
          if (deletes.length) {
            check(
              await db.from('wa_auth_state').delete().eq('instance_id', instanceId).in('key', deletes),
              'auth-state keys.delete',
            );
          }
        },
      },
    },
    saveCreds: async () => {
      check(
        await db.from('wa_auth_state').upsert({
          instance_id: instanceId,
          key: CREDS_KEY,
          value: serialize(creds),
          updated_at: new Date().toISOString(),
        }),
        'auth-state saveCreds',
      );
    },
  };
}

export async function clearAuthState(instanceId: string) {
  check(await db.from('wa_auth_state').delete().eq('instance_id', instanceId), 'auth-state clear');
}

export async function hasAuthState(instanceId: string) {
  const res = await db
    .from('wa_auth_state')
    .select('key')
    .eq('instance_id', instanceId)
    .eq('key', CREDS_KEY)
    .maybeSingle();
  return Boolean(check(res, 'auth-state exists'));
}
