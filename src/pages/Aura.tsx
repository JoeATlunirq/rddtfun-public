import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Clock,
    Crown,
    Eye,
    Loader2,
    Play,
    RefreshCw,
    Settings as SettingsIcon,
    Sparkles,
    TrendingUp,
    Users,
    X,
    Youtube,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AURA_TIMEFRAMES, type AuraEntry, type AuraLeaderboard, type AuraTimeframe } from '@/types/aura';

const TIMEFRAME_STORAGE_KEY = 'rddtfun_aura_timeframe';
const SETTINGS_TAB_STORAGE_KEY = 'rddtfun_settings_tab';

function formatNumber(value: number | null | undefined, showSign = false) {
    if (value === null || value === undefined) return '—';
    const sign = showSign && value > 0 ? '+' : '';
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${sign}${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${sign}${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}${(value / 1_000).toFixed(1)}K`;
    return `${sign}${value.toLocaleString()}`;
}

function timeAgo(date: string) {
    const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function formatDay(date: string) {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function channelUrl(entry: AuraEntry) {
    return entry.handle?.startsWith('@')
        ? `https://youtube.com/${entry.handle}`
        : `https://youtube.com/channel/${entry.channelId}`;
}

function Avatar({ entry, className }: { entry: AuraEntry; className?: string }) {
    const [failed, setFailed] = useState(false);
    if (entry.thumbnailUrl && !failed) {
        return (
            <img
                src={entry.thumbnailUrl}
                alt={entry.title}
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className={cn('shrink-0 rounded-full bg-[#1A1A1A] object-cover', className)}
            />
        );
    }
    return (
        <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] font-semibold text-[#F97316]', className)}>
            {(entry.title || entry.handle || '?').replace('@', '').charAt(0).toUpperCase()}
        </div>
    );
}

function RankChange({ change, size = 'sm' }: { change: number; size?: 'sm' | 'md' }) {
    if (!change) return null;
    const up = change > 0;
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border font-semibold tabular-nums',
                size === 'sm' ? 'gap-0.5 px-1.5 py-0.5 text-[11px]' : 'gap-1 px-2 py-0.5 text-xs',
                up ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'
            )}
        >
            {up ? <ChevronUp className="h-3 w-3" strokeWidth={3} /> : <ChevronDown className="h-3 w-3" strokeWidth={3} />}
            {Math.abs(change)}
        </span>
    );
}

function StatTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Eye }) {
    return (
        <div className="rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[#B8B9BC]">
                <Icon className="h-4 w-4 text-[#F97316]" />
                <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
        </div>
    );
}

function ViewsChart({ data }: { data: AuraEntry['dailyViews'] }) {
    const [hovered, setHovered] = useState<number | null>(null);
    if (data.length === 0) return null;
    const max = Math.max(...data.map(d => d.views));
    const min = Math.min(...data.map(d => d.views));
    const range = max - min || 1;
    const top = 10;
    const bottom = 80;
    const point = (views: number, i: number) => ({
        x: data.length === 1 ? 150 : (i / (data.length - 1)) * 300,
        y: bottom - ((views - min) / range) * (bottom - top),
    });
    const points = data.map((d, i) => point(d.views, i));
    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    const area = `M0,${bottom} L0,${points[0].y} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L300,${bottom} Z`;
    const active = hovered !== null ? { ...points[hovered], ...data[hovered] } : null;

    return (
        <div className="rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] p-4">
            <div className="mb-3 flex items-center gap-2 text-[#B8B9BC]">
                <Eye className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Views per day</span>
            </div>
            <div className="relative">
                <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="h-28 w-full" onMouseLeave={() => setHovered(null)}>
                    <defs>
                        <linearGradient id="auraViewsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#F97316" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {[20, 45, 70].map(y => (
                        <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="#3A3A3A" strokeWidth="1" strokeDasharray="4 4" />
                    ))}
                    <path d={area} fill="url(#auraViewsGradient)" />
                    <polyline points={line} fill="none" stroke="#F97316" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    {points.map((p, i) => (
                        <rect key={i} x={p.x - 300 / data.length / 2} y="0" width={300 / data.length} height="90" fill="transparent" onMouseEnter={() => setHovered(i)} />
                    ))}
                </svg>
                {active && (
                    <div
                        className="pointer-events-none absolute -translate-y-full whitespace-nowrap rounded-md bg-white px-2 py-1 text-xs text-black shadow-lg"
                        style={{
                            left: `${(active.x / 300) * 100}%`,
                            top: `${(active.y / 90) * 100}%`,
                            transform: `translate(${active.x > 150 ? '-100%' : '0'}, calc(-100% - 6px))`,
                        }}
                    >
                        {formatDay(active.date)}: {formatNumber(active.views)} views
                    </div>
                )}
            </div>
            <div className="mt-2 flex justify-between text-xs text-[#8A8B8F]">
                <span>{formatDay(data[0].date)}</span>
                {data.length > 1 && <span>{formatDay(data[data.length - 1].date)}</span>}
            </div>
        </div>
    );
}

