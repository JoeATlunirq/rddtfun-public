import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Calendar, Check, Clock, Copy, Database, ExternalLink, Eye, FileText, FolderPlus, KeyRound, MessageSquare, Pencil, Plus, RefreshCw, Save, Search, ThumbsUp, Trash2, TrendingUp, Users, X, Youtube } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';

interface ResearchGroup {
    id: string;
    name: string;
    created_at: string;
}

interface SavedChannel {
    id: string;
    channelId: string;
    handle: string | null;
    title: string;
    thumbnailUrl: string | null;
}

type ResearchChannel = Omit<SavedChannel, 'id'>;

interface ResearchVideo {
    id: string;
    channelId: string;
    channelTitle: string | null;
    channelHandle: string | null;
    channelThumbnailUrl: string | null;
    title: string;
    description: string;
    publishedAt: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number;
    views: number;
    likes: number;
    comments: number;
    isShort: boolean;
    outlierScore: number | null;
    averageViews: number | null;
}

interface ResearchResult {
    channels: ResearchChannel[];
    videos: ResearchVideo[];
    errors: Array<{ channelId: string; title: string; message: string }>;
}

interface ResearchConfig {
    viewstatsConfigured: boolean;
    youtubeKeyCount: number;
}

type Source = 'viewstats' | 'youtube';
type Timeframe = '7d' | '28d' | '90d' | '365d' | 'max';
type VideoType = 'all' | 'long' | 'short';
type Sort = 'views' | 'recent' | 'oldest' | 'likes' | 'comments' | 'engagement' | 'outlier';
type UploadDate = 'any' | '24h' | '7d' | '30d' | '90d';

const emptyResult: ResearchResult = { channels: [], videos: [], errors: [] };

