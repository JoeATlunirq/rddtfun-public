import { supabase } from '@/contexts/AuthContext';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function apiUrl(path: string) {
    if (/^https?:\/\//.test(path)) return path;
    return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Authentication required');

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);

    return fetch(apiUrl(path), { ...init, headers });
}

/**
 * Parses an API response body. In dev, the Vite proxy answers with an empty 500 while the
 * backend is down or restarting (nodemon), which `response.json()` reports as
 * "Unexpected end of JSON input"; this turns that into a readable error.
 */
export async function readJson(response: Response) {
    const text = await response.text();
    if (!text) {
        if (response.ok) return {};
        throw new Error(`The server didn't respond (HTTP ${response.status}). It may be restarting; try again in a moment.`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Unexpected server response (HTTP ${response.status})`);
    }
}