function ChannelModal({ entry, timeframeLabel, onClose }: { entry: AuraEntry; timeframeLabel: string; onClose: () => void }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const stats = [
        { label: 'Views gained', value: formatNumber(entry.viewsGained, true), icon: Eye },
        { label: 'Subs gained', value: formatNumber(entry.subsGained, true), icon: Users },
        { label: 'Total subs', value: formatNumber(entry.totalSubscribers), icon: Users },
        { label: 'Videos posted', value: String(entry.videosPublished), icon: Play },
        { label: 'Avg views / video', value: formatNumber(entry.avgViewsPerVideo), icon: TrendingUp },
        { label: 'Total views', value: formatNumber(entry.totalViews), icon: Eye },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label={entry.title}
                onClick={e => e.stopPropagation()}
                className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-[#3A3A3A] bg-[#2A2A2A]"
            >
                <div className="flex items-start justify-between gap-3 border-b border-[#3A3A3A] p-5">
                    <div className="flex min-w-0 items-center gap-4">
                        <Avatar entry={entry} className="h-14 w-14 text-xl" />
                        <div className="min-w-0">
                            <h2 className="truncate text-lg font-semibold text-white">{entry.title}</h2>
                            <p className="truncate text-sm text-[#B8B9BC]">{entry.handle}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1.5 text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white" aria-label="Close">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="space-y-4 p-5">
                    <div className="rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] py-4 text-center">
                        <div className="text-4xl font-bold tabular-nums text-[#F97316]">{Math.round(entry.score)}</div>
                        <div className="mt-1 text-xs uppercase tracking-wider text-[#B8B9BC]">Aura score · {timeframeLabel}</div>
                    </div>
                    <ViewsChart data={entry.dailyViews} />
                    <div className="grid grid-cols-2 gap-3">
                        {stats.map(stat => (
                            <div key={stat.label} className="rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] p-3">
                                <div className="mb-1 flex items-center gap-1.5 text-[#B8B9BC]">
                                    <stat.icon className="h-3.5 w-3.5" />
                                    <span className="text-xs uppercase tracking-wider">{stat.label}</span>
                                </div>
                                <div className="text-lg font-semibold tabular-nums text-white">{stat.value}</div>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] p-3">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-[#B8B9BC]">Current rank</div>
                            <div className="flex items-center gap-2">
                                <span className="text-xl font-bold text-white">#{entry.rank}</span>
                                <RankChange change={entry.rankChange} size="md" />
                            </div>
                        </div>
                        <Button asChild className="bg-[#F97316] text-white hover:bg-[#EA580C]">
                            <a href={channelUrl(entry)} target="_blank" rel="noopener noreferrer">
                                <Youtube className="h-4 w-4" />
                                View channel
                            </a>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function pickLeaders(entries: AuraEntry[]) {
    const used = new Set<string>();
    const categories: { label: string; metric: (e: AuraEntry) => number; format: (e: AuraEntry) => string; subtext: string }[] = [
        { label: 'Most views', metric: e => e.viewsGained, format: e => formatNumber(e.viewsGained), subtext: 'views gained' },
        { label: 'Most consistent', metric: e => e.videosPublished, format: e => String(e.videosPublished), subtext: 'videos posted' },
        { label: 'Fastest growing', metric: e => e.subsGained, format: e => formatNumber(e.subsGained, true), subtext: 'new subs' },
        { label: 'Best performer', metric: e => e.avgViewsPerVideo, format: e => formatNumber(e.avgViewsPerVideo), subtext: 'avg views / video' },
    ];
    return categories.flatMap(category => {
        const pool = entries.filter(e => !used.has(e.channelId));
        if (pool.length === 0) return [];
        const leader = pool.reduce((best, e) => (category.metric(e) > category.metric(best) ? e : best), pool[0]);
        used.add(leader.channelId);
        return [{ ...category, entry: leader }];
    });
}

export default function Aura() {
    const [timeframe, setTimeframe] = useState<AuraTimeframe>(() => {
        try {
            const stored = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
            if (AURA_TIMEFRAMES.some(t => t.value === stored)) return stored as AuraTimeframe;
        } catch { /* storage unavailable */ }
        return '24h';
    });
    const [data, setData] = useState<AuraLeaderboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<AuraEntry | null>(null);

    const load = useCallback(async (tf: AuraTimeframe) => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiFetch(`/api/aura/leaderboard?timeframe=${tf}`);
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Failed to load the Aura rank');
            setData(body);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load the Aura rank');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(timeframe);
    }, [timeframe, load]);

    const changeTimeframe = (tf: AuraTimeframe) => {
        setTimeframe(tf);
        try { localStorage.setItem(TIMEFRAME_STORAGE_KEY, tf); } catch { /* storage unavailable */ }
    };

    const openAuraSettings = () => {
        try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, 'aura'); } catch { /* storage unavailable */ }
    };

    const timeframeLabel = AURA_TIMEFRAMES.find(t => t.value === timeframe)?.label || 'Daily';
    const entries = data?.entries || [];
    const podium = [entries[1], entries[0], entries[2]].filter(Boolean) as AuraEntry[];
    const rest = entries.slice(3);
    const totals = entries.reduce(
        (sum, e) => ({ views: sum.views + e.viewsGained, subs: sum.subs + e.subsGained, videos: sum.videos + e.videosPublished }),
        { views: 0, subs: 0, videos: 0 }
    );
    const leaders = pickLeaders(entries);
    const noChannels = !loading && !error && data?.channelCount === 0;

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-[#F97316]" />
                        <h1 className="text-2xl font-semibold tracking-tight text-white">Aura</h1>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#B8B9BC]">
                        <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {data ? `Updated ${timeAgo(data.lastUpdated)}` : 'Loading…'}
                        </span>
                        {data && data.channelCount > 0 && (
                            <>
                                <span className="text-[#5A5B5F]">·</span>
                                <span>{data.channelCount} channel{data.channelCount === 1 ? '' : 's'} ranked by views gained</span>
                            </>
                        )}
                        {loading && data && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-1">
                        {AURA_TIMEFRAMES.map(option => (
                            <button
                                key={option.value}
                                onClick={() => changeTimeframe(option.value)}
                                disabled={loading}
                                className={cn(
                                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
                                    timeframe === option.value ? 'bg-[#F97316] text-white' : 'text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white'
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => load(timeframe)}
                        disabled={loading}
                        className="border-[#3A3A3A] bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] hover:text-[#F97316]"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </Button>
                    <Button asChild variant="outline" size="icon" className="border-[#3A3A3A] bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] hover:text-[#F97316]">
                        <Link to="/settings" onClick={openAuraSettings} aria-label="Edit ranked channels" title="Edit ranked channels">
                            <SettingsIcon className="h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </div>

            {loading && !data && (
                <div className="flex flex-col items-center justify-center py-20 text-[#B8B9BC]">
                    <Loader2 className="mb-4 h-10 w-10 animate-spin text-[#F97316]" />
                    Loading the Aura rank…
                </div>
            )}

            {error && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] py-16 text-center">
                    <AlertCircle className="mb-4 h-10 w-10 text-red-400" />
                    <p className="mb-1 font-medium text-white">Couldn't load the Aura rank</p>
                    <p className="mb-4 text-sm text-[#B8B9BC]">{error}</p>
                    <Button onClick={() => load(timeframe)} className="bg-[#F97316] text-white hover:bg-[#EA580C]">
                        <RefreshCw className="h-4 w-4" />
                        Try again
                    </Button>
                </div>
            )}

            {noChannels && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-[#3A3A3A] bg-[#2A2A2A] px-4 py-16 text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F97316]/10">
                        <Crown className="h-6 w-6 text-[#F97316]" />
                    </div>
                    <p className="mb-1 font-medium text-white">No channels in your Aura rank yet</p>
                    <p className="mb-4 max-w-sm text-sm text-[#B8B9BC]">Add the YouTube @handles you want to compete with in Settings.</p>
                    <Button asChild className="bg-[#F97316] text-white hover:bg-[#EA580C]">
                        <Link to="/settings" onClick={openAuraSettings}>Add channels</Link>
                    </Button>
                </div>
            )}

            {!error && entries.length > 0 && (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatTile label="Views gained" value={formatNumber(totals.views)} icon={Eye} />
                        <StatTile label="Subs gained" value={formatNumber(totals.subs, true)} icon={Users} />
                        <StatTile label="Videos posted" value={totals.videos.toLocaleString()} icon={Play} />
                        <StatTile label="Channels" value={String(entries.length)} icon={Crown} />
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-3 sm:gap-3">
                        {podium.map(entry => {
                            const first = entry.rank === 1;
                            return (
                                <button
                                    key={entry.channelId}
                                    onClick={() => setSelected(entry)}
                                    className={cn(
                                        'relative min-w-0 rounded-xl border bg-[#2A2A2A] p-3 text-center transition-colors hover:bg-[#333333] sm:p-4',
                                        first ? 'border-[#F97316]/60 shadow-[0_0_24px_-8px_#F97316]' : 'border-[#3A3A3A]'
                                    )}
                                >
                                    {first && <Crown className="absolute -top-3.5 left-1/2 h-7 w-7 -translate-x-1/2 fill-[#F97316] text-[#F97316]" />}
                                    <Avatar entry={entry} className="mx-auto mb-2 h-10 w-10 text-base sm:h-12 sm:w-12" />
                                    <div className="flex items-center justify-center gap-1.5">
                                        <span className={cn('text-xl font-bold tabular-nums sm:text-2xl', first ? 'text-[#F97316]' : 'text-[#B8B9BC]')}>#{entry.rank}</span>
                                        <RankChange change={entry.rankChange} />
                                    </div>
                                    <h3 className="mt-1 truncate text-sm font-medium text-white">{entry.title}</h3>
                                    <p className="truncate text-xs text-[#8A8B8F]">{entry.handle}</p>
                                    <div className="mt-3 border-t border-[#3A3A3A] pt-3">
                                        <span className="text-xl font-bold tabular-nums text-white sm:text-3xl">{formatNumber(entry.viewsGained, true)}</span>
                                        <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[#B8B9BC]">Views</p>
                                    </div>
                                    <div className="mt-3 flex flex-col justify-between gap-0.5 border-t border-[#3A3A3A] pt-3 text-xs sm:flex-row">
                                        <span className="font-medium tabular-nums text-white">{formatNumber(entry.subsGained, true)} subs</span>
                                        <span className="tabular-nums text-[#B8B9BC]">Aura {Math.round(entry.score)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {rest.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-[#3A3A3A] bg-[#2A2A2A]">
                            <div className="grid grid-cols-[40px_1fr_84px_56px] gap-2 border-b border-[#3A3A3A] bg-[#1A1A1A] px-3 py-3 text-xs font-medium uppercase tracking-wider text-[#B8B9BC] sm:grid-cols-[56px_1fr_110px_90px_70px] sm:px-4">
                                <div className="text-center">#</div>
                                <div>Channel</div>
                                <div className="text-right">Views</div>
                                <div className="hidden text-right sm:block">Subs</div>
                                <div className="text-right">Aura</div>
                            </div>
                            <div className="divide-y divide-[#3A3A3A]">
                                {rest.map(entry => (
                                    <button
                                        key={entry.channelId}
                                        onClick={() => setSelected(entry)}
                                        className="grid w-full grid-cols-[40px_1fr_84px_56px] items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-[#333333] sm:grid-cols-[56px_1fr_110px_90px_70px] sm:px-4"
                                    >
                                        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center">
                                            <span className="font-medium tabular-nums text-[#B8B9BC]">{entry.rank}</span>
                                            <RankChange change={entry.rankChange} />
                                        </div>
                                        <div className="flex min-w-0 items-center gap-3">
                                            <Avatar entry={entry} className="h-8 w-8 text-sm" />
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-white">{entry.title}</div>
                                                <div className="truncate text-xs text-[#8A8B8F]">{entry.handle}</div>
                                            </div>
                                        </div>
                                        <div className="text-right text-sm font-medium tabular-nums text-white">{formatNumber(entry.viewsGained, true)}</div>
                                        <div className="hidden text-right text-sm tabular-nums text-[#B8B9BC] sm:block">{formatNumber(entry.subsGained, true)}</div>
                                        <div className="text-right font-semibold tabular-nums text-[#F97316]">{Math.round(entry.score)}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {leaders.length > 1 && (
                        <div>
                            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#B8B9BC]">Leaders · {timeframeLabel}</h2>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {leaders.map(leader => (
                                    <button
                                        key={leader.label}
                                        onClick={() => setSelected(leader.entry)}
                                        className="rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] p-4 text-left transition-colors hover:bg-[#333333]"
                                    >
                                        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[#F97316]">{leader.label}</div>
                                        <div className="flex items-center gap-3">
                                            <Avatar entry={leader.entry} className="h-9 w-9 text-sm" />
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-white">{leader.entry.title}</div>
                                                <div className="text-xs text-[#B8B9BC]">
                                                    <span className="font-semibold text-white">{leader.format(leader.entry)}</span> {leader.subtext}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {!error && data && data.errors.length > 0 && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-200">
                    <div className="mb-1 flex items-center gap-2 font-medium">
                        <AlertCircle className="h-4 w-4" />
                        {data.errors.length} channel{data.errors.length === 1 ? '' : 's'} couldn't be loaded
                    </div>
                    <ul className="space-y-0.5 text-yellow-200/80">
                        {data.errors.map(item => (
                            <li key={item.channelId}>{item.handle}: {item.message}</li>
                        ))}
                    </ul>
                </div>
            )}

            {selected && <ChannelModal entry={selected} timeframeLabel={timeframeLabel} onClose={() => setSelected(null)} />}
        </div>
    );
}
