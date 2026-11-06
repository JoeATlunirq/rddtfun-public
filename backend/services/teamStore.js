import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Row storage for the team + Script board tables. Same small interface over Supabase and a
// JSON file, so the app works before 20261103120000_add_team_and_scripts.sql is applied.
// Filters are plain equality matches ({ column: value }).
export const TEAM_TABLES = ['team_members', 'script_boards', 'scripts', 'script_comments'];

function matches(row, match) {
    return Object.entries(match).every(([key, value]) => row[key] === value);
}

export function createFileStore(file) {
    const read = () => {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return {};
        }
    };
    const write = data => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
    };
    const rows = (data, table) => (data[table] ||= []);

    return {
        kind: 'file',
        async list(table, match = {}) {
            return rows(read(), table).filter(row => matches(row, match));
        },
        async get(table, match) {
            return rows(read(), table).find(row => matches(row, match)) || null;
        },
        async insert(table, values) {
            const data = read();
            const now = new Date().toISOString();
            const row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...values };
            rows(data, table).push(row);
            write(data);
            return row;
        },
        async update(table, id, patch) {
            const data = read();
            const row = rows(data, table).find(r => r.id === id);
            if (!row) return null;
            Object.assign(row, patch, { updated_at: new Date().toISOString() });
            write(data);
            return row;
        },
        async remove(table, match) {
            const data = read();
            data[table] = rows(data, table).filter(row => !matches(row, match));
            // Same cascades as the SQL foreign keys
            if (table === 'script_boards' && match.id) {
                const gone = new Set(rows(data, 'scripts').filter(s => s.board_id === match.id).map(s => s.id));
                data.scripts = rows(data, 'scripts').filter(s => !gone.has(s.id));
                data.script_comments = rows(data, 'script_comments').filter(c => !gone.has(c.script_id));
            }
            if (table === 'scripts' && match.id) {
                data.script_comments = rows(data, 'script_comments').filter(c => c.script_id !== match.id);
            }
            write(data);
        },
    };
}

export function createSupabaseStore(supabase) {
    const check = ({ data, error }) => {
        if (error) throw new Error(error.message);
        return data;
    };
    return {
        kind: 'supabase',
        async list(table, match = {}) {
            return check(await supabase.from(table).select('*').match(match)) || [];
        },
        async get(table, match) {
            return check(await supabase.from(table).select('*').match(match).maybeSingle());
        },
        async insert(table, values) {
            return check(await supabase.from(table).insert(values).select().single());
        },
        async update(table, id, patch) {
            return check(await supabase.from(table).update(patch).eq('id', id).select().maybeSingle());
        },
        async remove(table, match) {
            check(await supabase.from(table).delete().match(match));
        },
    };
}

function isMissingTableError(error) {
    const code = error?.code || '';
    return code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(error?.message || '');
}

/** Supabase when the team tables exist, else the JSON file (logged once at startup). */
export async function resolveTeamStore({ supabase, file }) {
    if (supabase) {
        const { error } = await supabase.from('team_members').select('id').limit(1);
        if (!error) return createSupabaseStore(supabase);
        if (!isMissingTableError(error)) throw new Error(error.message);
        console.warn('[Team] Supabase team tables are missing (run 20261103120000_add_team_and_scripts.sql); using', file);
    }
    return createFileStore(file);
}