function formatNumber(value: number | null | undefined, signed = false) {
    if (value === null || value === undefined) return '—';
    const sign = signed && value > 0 ? '+' : '';
    if (Math.abs(value) >= 1_000_000_000) return `${sign}${(value / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(value) >= 1_000_000) return `${sign}${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${sign}${(value / 1_000).toFixed(1)}K`;
    return `${sign}${value.toLocaleString()}`;
}

function formatDuration(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = Math.floor(seconds % 60);
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
        : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

async function readResponse<T>(response: Response): Promise<T> {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

export default function Research() {
    const [source, setSource] = useState<Source>('viewstats');
    const [timeframe, setTimeframe] = useState<Timeframe>('28d');
    const [groups, setGroups] = useState<ResearchGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [newGroupName, setNewGroupName] = useState('');
    const [channels, setChannels] = useState<SavedChannel[]>([]);
    const [config, setConfig] = useState<ResearchConfig>({ viewstatsConfigured: false, youtubeKeyCount: 0 });
    const [identifier, setIdentifier] = useState('');
    const [primaryKey, setPrimaryKey] = useState('');
    const [backupKey, setBackupKey] = useState('');
    const [result, setResult] = useState<ResearchResult>(emptyResult);
    const [search, setSearch] = useState('');
    const [videoType, setVideoType] = useState<VideoType>('all');
    const [uploadDate, setUploadDate] = useState<UploadDate>('any');
    const [sort, setSort] = useState<Sort>('views');
    const [minViews, setMinViews] = useState('');
    const [maxViews, setMaxViews] = useState('');
    const [minLikes, setMinLikes] = useState('');
    const [minComments, setMinComments] = useState('');
    const [minEngagement, setMinEngagement] = useState('');
    const [minDuration, setMinDuration] = useState('');
    const [maxDuration, setMaxDuration] = useState('');
    const [loading, setLoading] = useState(true);
    const [savingGroup, setSavingGroup] = useState(false);
    const [adding, setAdding] = useState(false);
    const [researching, setResearching] = useState(false);
    const [savingKeys, setSavingKeys] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transcriptVideo, setTranscriptVideo] = useState<ResearchVideo | null>(null);
    const [transcript, setTranscript] = useState('');
    const [transcriptError, setTranscriptError] = useState<string | null>(null);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptCopied, setTranscriptCopied] = useState(false);
    const pendingIdentifiers = useMemo(() => [...new Set(identifier.split(/[,\n]+/).map(value => value.trim()).filter(Boolean))], [identifier]);

    const loadChannels = useCallback(async (groupId: string) => {
        if (!groupId) {
            setChannels([]);
            return;
        }
        const response = await apiFetch(`/api/research/channels?groupId=${encodeURIComponent(groupId)}`);
        const data = await readResponse<{ channels: SavedChannel[] }>(response);
        setChannels(data.channels);
    }, []);

    const loadPageData = useCallback(async () => {
        const [groupResponse, configResponse] = await Promise.all([
            apiFetch('/api/research/groups'),
            apiFetch('/api/research/config')
        ]);
        const groupData = await readResponse<{ groups: ResearchGroup[] }>(groupResponse);
        const configData = await readResponse<ResearchConfig>(configResponse);
        const rememberedGroup = localStorage.getItem('rddtfun_research_group');
        const nextGroupId = groupData.groups.some(group => group.id === rememberedGroup)
            ? rememberedGroup || ''
            : groupData.groups[0]?.id || '';
        setGroups(groupData.groups);
        setConfig(configData);
        setSelectedGroupId(nextGroupId);
        await loadChannels(nextGroupId);
    }, [loadChannels]);

    useEffect(() => {
        loadPageData()
            .catch(requestError => setError(requestError.message))
            .finally(() => setLoading(false));
    }, [loadPageData]);

    const channelAverages = useMemo(() => {
        const totals = new Map<string, { views: number; count: number }>();
        result.videos.forEach(video => {
            const current = totals.get(video.channelId) || { views: 0, count: 0 };
            current.views += video.views;
            current.count += 1;
            totals.set(video.channelId, current);
        });
        return new Map(Array.from(totals, ([id, value]) => [id, value.count ? value.views / value.count : 0]));
    }, [result.videos]);

    const videos = useMemo(() => {
        const query = search.trim().toLowerCase();
        const minimumViews = Number(minViews) || 0;
        const maximumViews = Number(maxViews) || Infinity;
        const minimumLikes = Number(minLikes) || 0;
        const minimumComments = Number(minComments) || 0;
        const minimumEngagement = Number(minEngagement) || 0;
        const minimumDuration = Number(minDuration) || 0;
        const maximumDuration = Number(maxDuration) || Infinity;
        const uploadDays = uploadDate === 'any' ? null : parseInt(uploadDate, 10) / (uploadDate.endsWith('h') ? 24 : 1);
        const uploadCutoff = uploadDays ? Date.now() - uploadDays * 86400000 : null;
        const engagement = (video: ResearchVideo) => video.views > 0 ? ((video.likes + video.comments) / video.views) * 100 : 0;
        return result.videos
            .filter(video => video.views >= minimumViews && video.views <= maximumViews)
            .filter(video => video.likes >= minimumLikes && video.comments >= minimumComments)
            .filter(video => engagement(video) >= minimumEngagement)
            .filter(video => video.durationSeconds >= minimumDuration && video.durationSeconds <= maximumDuration)
            .filter(video => !uploadCutoff || (video.publishedAt && new Date(video.publishedAt).getTime() >= uploadCutoff))
            .filter(video => videoType === 'all' || (videoType === 'short' ? video.isShort : !video.isShort))
            .filter(video => !query || video.title.toLowerCase().includes(query) || video.channelTitle?.toLowerCase().includes(query))
            .sort((a, b) => {
                if (sort === 'recent') return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
                if (sort === 'oldest') return new Date(a.publishedAt || 0).getTime() - new Date(b.publishedAt || 0).getTime();
                if (sort === 'likes') return b.likes - a.likes;
                if (sort === 'comments') return b.comments - a.comments;
                if (sort === 'engagement') return engagement(b) - engagement(a);
                if (sort === 'outlier') {
                    const aScore = a.outlierScore ?? (a.views / (channelAverages.get(a.channelId) || a.views || 1));
                    const bScore = b.outlierScore ?? (b.views / (channelAverages.get(b.channelId) || b.views || 1));
                    return bScore - aScore;
                }
                return b.views - a.views;
            });
    }, [channelAverages, maxDuration, maxViews, minComments, minDuration, minEngagement, minLikes, minViews, result.videos, search, sort, uploadDate, videoType]);

    const selectGroup = async (groupId: string) => {
        setSelectedGroupId(groupId);
        localStorage.setItem('rddtfun_research_group', groupId);
        setResult(emptyResult);
        setError(null);
        try {
            await loadChannels(groupId);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to load group channels');
        }
    };

    const createGroup = async () => {
        if (!newGroupName.trim()) return;
        setSavingGroup(true);
        setError(null);
        try {
            const response = await apiFetch('/api/research/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newGroupName })
            });
            const data = await readResponse<{ group: ResearchGroup }>(response);
            setGroups(current => [...current, data.group]);
            setNewGroupName('');
            await selectGroup(data.group.id);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to create group');
        } finally {
            setSavingGroup(false);
        }
    };

    const renameSelectedGroup = async () => {
        const selected = groups.find(group => group.id === selectedGroupId);
        if (!selected) return;
        const name = window.prompt('Rename research group', selected.name)?.trim();
        if (!name || name === selected.name) return;
        setError(null);
        try {
            const response = await apiFetch(`/api/research/groups/${selected.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await readResponse<{ group: ResearchGroup }>(response);
            setGroups(current => current.map(group => group.id === data.group.id ? data.group : group));
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to rename group');
        }
    };

    const removeSelectedGroup = async () => {
        const selected = groups.find(group => group.id === selectedGroupId);
        if (!selected || !window.confirm(`Delete “${selected.name}” and remove its saved channels?`)) return;
        setError(null);
        try {
            const response = await apiFetch(`/api/research/groups/${selected.id}`, { method: 'DELETE' });
            await readResponse(response);
            const remaining = groups.filter(group => group.id !== selected.id);
            setGroups(remaining);
            await selectGroup(remaining[0]?.id || '');
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to delete group');
        }
    };

    const addChannel = async () => {
        if (!pendingIdentifiers.length || !selectedGroupId) return;
        setAdding(true);
        setError(null);
        try {
            const response = await apiFetch('/api/research/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: selectedGroupId, identifiers: pendingIdentifiers, source })
            });
            const data = await readResponse<{ channels: SavedChannel[]; errors: Array<{ identifier: string; message: string }> }>(response);
            setIdentifier(data.errors.map(item => item.identifier).join(', '));
            if (data.errors.length > 0) {
                setError(`${data.channels.length} added. ${data.errors.length} failed: ${data.errors.map(item => `${item.identifier} (${item.message})`).join('; ')}`);
            }
            await loadChannels(selectedGroupId);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to add channels');
        } finally {
            setAdding(false);
        }
    };

    const removeChannel = async (id: string) => {
        setError(null);
        try {
            const response = await apiFetch(`/api/research/channels/${id}`, { method: 'DELETE' });
            await readResponse(response);
            setChannels(current => current.filter(channel => channel.id !== id));
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to remove channel');
        }
    };

    const saveKeys = async () => {
        setSavingKeys(true);
        setError(null);
        try {
            const response = await apiFetch('/api/research/youtube-keys', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(primaryKey ? { primary: primaryKey } : {}),
                    ...(backupKey ? { backup: backupKey } : {})
                })
            });
            setConfig(await readResponse<ResearchConfig>(response));
            setPrimaryKey('');
            setBackupKey('');
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to save API keys');
        } finally {
            setSavingKeys(false);
        }
    };

    const runResearch = async () => {
        setResearching(true);
        setError(null);
        try {
            const response = await apiFetch('/api/research/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: selectedGroupId, source, timeframe })
            });
            setResult(await readResponse<ResearchResult>(response));
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Research failed');
        } finally {
            setResearching(false);
        }
    };

    const openTranscript = async (video: ResearchVideo) => {
        setTranscriptVideo(video);
        setTranscript('');
        setTranscriptError(null);
        setTranscriptCopied(false);
        setTranscriptLoading(true);
        try {
            const response = await apiFetch('/api/research/transcript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId: video.id })
            });
            const data = await readResponse<{ transcript: string }>(response);
            setTranscript(data.transcript);
        } catch (requestError) {
            setTranscriptError(requestError instanceof Error ? requestError.message : 'Failed to fetch transcript');
        } finally {
            setTranscriptLoading(false);
        }
    };

    const copyTranscript = async () => {
        if (!transcript) return;
        try {
            await navigator.clipboard.writeText(transcript);
            setTranscriptCopied(true);
            window.setTimeout(() => setTranscriptCopied(false), 2000);
        } catch {
            setTranscriptError('Could not copy the transcript');
        }
    };

    const sourceReady = source === 'viewstats' ? config.viewstatsConfigured : config.youtubeKeyCount > 0;

    return (
        <div className="space-y-4">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                <div>
                    <div className="mb-2 flex items-center gap-2">
                        <Search className="h-7 w-7 text-[#F97316]" />
                        <h1 className="text-2xl font-bold text-white sm:text-3xl">Video Discovery</h1>
                    </div>
                    <p className="text-sm text-[#B8B9BC] sm:text-base">Find standout videos across your saved channel groups. Nothing runs automatically.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-3">
                    <Database className={`h-5 w-5 ${source === 'viewstats' ? 'text-[#F97316]' : 'text-[#777]'}`} />
                    <Label htmlFor="source-toggle" className="text-sm text-white">ViewStats</Label>
                    <Switch
                        id="source-toggle"
                        checked={source === 'youtube'}
                        onCheckedChange={checked => setSource(checked ? 'youtube' : 'viewstats')}
                    />
                    <Label htmlFor="source-toggle" className="text-sm text-white">YouTube API</Label>
                    <Youtube className={`h-5 w-5 ${source === 'youtube' ? 'text-red-500' : 'text-[#777]'}`} />
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {source === 'youtube' && (
                <Card className="border-[#3A3A3A] bg-[#2A2A2A]">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5 text-[#F97316]" />
                            <CardTitle className="text-white">YouTube Data API</CardTitle>
                        </div>
                        <CardDescription className="text-[#B8B9BC]">
                            {config.youtubeKeyCount > 0 ? `${config.youtubeKeyCount} key${config.youtubeKeyCount > 1 ? 's' : ''} configured. Enter values only when replacing them.` : 'Add a key to enable YouTube mode.'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 lg:flex-row">
                        <Input type="password" value={primaryKey} onChange={event => setPrimaryKey(event.target.value)} placeholder="Primary API key" className="border-[#444] bg-[#1A1A1A] text-white" />
                        <Input type="password" value={backupKey} onChange={event => setBackupKey(event.target.value)} placeholder="Backup key (optional)" className="border-[#444] bg-[#1A1A1A] text-white" />
                        <Button onClick={saveKeys} disabled={savingKeys || (!primaryKey && !backupKey)} className="bg-[#F97316] text-white hover:bg-[#EA580C]">
                            {savingKeys ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Keys
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Card className="border-[#3A3A3A] bg-[#2A2A2A]">
                <CardHeader className="flex flex-col gap-3 p-4 pb-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <FolderPlus className="h-5 w-5 shrink-0 text-[#F97316]" />
                            <CardTitle className="text-white">Research Setup</CardTitle>
                        </div>
                        <CardDescription className="mt-1 text-[#B8B9BC]">Choose a group, add channels, and load its discovery grid.</CardDescription>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
                        <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-[#444] bg-[#1A1A1A] pl-3 sm:w-52">
                            <span className="shrink-0 text-xs text-[#8F9196]">Timeframe</span>
                            <Select value={timeframe} onValueChange={value => setTimeframe(value as Timeframe)}>
                                <SelectTrigger className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-white shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="7d">Last 7 days</SelectItem><SelectItem value="28d">Last 28 days</SelectItem><SelectItem value="90d">Last 90 days</SelectItem><SelectItem value="365d">Last year</SelectItem><SelectItem value="max">All time</SelectItem></SelectContent>
                            </Select>
                        </div>
                        <Button onClick={runResearch} disabled={researching || channels.length === 0 || !sourceReady} className="h-10 shrink-0 bg-[#F97316] px-4 text-white hover:bg-[#EA580C] sm:min-w-48">
                            {researching ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                            {researching ? 'Loading Videos...' : 'Load Research Data'}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4 sm:px-5">
                    <div className="grid gap-2 lg:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1fr)_auto]">
                        <Select value={selectedGroupId} onValueChange={selectGroup} disabled={groups.length === 0}>
                            <SelectTrigger className="h-10 border-[#444] bg-[#1A1A1A] text-white"><SelectValue placeholder="Select a group" /></SelectTrigger>
                            <SelectContent>{groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <div className="flex min-w-0 gap-2">
                            <Input
                                value={newGroupName}
                                onChange={event => setNewGroupName(event.target.value)}
                                onKeyDown={event => event.key === 'Enter' && createGroup()}
                                placeholder="New group name"
                                maxLength={80}
                                className="h-10 min-w-0 border-[#444] bg-[#1A1A1A] text-white"
                            />
                            <Button onClick={createGroup} disabled={savingGroup || !newGroupName.trim()} className="h-10 shrink-0 bg-[#F97316] px-4 text-white hover:bg-[#EA580C]">
                                {savingGroup ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                <span className="ml-2 hidden sm:inline">Create</span>
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="icon" onClick={renameSelectedGroup} disabled={!selectedGroupId} className="h-10 w-10 border-[#444] bg-transparent text-white hover:bg-[#333]" aria-label="Rename selected group"><Pencil className="h-4 w-4" /></Button>
                            <Button variant="outline" size="icon" onClick={removeSelectedGroup} disabled={!selectedGroupId} className="h-10 w-10 border-red-500/40 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200" aria-label="Delete selected group"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                    </div>
                    <div className="border-t border-[#3A3A3A] pt-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
                            <div className="min-w-0 flex-1">
                                <textarea
                                    value={identifier}
                                    onChange={event => setIdentifier(event.target.value)}
                                    onKeyDown={event => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') addChannel();
                                    }}
                                    placeholder="@channel1, @channel2, UC... — comma-separated or one per line"
                                    rows={2}
                                    className="flex min-h-16 w-full resize-y rounded-md border border-[#444] bg-[#1A1A1A] px-3 py-2 text-sm text-white outline-none placeholder:text-[#777] focus-visible:ring-2 focus-visible:ring-[#F97316]"
                                />
                                <p className="mt-1 text-xs text-[#777]">Up to 50 channels · Press Ctrl/⌘ + Enter to add</p>
                            </div>
                            <Button onClick={addChannel} disabled={adding || pendingIdentifiers.length === 0 || !selectedGroupId || !sourceReady} className="shrink-0 bg-[#F97316] text-white hover:bg-[#EA580C] md:h-16">
                                {adding ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                {adding ? 'Adding...' : pendingIdentifiers.length ? `Add ${pendingIdentifiers.length} Channel${pendingIdentifiers.length === 1 ? '' : 's'}` : 'Add Channels'}
                            </Button>
                        </div>
                        {!sourceReady && !loading && <p className="mt-2 text-sm text-amber-300">{source === 'viewstats' ? 'ViewStats server credentials are not configured.' : 'Add a YouTube API key above to use YouTube mode.'}</p>}
                        {groups.length === 0 && !loading && <p className="mt-2 text-sm text-amber-300">Create your first group before adding channels.</p>}
                        {loading ? (
                            <p className="mt-3 text-sm text-[#B8B9BC]">Loading channels...</p>
                        ) : channels.length === 0 ? (
                            <p className="mt-3 text-sm text-[#8F9196]">No channels in this group yet.</p>
                        ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {channels.map(channel => (
                                    <div key={channel.id} className="flex max-w-full items-center gap-2 rounded-full border border-[#3A3A3A] bg-[#222] py-1 pl-1 pr-1.5">
                                        <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#333]">
                                            {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Users className="m-1.5 h-4 w-4 text-[#777]" />}
                                        </div>
                                        <span className="max-w-40 truncate text-xs font-medium text-white">{channel.title}</span>
                                        <button type="button" onClick={() => removeChannel(channel.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#888] hover:bg-red-500/10 hover:text-red-400" aria-label={`Remove ${channel.title}`}><Trash2 className="h-3.5 w-3.5" /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {result.errors.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                    {result.errors.map(item => <p key={item.channelId}><span className="font-medium">{item.title}:</span> {item.message}</p>)}
                </div>
            )}

            <Card className="border-[#3A3A3A] bg-[#2A2A2A]">
                <CardHeader>
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                        <div>
                            <CardTitle className="text-white">Video Discovery Grid</CardTitle>
                            <CardDescription className="text-[#B8B9BC]">{videos.length} of {result.videos.length} videos</CardDescription>
                        </div>
                        {result.videos.length > 0 && <Badge className="w-fit bg-[#F97316]/15 text-[#FB923C] hover:bg-[#F97316]/15">{source === 'viewstats' ? 'ViewStats' : 'YouTube API'}</Badge>}
                    </div>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-lg border border-[#3A3A3A] bg-[#222] p-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <FilterField label="Search">
                                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Video or channel" className="border-[#444] bg-[#1A1A1A] text-white" />
                            </FilterField>
                            <FilterField label="Content Type">
                                <Select value={videoType} onValueChange={value => setVideoType(value as VideoType)}><SelectTrigger className="border-[#444] bg-[#1A1A1A] text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All content</SelectItem><SelectItem value="long">Long-form only</SelectItem><SelectItem value="short">Shorts only</SelectItem></SelectContent></Select>
                            </FilterField>
                            <FilterField label="Upload Date">
                                <Select value={uploadDate} onValueChange={value => setUploadDate(value as UploadDate)}><SelectTrigger className="border-[#444] bg-[#1A1A1A] text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any time</SelectItem><SelectItem value="24h">Last 24 hours</SelectItem><SelectItem value="7d">Last 7 days</SelectItem><SelectItem value="30d">Last 30 days</SelectItem><SelectItem value="90d">Last 90 days</SelectItem></SelectContent></Select>
                            </FilterField>
                            <FilterField label="Sort By">
                                <Select value={sort} onValueChange={value => setSort(value as Sort)}><SelectTrigger className="border-[#444] bg-[#1A1A1A] text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="views">Views: high to low</SelectItem><SelectItem value="recent">Date: newest first</SelectItem><SelectItem value="oldest">Date: oldest first</SelectItem><SelectItem value="likes">Likes: high to low</SelectItem><SelectItem value="comments">Comments: high to low</SelectItem><SelectItem value="engagement">Engagement: high to low</SelectItem><SelectItem value="outlier">Outlier: high to low</SelectItem></SelectContent></Select>
                            </FilterField>
                            <RangeFilter label="Views" minimum={minViews} maximum={maxViews} onMinimum={setMinViews} onMaximum={setMaxViews} />
                            <RangeFilter label="Duration (seconds)" minimum={minDuration} maximum={maxDuration} onMinimum={setMinDuration} onMaximum={setMaxDuration} />
                            <FilterField label="Minimum Likes">
                                <Input type="number" min="0" value={minLikes} onChange={event => setMinLikes(event.target.value)} placeholder="Any" className="border-[#444] bg-[#1A1A1A] text-white" />
                            </FilterField>
                            <div className="grid grid-cols-2 gap-2">
                                <FilterField label="Min Comments">
                                    <Input type="number" min="0" value={minComments} onChange={event => setMinComments(event.target.value)} placeholder="Any" className="border-[#444] bg-[#1A1A1A] text-white" />
                                </FilterField>
                                <FilterField label="Min ER (%)">
                                    <Input type="number" min="0" step="0.1" value={minEngagement} onChange={event => setMinEngagement(event.target.value)} placeholder="Any" className="border-[#444] bg-[#1A1A1A] text-white" />
                                </FilterField>
                            </div>
                        </div>
                    </div>
                    {researching ? (
                        <div className="py-16 text-center text-[#B8B9BC]"><RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-[#F97316]" />Loading videos...</div>
                    ) : videos.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#444] py-16 text-center text-[#B8B9BC]">{result.videos.length > 0 ? 'No videos match the current filters.' : 'Load research data to discover videos.'}</div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {videos.map(video => {
                                const outlier = video.outlierScore ?? (video.views / (channelAverages.get(video.channelId) || video.views || 1));
                                const engagement = video.views > 0 ? ((video.likes + video.comments) / video.views) * 100 : null;
                                return (
                                    <Card key={video.id} className="group flex h-full flex-col overflow-hidden border-[#3A3A3A] bg-[#222] transition duration-150 hover:scale-[1.02] hover:border-[#F97316]/70">
                                        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="block">
                                            <div className="relative aspect-video overflow-hidden bg-[#1A1A1A]">
                                                <img src={video.thumbnailUrl || `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`} alt={video.title} className="h-full w-full object-cover" loading="lazy" />
                                                <span className="absolute right-2 top-2 rounded bg-black/85 px-2 py-1 text-xs font-bold text-white shadow">{outlier.toFixed(1)}x</span>
                                                <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 text-xs text-white">{formatDuration(video.durationSeconds)}</span>
                                                <div className="absolute bottom-2 left-2 h-9 w-9 overflow-hidden rounded-full border-2 border-[#222] bg-[#333] shadow-lg">
                                                    {video.channelThumbnailUrl ? <img src={video.channelThumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Users className="m-2 h-4 w-4 text-[#999]" />}
                                                </div>
                                            </div>
                                        </a>
                                        <CardContent className="flex flex-1 flex-col justify-between space-y-3 p-3">
                                            <div className="space-y-2">
                                                <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="flex gap-2">
                                                    <h3 className="line-clamp-2 min-h-10 flex-1 text-sm font-semibold leading-5 text-white transition-colors group-hover:text-[#FB923C]">{video.title}</h3>
                                                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-[#777] group-hover:text-[#FB923C]" />
                                                </a>
                                                <p className="truncate text-xs font-medium text-[#B8B9BC]">{video.channelTitle || video.channelHandle || video.channelId}</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-[#3A3A3A] py-3 text-xs text-[#D2D3D5]">
                                                <VideoMetric icon={Eye} value={`${formatNumber(video.views)} views`} />
                                                <VideoMetric icon={ThumbsUp} value={`${formatNumber(video.likes)} likes`} />
                                                <VideoMetric icon={MessageSquare} value={`${formatNumber(video.comments)} comments`} />
                                                <VideoMetric icon={TrendingUp} value={engagement === null ? 'N/A' : `${engagement.toFixed(1)}% ER`} />
                                            </div>
                                            <div className="flex items-center justify-between gap-2 text-xs text-[#8F9196]">
                                                <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : 'Unknown date'}</span>
                                                <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDuration(video.durationSeconds)}</span>
                                            </div>
                                            <div className="flex gap-2 border-t border-[#3A3A3A] pt-3">
                                                <Button variant="outline" size="sm" onClick={() => openTranscript(video)} className="flex-1 border-[#4A4A4A] bg-[#2A2A2A] text-white hover:border-[#F97316]/60 hover:bg-[#F97316]/10 hover:text-[#FB923C]">
                                                    <FileText className="mr-2 h-4 w-4" />Transcript
                                                </Button>
                                                <Button asChild variant="outline" size="sm" className="border-[#4A4A4A] bg-[#2A2A2A] text-[#B8B9BC] hover:bg-[#333] hover:text-white">
                                                    <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on YouTube`}><ExternalLink className="h-4 w-4" /></a>
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog.Root
                open={Boolean(transcriptVideo)}
                onOpenChange={open => {
                    if (!open) {
                        setTranscriptVideo(null);
                        setTranscript('');
                        setTranscriptError(null);
                        setTranscriptCopied(false);
                    }
                }}
            >
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-[#444] bg-[#222] shadow-2xl focus:outline-none">
                        <div className="flex items-start justify-between gap-4 border-b border-[#3A3A3A] p-5">
                            <div className="min-w-0">
                                <Dialog.Title className="truncate text-lg font-semibold text-white">Video Transcript</Dialog.Title>
                                <Dialog.Description className="mt-1 line-clamp-2 text-sm text-[#B8B9BC]">{transcriptVideo?.title}</Dialog.Description>
                            </div>
                            <Dialog.Close asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-[#999] hover:bg-[#333] hover:text-white" aria-label="Close transcript"><X className="h-5 w-5" /></Button>
                            </Dialog.Close>
                        </div>
                        <div className="min-h-72 flex-1 overflow-y-auto p-5">
                            {transcriptLoading ? (
                                <div className="flex min-h-72 flex-col items-center justify-center text-[#B8B9BC]"><RefreshCw className="mb-3 h-7 w-7 animate-spin text-[#F97316]" /><p>Fetching transcript...</p></div>
                            ) : transcriptError ? (
                                <div className="flex min-h-72 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-200">{transcriptError}</div>
                            ) : (
                                <Textarea readOnly value={transcript} className="min-h-72 resize-none border-[#444] bg-[#1A1A1A] leading-6 text-[#E5E5E5] focus-visible:ring-[#F97316]" />
                            )}
                        </div>
                        <div className="flex flex-col-reverse gap-2 border-t border-[#3A3A3A] p-4 sm:flex-row sm:justify-end">
                            {transcriptVideo && (
                                <Button asChild variant="outline" className="border-[#4A4A4A] bg-transparent text-white hover:bg-[#333]">
                                    <a href={`https://www.youtube.com/watch?v=${transcriptVideo.id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open Video</a>
                                </Button>
                            )}
                            <Button onClick={copyTranscript} disabled={!transcript || transcriptLoading} className="bg-[#F97316] text-white hover:bg-[#EA580C]">
                                {transcriptCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                                {transcriptCopied ? 'Copied' : 'Copy Transcript'}
                            </Button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-[#B8B9BC]">{label}</Label>
            {children}
        </div>
    );
}

function RangeFilter({ label, minimum, maximum, onMinimum, onMaximum }: {
    label: string;
    minimum: string;
    maximum: string;
    onMinimum: (value: string) => void;
    onMaximum: (value: string) => void;
}) {
    return (
        <FilterField label={label}>
            <div className="grid grid-cols-2 gap-2">
                <Input type="number" min="0" value={minimum} onChange={event => onMinimum(event.target.value)} placeholder="Min" className="border-[#444] bg-[#1A1A1A] text-white" />
                <Input type="number" min="0" value={maximum} onChange={event => onMaximum(event.target.value)} placeholder="Max" className="border-[#444] bg-[#1A1A1A] text-white" />
            </div>
        </FilterField>
    );
}

function VideoMetric({ icon: Icon, value }: { icon: typeof Eye; value: string }) {
    return <span className="flex min-w-0 items-center gap-1.5"><Icon className="h-3.5 w-3.5 shrink-0 text-[#8F9196]" /><span className="truncate">{value}</span></span>;
}
