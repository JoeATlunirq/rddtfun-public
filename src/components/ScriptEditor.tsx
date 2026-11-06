import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Loader2, MessageSquare, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    PERFORMANCE_LABELS, STATUS_INFO, STATUSES,
    type Script, type ScriptComment, type ScriptFormat, type ScriptPerformance, type ScriptStatus, type WorkspacePermissions,
} from '@/types/scripts';

type Draft = Pick<Script, 'title' | 'status' | 'format' | 'hook' | 'body' | 'tags' | 'edited_video_url'
    | 'source_video_url' | 'post_date' | 'goal' | 'performance'>;

const EMPTY: Draft = {
    title: '', status: 'scripting', format: 'short', hook: '', body: '', tags: [], edited_video_url: null,
    source_video_url: null, post_date: null, goal: null, performance: null,
};

const LINK_FIELDS = [
    ['edited_video_url', 'Edited video'],
    ['source_video_url', 'Source video'],
] as const;

const fieldClass = 'bg-[#1A1A1A] border-[#3A3A3A] text-white';

// Narration pace used for the rough length shown under the script
const WORDS_PER_MINUTE = 160;

interface ScriptEditorProps {
    /** Existing script, or null to create a new one */
    script: Script | null;
    defaultStatus: ScriptStatus;
    permissions: WorkspacePermissions;
    api: <T>(path: string, init?: RequestInit) => Promise<T>;
    boardId: string;
    onSaved: (script: Script) => void;
    onDeleted: (id: string) => void;
    onClose: () => void;
}

