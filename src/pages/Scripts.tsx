import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
    CalendarDays, ChevronDown, ChevronRight, Columns3, Link2, Loader2, MessageSquare, Pencil, Plus, Search, Table2, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ScriptEditor from '@/components/ScriptEditor';
import { apiFetch, readJson } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    PERFORMANCE_LABELS, ROLE_INFO, STATUS_INFO, STATUSES,
    type ChannelSummary, type Script, type ScriptBoard, type ScriptStatus, type Workspace, type WorkspacePermissions,
} from '@/types/scripts';

const WORKSPACE_KEY = 'rddtfun_scripts_workspace';
const BOARD_KEY = 'rddtfun_scripts_board';
const VIEW_KEY = 'rddtfun_scripts_view';
const BOARD_COLUMNS: ScriptStatus[] = ['scripting', 'to_edit', 'to_post'];
const fieldClass = 'bg-[#1A1A1A] border-[#3A3A3A] text-white';

type SortKey = 'number' | 'post_date' | 'updated';
type View = 'board' | 'table';

function stored(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function formatDate(date: string | null) {
    if (!date) return null;
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ScriptCard({ script, draggable, onOpen, onDragStart }: {
    script: Script; draggable: boolean; onOpen: () => void; onDragStart: (e: DragEvent) => void;
}) {
    return (
        <button
            type="button"
            draggable={draggable}
            onDragStart={onDragStart}
            onClick={onOpen}
            className="w-full space-y-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-3 text-left transition-colors hover:border-[#F97316]/60"
        >
            <div className="flex items-start gap-2">
                <span className="text-sm font-semibold text-[#B8B9BC]">{script.number}</span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-white">{script.title || script.hook.slice(0, 80) || 'Untitled'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded bg-[#3A3A3A] px-1.5 py-0.5 text-[#D0D0D0]">{script.format === 'long' ? 'Long form' : 'Short form'}</span>
                {script.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="rounded bg-[#F97316]/15 px-1.5 py-0.5 text-[#FDBA74]">{tag}</span>
                ))}
                {script.performance && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">{PERFORMANCE_LABELS[script.performance]}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-[#8A8B8E]">
                {script.post_date && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDate(script.post_date)}</span>}
                {script.comment_count > 0 && <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{script.comment_count}</span>}
                {script.edited_video_url && <span className="flex items-center gap-1"><Link2 className="h-3 w-3" />Edit</span>}
                {script.author_email && <span className="ml-auto truncate">{script.author_email.split('@')[0]}</span>}
            </div>
        </button>
    );
}

function BoardForm({ initial, channels, onSubmit, onCancel, onDelete }: {
    initial?: ScriptBoard;
    channels: ChannelSummary[];
    onSubmit: (values: { name: string; channel_profile_id: string | null }) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
}) {
    const [name, setName] = useState(initial?.name || '');
    const [channelId, setChannelId] = useState(initial?.channel_profile_id || 'none');
    const [saving, setSaving] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await onSubmit({ name, channel_profile_id: channelId === 'none' ? null : channelId });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-3 sm:flex-row sm:items-center">
            <Select
                value={channelId}
                onValueChange={v => {
                    setChannelId(v);
                    const channel = channels.find(c => c.id === v);
                    if (channel && !name.trim()) setName(channel.name);
                }}
            >
                <SelectTrigger className={cn(fieldClass, 'sm:w-56')}><SelectValue placeholder="Channel" /></SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <SelectItem value="none" className="text-white">No linked channel</SelectItem>
                    {channels.map(c => <SelectItem key={c.id} value={c.id} className="text-white">{c.name}</SelectItem>)}
                </SelectContent>
            </Select>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Board name (e.g. Billy Diaries)" className={fieldClass} required />
            <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : initial ? 'Save' : 'Add board'}
                </Button>
                {onDelete && (
                    <Button type="button" variant="ghost" size="icon" onClick={onDelete} aria-label="Delete board"
                        className="text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
                <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel"
                    className="text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white">
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </form>
    );
}

export default function Scripts() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [boards, setBoards] = useState<ScriptBoard[]>([]);
    const [channels, setChannels] = useState<ChannelSummary[]>([]);
    const [permissions, setPermissions] = useState<WorkspacePermissions | null>(null);
    const [boardId, setBoardId] = useState<string | null>(null);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingScripts, setLoadingScripts] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [boardForm, setBoardForm] = useState<'new' | 'edit' | null>(null);

    const [view, setView] = useState<View>(() => (stored(VIEW_KEY) === 'table' ? 'table' : 'board'));
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | ScriptStatus>('all');
    const [formatFilter, setFormatFilter] = useState<'all' | 'short' | 'long'>('all');
    const [tagFilter, setTagFilter] = useState('all');
    const [sort, setSort] = useState<SortKey>('number');
    const [showPosted, setShowPosted] = useState(false);
    const [dragOver, setDragOver] = useState<ScriptStatus | null>(null);

    const [editing, setEditing] = useState<{ script: Script | null; status: ScriptStatus } | null>(null);

    const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
        const headers = new Headers(init.headers);
        if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
        if (init.body) headers.set('Content-Type', 'application/json');
        const response = await apiFetch(path, { ...init, headers });
        const body = await readJson(response);
        if (!response.ok) throw new Error(body.error || 'Request failed');
        return body;
    }, [workspaceId]);

    // Workspaces this account can open (its own, plus teams it joined)
    useEffect(() => {
        (async () => {
            try {
                const response = await apiFetch('/api/team/workspaces');
                const body = await readJson(response);
                if (!response.ok) throw new Error(body.error || 'Failed to load workspaces');
                const list: Workspace[] = body.workspaces;
                setWorkspaces(list);
                const saved = stored(WORKSPACE_KEY);
                setWorkspaceId(list.find(w => w.owner_id === saved)?.owner_id || list[0]?.owner_id || null);
                if (!list.length) setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load workspaces');
                setLoading(false);
            }
        })();
    }, []);

    const loadBoards = useCallback(async () => {
        if (!workspaceId) return;
        try {
            const body = await api<{ boards: ScriptBoard[]; channels: ChannelSummary[]; permissions: WorkspacePermissions }>('/api/scripts/boards');
            setBoards(body.boards);
            setChannels(body.channels);
            setPermissions(body.permissions);
            setBoardId(current => {
                const keep = body.boards.find(b => b.id === (current || stored(BOARD_KEY)));
                return keep?.id || body.boards[0]?.id || null;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load boards');
        } finally {
            setLoading(false);
        }
    }, [api, workspaceId]);

    useEffect(() => {
        setBoardId(null);
        setScripts([]);
        loadBoards();
    }, [loadBoards]);

    useEffect(() => {
        if (!boardId) return;
        store(BOARD_KEY, boardId);
        setLoadingScripts(true);
        api<{ scripts: Script[] }>(`/api/scripts/boards/${boardId}/scripts`)
            .then(body => setScripts(body.scripts))
            .catch(err => setError(err.message))
            .finally(() => setLoadingScripts(false));
    }, [api, boardId]);

    const board = boards.find(b => b.id === boardId) || null;
    const tags = useMemo(() => [...new Set(scripts.flatMap(s => s.tags))].sort(), [scripts]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = scripts.filter(s =>
            (statusFilter === 'all' || s.status === statusFilter)
            && (formatFilter === 'all' || s.format === formatFilter)
            && (tagFilter === 'all' || s.tags.includes(tagFilter))
            && (!q || [String(s.number), s.title, s.hook, s.body, s.goal || '', ...s.tags].some(v => v.toLowerCase().includes(q))));
        const by: Record<SortKey, (a: Script, b: Script) => number> = {
            number: (a, b) => a.number - b.number,
            post_date: (a, b) => (a.post_date || '9999').localeCompare(b.post_date || '9999') || a.number - b.number,
            updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
        };
        return list.sort(by[sort]);
    }, [scripts, query, statusFilter, formatFilter, tagFilter, sort]);

    const upsert = (script: Script) => setScripts(list => (list.some(s => s.id === script.id)
        ? list.map(s => (s.id === script.id ? script : s))
        : [...list, script]));

    const moveScript = async (script: Script, status: ScriptStatus) => {
        if (script.status === status) return;
        upsert({ ...script, status });
        try {
            upsert((await api<{ script: Script }>(`/api/scripts/${script.id}`, { method: 'PUT', body: JSON.stringify({ status }) })).script);
        } catch (err) {
            upsert(script);
            setError(err instanceof Error ? err.message : 'Failed to move script');
        }
    };

    const canDrop = (status: ScriptStatus) => !!permissions?.statuses.includes(status);

    const onDrop = (e: DragEvent, status: ScriptStatus) => {
        e.preventDefault();
        setDragOver(null);
        const script = scripts.find(s => s.id === e.dataTransfer.getData('text/script-id'));
        if (script && canDrop(status)) moveScript(script, status);
    };

    const saveBoard = async (values: { name: string; channel_profile_id: string | null }) => {
        setError(null);
        try {
            if (boardForm === 'edit' && board) {
                await api(`/api/scripts/boards/${board.id}`, { method: 'PUT', body: JSON.stringify(values) });
            } else {
                const body = await api<{ board: ScriptBoard }>('/api/scripts/boards', { method: 'POST', body: JSON.stringify(values) });
                setBoardId(body.board.id);
            }
            setBoardForm(null);
            await loadBoards();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save board');
        }
    };

    const deleteBoard = async () => {
        if (!board || !window.confirm(`Delete the "${board.name}" board and all ${scripts.length} of its scripts?`)) return;
        try {
            await api(`/api/scripts/boards/${board.id}`, { method: 'DELETE' });
            setBoardForm(null);
            setBoardId(null);
            await loadBoards();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete board');
        }
    };

    const pickWorkspace = (id: string) => {
        store(WORKSPACE_KEY, id);
        setLoading(true);
        setWorkspaceId(id);
    };

    const pickView = (next: View) => {
        store(VIEW_KEY, next);
        setView(next);
    };

    if (loading) {
        return <div className="flex items-center gap-2 text-[#B8B9BC]"><Loader2 className="h-4 w-4 animate-spin" /> Loading scripts…</div>;
    }

    if (!workspaces.length) {
        return (
            <div className="rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-6 text-[#B8B9BC]">
                {error || "You're not on any team yet. Ask the account owner for a new invite link."}
            </div>
        );
    }

    const workspace = workspaces.find(w => w.owner_id === workspaceId);
    const columns: ScriptStatus[] = showPosted ? [...BOARD_COLUMNS, 'posted'] : BOARD_COLUMNS;
    const postedCount = visible.filter(s => s.status === 'posted').length;

    return (
        <div className="space-y-5">
            {/* Workspace + boards */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    {boards.map(b => (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => { setBoardId(b.id); setBoardForm(null); }}
                            className={cn(
                                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                b.id === boardId
                                    ? 'border-[#F97316] bg-[#F97316]/15 text-white'
                                    : 'border-[#3A3A3A] text-[#B8B9BC] hover:border-[#555] hover:text-white'
                            )}
                        >
                            {b.channel?.image_url && <img src={b.channel.image_url} alt="" className="h-5 w-5 rounded-full object-cover" />}
                            {b.name}
                        </button>
                    ))}
                    {permissions?.manageBoards && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setBoardForm('new')}
                            className="text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white">
                            <Plus className="h-4 w-4" /> Board
                        </Button>
                    )}
                </div>
                {workspaces.length > 1 && (
                    <Select value={workspaceId || undefined} onValueChange={pickWorkspace}>
                        <SelectTrigger className={cn(fieldClass, 'lg:w-72')}><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                            {workspaces.map(w => (
                                <SelectItem key={w.owner_id} value={w.owner_id} className="text-white">
                                    {w.role === 'owner' ? 'My workspace' : w.owner_email || 'Team workspace'} · {ROLE_INFO[w.role].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {boardForm && (
                <BoardForm
                    key={boardForm + (board?.id || '')}
                    initial={boardForm === 'edit' ? board || undefined : undefined}
                    channels={channels}
                    onSubmit={saveBoard}
                    onCancel={() => setBoardForm(null)}
                    onDelete={boardForm === 'edit' ? deleteBoard : undefined}
                />
            )}

            {error && (
                <div className="flex items-center justify-between rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-400">
                    {error}
                    <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
                </div>
            )}

            {!board ? (
                <div className="rounded-lg border border-dashed border-[#3A3A3A] p-8 text-center text-[#B8B9BC]">
                    {permissions?.manageBoards
                        ? <>Add a board for each channel (e.g. one for Billy Diaries) and your team can start dropping scripts in.
                            {!channels.length && <> Channels come from <Link to="/settings" className="text-[#F97316] hover:underline">Settings → Channel Profiles</Link>.</>}</>
                        : 'No boards yet. The owner or an editor needs to add one.'}
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-2xl font-bold text-white sm:text-3xl">YouTube videos for {board.name}</h1>
                        {permissions?.manageBoards && (
                            <button type="button" onClick={() => setBoardForm('edit')} aria-label="Edit board"
                                className="text-[#8A8B8E] hover:text-white"><Pencil className="h-4 w-4" /></button>
                        )}
                        {workspace && workspace.role !== 'owner' && (
                            <span className="rounded-full bg-[#2A2A2A] px-2.5 py-1 text-xs text-[#B8B9BC]">You're a {ROLE_INFO[workspace.role].label.toLowerCase()}</span>
                        )}
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                        <div className="flex rounded-lg border border-[#3A3A3A] p-0.5">
                            {([['board', 'Board', Columns3], ['table', 'Table', Table2]] as const).map(([key, label, Icon]) => (
                                <button key={key} type="button" onClick={() => pickView(key)}
                                    className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                                        view === key ? 'bg-[#2A2A2A] text-white' : 'text-[#8A8B8E] hover:text-white')}>
                                    <Icon className="h-4 w-4" /> {label}
                                </button>
                            ))}
                        </div>
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8B8E]" />
                            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search number, title, script, tags…"
                                className={cn(fieldClass, 'pl-9')} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex">
                            {view === 'table' && (
                                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
                                    <SelectTrigger className={cn(fieldClass, 'sm:w-36')}><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                        <SelectItem value="all" className="text-white">All statuses</SelectItem>
                                        {STATUSES.map(s => <SelectItem key={s} value={s} className="text-white">{STATUS_INFO[s].label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            )}
                            <Select value={formatFilter} onValueChange={v => setFormatFilter(v as typeof formatFilter)}>
                                <SelectTrigger className={cn(fieldClass, 'sm:w-36')}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    <SelectItem value="all" className="text-white">All formats</SelectItem>
                                    <SelectItem value="short" className="text-white">Short form</SelectItem>
                                    <SelectItem value="long" className="text-white">Long form</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={tagFilter} onValueChange={setTagFilter}>
                                <SelectTrigger className={cn(fieldClass, 'sm:w-36')}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    <SelectItem value="all" className="text-white">All tags</SelectItem>
                                    {tags.map(t => <SelectItem key={t} value={t} className="text-white">{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
                                <SelectTrigger className={cn(fieldClass, 'sm:w-40')}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    <SelectItem value="number" className="text-white">Sort: Number</SelectItem>
                                    <SelectItem value="post_date" className="text-white">Sort: Post date</SelectItem>
                                    <SelectItem value="updated" className="text-white">Sort: Last edited</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {permissions?.createScripts && (
                            <Button type="button" onClick={() => setEditing({ script: null, status: 'scripting' })}
                                className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                <Plus className="h-4 w-4" /> New
                            </Button>
                        )}
                    </div>

                    {loadingScripts && <div className="flex items-center gap-2 text-sm text-[#B8B9BC]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

                    {view === 'board' ? (
                        <div className="flex gap-3 overflow-x-auto pb-2">
                            {columns.map(status => {
                                const items = visible.filter(s => s.status === status);
                                return (
                                    <div
                                        key={status}
                                        onDragOver={e => { if (canDrop(status)) { e.preventDefault(); setDragOver(status); } }}
                                        onDragLeave={() => setDragOver(s => (s === status ? null : s))}
                                        onDrop={e => onDrop(e, status)}
                                        className={cn('flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2', STATUS_INFO[status].column,
                                            dragOver === status && 'ring-2 ring-[#F97316]/60')}
                                    >
                                        <div className="flex items-center justify-between px-1 py-1">
                                            <span className="flex items-center gap-2 text-sm font-medium text-white">
                                                <span className={cn('h-2 w-2 rounded-full', STATUS_INFO[status].dot)} />
                                                {STATUS_INFO[status].label}
                                                <span className="text-[#8A8B8E]">{items.length}</span>
                                            </span>
                                            {status === 'posted' && (
                                                <button type="button" onClick={() => setShowPosted(false)} aria-label="Collapse Posted"
                                                    className="text-[#8A8B8E] hover:text-white"><ChevronDown className="h-4 w-4" /></button>
                                            )}
                                        </div>
                                        {items.map(script => (
                                            <ScriptCard
                                                key={script.id}
                                                script={script}
                                                draggable={script.permissions.edit && permissions!.statuses.length > 0}
                                                onDragStart={e => e.dataTransfer.setData('text/script-id', script.id)}
                                                onOpen={() => setEditing({ script, status: script.status })}
                                            />
                                        ))}
                                        {permissions?.createScripts && permissions.statuses.includes(status) && (
                                            <button type="button" onClick={() => setEditing({ script: null, status })}
                                                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#8A8B8E] hover:bg-[#2A2A2A] hover:text-white">
                                                <Plus className="h-4 w-4" /> New script
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                            {!showPosted && (
                                <button
                                    type="button"
                                    onClick={() => setShowPosted(true)}
                                    onDragOver={e => { if (canDrop('posted')) { e.preventDefault(); setDragOver('posted'); } }}
                                    onDragLeave={() => setDragOver(null)}
                                    onDrop={e => onDrop(e, 'posted')}
                                    className={cn('flex h-fit shrink-0 items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-400/20',
                                        dragOver === 'posted' && 'ring-2 ring-[#F97316]/60')}
                                >
                                    <ChevronRight className="h-4 w-4" /> Posted <span className="text-emerald-200/70">{postedCount}</span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-[#3A3A3A]">
                            <table className="w-full min-w-[900px] text-left text-sm">
                                <thead className="bg-[#2A2A2A] text-xs uppercase text-[#8A8B8E]">
                                    <tr>
                                        {['#', 'Title', 'Status', 'Format', 'Post date', 'Goal', 'Performance', 'Tags', 'Links', 'Writer'].map(h => (
                                            <th key={h} className="px-3 py-2 font-medium">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#3A3A3A]">
                                    {visible.map(s => (
                                        <tr key={s.id} onClick={() => setEditing({ script: s, status: s.status })}
                                            className="cursor-pointer text-[#D0D0D0] hover:bg-[#2A2A2A]">
                                            <td className="px-3 py-2 text-[#8A8B8E]">{s.number}</td>
                                            <td className="max-w-xs truncate px-3 py-2 font-medium text-white">{s.title || s.hook.slice(0, 60) || 'Untitled'}</td>
                                            <td className="px-3 py-2">
                                                <span className="flex items-center gap-1.5 whitespace-nowrap">
                                                    <span className={cn('h-2 w-2 rounded-full', STATUS_INFO[s.status].dot)} />{STATUS_INFO[s.status].label}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2">{s.format === 'long' ? 'Long' : 'Short'}</td>
                                            <td className="whitespace-nowrap px-3 py-2">{formatDate(s.post_date) || '—'}</td>
                                            <td className="max-w-[160px] truncate px-3 py-2">{s.goal || '—'}</td>
                                            <td className="px-3 py-2">{s.performance ? PERFORMANCE_LABELS[s.performance] : '—'}</td>
                                            <td className="max-w-[160px] truncate px-3 py-2">{s.tags.join(', ') || '—'}</td>
                                            <td className="px-3 py-2">
                                                <span className="flex gap-2" onClick={e => e.stopPropagation()}>
                                                    {([['edited_video_url', 'Edited'], ['source_video_url', 'Source']] as const).map(([key, label]) => (
                                                        s[key] ? <a key={key} href={s[key]!} target="_blank" rel="noreferrer" className="text-[#F97316] hover:underline">{label}</a> : null
                                                    ))}
                                                </span>
                                            </td>
                                            <td className="max-w-[140px] truncate px-3 py-2">{s.author_email?.split('@')[0] || '—'}</td>
                                        </tr>
                                    ))}
                                    {!visible.length && (
                                        <tr><td colSpan={10} className="px-3 py-8 text-center text-[#8A8B8E]">No scripts match.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {editing && board && permissions && (
                <ScriptEditor
                    key={editing.script?.id || 'new'}
                    script={editing.script}
                    defaultStatus={editing.status}
                    permissions={permissions}
                    api={api}
                    boardId={board.id}
                    onSaved={script => { upsert(script); setEditing(e => (e ? { ...e, script } : e)); }}
                    onDeleted={id => { setScripts(list => list.filter(s => s.id !== id)); setEditing(null); }}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}