export default function ScriptEditor({ script, defaultStatus, permissions, api, boardId, onSaved, onDeleted, onClose }: ScriptEditorProps) {
    const [draft, setDraft] = useState<Draft>(() => (script ? { ...EMPTY, ...script } : { ...EMPTY, status: defaultStatus }));
    const [tagsText, setTagsText] = useState((script?.tags || []).join(', '));
    const [comments, setComments] = useState<ScriptComment[]>([]);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [posting, setPosting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const canEdit = script ? script.permissions.edit : permissions.createScripts;
    // A status the role can't set still shows (read-only) so the field never lies
    const statusOptions = STATUSES.filter(s => permissions.statuses.includes(s) || s === draft.status);

    const scriptId = script?.id;
    useEffect(() => {
        if (!scriptId) return;
        api<{ comments: ScriptComment[] }>(`/api/scripts/${scriptId}`)
            .then(body => setComments(body.comments))
            .catch(err => setError(err.message));
    }, [scriptId, api]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));

    const save = async (e?: FormEvent) => {
        e?.preventDefault();
        setSaving(true);
        setError(null);
        const payload = { ...draft, tags: tagsText.split(',').map(t => t.trim()).filter(Boolean) };
        try {
            const body = await api<{ script: Script }>(script ? `/api/scripts/${script.id}` : `/api/scripts/boards/${boardId}/scripts`, {
                method: script ? 'PUT' : 'POST',
                body: JSON.stringify(payload),
            });
            onSaved(body.script);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!script || !window.confirm(`Delete script #${script.number}${script.title ? ` "${script.title}"` : ''}?`)) return;
        try {
            await api(`/api/scripts/${script.id}`, { method: 'DELETE' });
            onDeleted(script.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete');
        }
    };

    const addComment = async (e?: { preventDefault(): void }) => {
        e?.preventDefault();
        if (!script || !comment.trim()) return;
        setPosting(true);
        try {
            const body = await api<{ comment: ScriptComment }>(`/api/scripts/${script.id}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body: comment }),
            });
            setComments(c => [...c, body.comment]);
            setComment('');
            onSaved({ ...script, comment_count: comments.length + 1 });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to comment');
        } finally {
            setPosting(false);
        }
    };

    const deleteComment = async (id: string) => {
        if (!script) return;
        try {
            await api(`/api/scripts/${script.id}/comments/${id}`, { method: 'DELETE' });
            setComments(c => c.filter(x => x.id !== id));
            onSaved({ ...script, comment_count: comments.length - 1 });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete comment');
        }
    };

    const copyScript = async () => {
        await navigator.clipboard.writeText([draft.hook, draft.body].filter(Boolean).join('\n\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const words = `${draft.hook} ${draft.body}`.trim().split(/\s+/).filter(Boolean).length;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <button type="button" className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close script" />
            <form onSubmit={save} className="relative flex h-full w-full max-w-2xl flex-col border-l border-[#3A3A3A] bg-[#1F1F1F] shadow-2xl">
                <div className="flex items-center justify-between gap-2 border-b border-[#3A3A3A] px-4 py-3 sm:px-6">
                    <div className="text-sm text-[#B8B9BC]">
                        {script ? `#${script.number}` : 'New script'}
                        {script?.author_email && <> · by {script.author_email}</>}
                    </div>
                    <div className="flex items-center gap-1">
                        {script?.permissions.delete && (
                            <Button type="button" variant="ghost" size="icon" onClick={remove} aria-label="Delete script"
                                className="text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        )}
                        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close"
                            className="text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
                    {error && <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
                    {!canEdit && (
                        <div className="rounded border border-[#3A3A3A] bg-[#2A2A2A] px-3 py-2 text-xs text-[#B8B9BC]">
                            Read only{permissions.role === 'scriptwriter' ? ': it has moved past To Edit or isn\'t yours' : ''}.
                        </div>
                    )}

                    <Input
                        value={draft.title}
                        onChange={e => set('title', e.target.value)}
                        placeholder="Untitled script"
                        disabled={!canEdit}
                        className="h-auto border-none bg-transparent px-0 text-2xl font-bold text-white placeholder:text-[#555] focus-visible:ring-0"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label className="text-xs text-[#B8B9BC]">Status</Label>
                            <Select value={draft.status} onValueChange={v => set('status', v as ScriptStatus)} disabled={!canEdit}>
                                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    {statusOptions.map(s => (
                                        <SelectItem key={s} value={s} disabled={!permissions.statuses.includes(s)} className="text-white">
                                            {STATUS_INFO[s].label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-[#B8B9BC]">Format</Label>
                            <Select value={draft.format} onValueChange={v => set('format', v as ScriptFormat)} disabled={!canEdit}>
                                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    <SelectItem value="short" className="text-white">Short form</SelectItem>
                                    <SelectItem value="long" className="text-white">Long form</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-[#B8B9BC]">Post date</Label>
                            <Input type="date" value={draft.post_date || ''} onChange={e => set('post_date', e.target.value || null)}
                                disabled={!canEdit} className={fieldClass} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-[#B8B9BC]">Performance</Label>
                            <Select value={draft.performance || 'none'} onValueChange={v => set('performance', v === 'none' ? null : v as ScriptPerformance)}
                                disabled={!canEdit}>
                                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    <SelectItem value="none" className="text-white">Not posted yet</SelectItem>
                                    {(Object.keys(PERFORMANCE_LABELS) as ScriptPerformance[]).map(p => (
                                        <SelectItem key={p} value={p} className="text-white">{PERFORMANCE_LABELS[p]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs text-[#B8B9BC]">Goal</Label>
                            <Input value={draft.goal || ''} onChange={e => set('goal', e.target.value)} disabled={!canEdit}
                                placeholder="e.g. test new hook style, 100k views" className={fieldClass} />
                        </div>
                        {LINK_FIELDS.map(([key, label]) => (
                            <div key={key} className="space-y-1 sm:col-span-2">
                                <Label className="text-xs text-[#B8B9BC]">{label}</Label>
                                <div className="flex gap-2">
                                    <Input value={draft[key] || ''} onChange={e => set(key, e.target.value || null)} disabled={!canEdit}
                                        placeholder="https://" className={fieldClass} />
                                    {draft[key] && /^https?:\/\//.test(draft[key]!) && (
                                        <a href={draft[key]!} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#3A3A3A] text-[#B8B9BC] hover:text-white">
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs text-[#B8B9BC]">Tags (comma separated)</Label>
                            <Input value={tagsText} onChange={e => setTagsText(e.target.value)} disabled={!canEdit}
                                placeholder="POV: male, grm 2.0" className={fieldClass} />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#F97316]">Hook</Label>
                        <Textarea value={draft.hook} onChange={e => set('hook', e.target.value)} disabled={!canEdit} rows={4}
                            placeholder="The first lines viewers hear…" className={fieldClass} />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-[#F97316]">Script</Label>
                            <span className="text-xs text-[#B8B9BC]">
                                {words.toLocaleString()} words · ~{Math.max(1, Math.round((words / WORDS_PER_MINUTE) * 60))}s narrated
                            </span>
                        </div>
                        <Textarea value={draft.body} onChange={e => set('body', e.target.value)} disabled={!canEdit} rows={14}
                            placeholder="The story…" className={fieldClass} />
                    </div>

                    {script && (
                        <div className="space-y-3 border-t border-[#3A3A3A] pt-4">
                            <div className="flex items-center gap-2 text-sm font-medium text-white">
                                <MessageSquare className="h-4 w-4" /> Comments
                            </div>
                            {comments.map(c => (
                                <div key={c.id} className="group rounded bg-[#2A2A2A] px-3 py-2">
                                    <div className="flex items-center justify-between gap-2 text-xs text-[#B8B9BC]">
                                        <span>{c.author_email || 'Teammate'} · {new Date(c.created_at).toLocaleString()}</span>
                                        {c.can_delete && (
                                            <button type="button" onClick={() => deleteComment(c.id)} aria-label="Delete comment"
                                                className="text-[#777] hover:text-red-400">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-white">{c.body}</p>
                                </div>
                            ))}
                            {permissions.comment && (
                                <div className="flex gap-2">
                                    <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                                        placeholder="Add a comment…" className={fieldClass}
                                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(e); }} />
                                    <Button type="button" onClick={() => addComment()} disabled={posting || !comment.trim()}
                                        className="self-end bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]">
                                        {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post'}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[#3A3A3A] px-4 py-3 sm:px-6">
                    <Button type="button" variant="ghost" onClick={copyScript} className="text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white">
                        <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy hook + script'}
                    </Button>
                    {canEdit && (
                        <Button type="submit" disabled={saving} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {script ? 'Save' : 'Add script'}
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
}
