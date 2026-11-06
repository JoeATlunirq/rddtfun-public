import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    AlertCircle, CheckCircle2, Clapperboard, Clock, Copy, Download, Film, Image as ImageIcon, Loader2,
    MonitorPlay, Play, RotateCcw, Smartphone, Sparkles, Square, Wand2, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLongformJobs } from '@/hooks/useLongformJobs';
import {
    currentStep, formatDuration, isActive, jobProgress, LongformJob, STEP_SHORT_LABELS, stepDetailText, formatEta, jobEta,
} from '@/types/longform';

interface Profile {
    id: string;
    name: string;
    image_url?: string | null;
}

interface Preset {
    id: string;
    name: string;
    type: string;
    ttsProvider?: string;
    targetDuration?: number | null;
    targetDurationMin?: number | null;
    targetDurationMax?: number | null;
}

interface SideState {
    hook: string;
    script: string;
    audioPresetId: string;
    captionPresetId: string;
    hookStylePresetId: string;
}

type Side = 'long' | 'short';

// Finished-video pace (matches estimateVideoSeconds on the server): the local voice with pauses cut
// at 1.1x reads ~23.5 chars/s; cloud voices ~15. Long videos: Fish at 1.2x (LONGFORM_TEMPO) ~21 chars/s
const VIDEO_CHARS_PER_SECOND = { local: 23.5, long: 21, other: 15 };
// "Ready in" before any job has been measured (script chars per second of wall time); afterwards
// the server reports the measured speed of recent jobs
const DEFAULT_LONG_CHARS_PER_SECOND = 110;
const NONE = '__channel__';
const emptySide: SideState = { hook: '', script: '', audioPresetId: NONE, captionPresetId: NONE, hookStylePresetId: NONE };
const CTA_RE = /\b(link(ed)? below|(on|in) (my|the|our) (channel|bio|description)|channel (linked )?below|full story (is )?(on|in|below|linked|at))\b/i;
const CTA_LINE = 'If you want to see the Full story its on my channel and linked below.';

// ---------------------------------------------------------------- small pieces

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-white">{label}</span>
                {hint && <span className="text-xs text-[#777] truncate">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

function PresetSelect({ label, value, onChange, presets }: { label: string; value: string; onChange: (v: string) => void; presets: Preset[] }) {
    return (
        <div className="space-y-1 min-w-0">
            <span className="text-xs text-[#B8B9BC]">{label}</span>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-9 bg-[#1A1A1A] border-[#3A3A3A] text-white">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <SelectItem value={NONE} className="text-[#B8B9BC]">Channel default</SelectItem>
                    {presets.map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-white">
                            {p.name}{p.ttsProvider === 'local' ? ' · Local voice' : ''}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
    queued: { label: 'Queued', className: 'bg-[#3A3A3A] text-[#B8B9BC]' },
    running: { label: 'Rendering', className: 'bg-[#F97316]/15 text-[#F97316]' },
    done: { label: 'Ready', className: 'bg-green-500/15 text-green-400' },
    failed: { label: 'Failed', className: 'bg-red-500/15 text-red-400' },
    cancelled: { label: 'Cancelled', className: 'bg-[#3A3A3A] text-[#B8B9BC]' },
};

function StepTimeline({ job }: { job: LongformJob }) {
    return (
        <div className="flex gap-1">
            {job.steps.map(step => (
                <div key={step.id} className="min-w-0 flex-1" title={step.label}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#1A1A1A]">
                        <div
                            className={cn('h-full rounded-full transition-all duration-700',
                                step.status === 'done' || step.status === 'skipped' ? 'bg-green-500'
                                    : step.status === 'failed' ? 'bg-red-500'
                                        : step.status === 'running' ? 'bg-[#F97316]' : 'bg-transparent')}
                            style={{ width: step.status === 'running' ? `${Math.max(4, Math.round(step.progress * 100))}%` : step.status === 'pending' ? '0%' : '100%' }}
                        />
                    </div>
                    <p className={cn('mt-1 truncate text-[10px]', step.status === 'running' ? 'text-white' : 'text-[#777]')}>
                        {STEP_SHORT_LABELS[step.id] || step.label}
                    </p>
                </div>
            ))}
        </div>
    );
}

function JobCard({ job, now, onCancel, onRetry }: { job: LongformJob; now: number; onCancel: () => void; onRetry: () => void }) {
    const active = isActive(job);
    const progress = jobProgress(job, now);
    const step = currentStep(job);
    const [preview, setPreview] = useState<'long' | 'short' | null>(null);
    const [copied, setCopied] = useState(false);
    const chip = STATUS_CHIP[job.status] || STATUS_CHIP.queued;
    const checklist = `Upload checklist for "${job.title}":\n1. Upload the long video with the thumbnail.\n2. Upload the promo short titled "${job.shortTitle}" (YouTube cuts Shorts titles at 100 characters).\n3. On the short, set "Related video" to the long video in YouTube Studio.`;
    const elapsed = (() => {
        const start = Math.min(...job.steps.map(s => s.startedAt || Infinity));
        const end = Math.max(...job.steps.map(s => s.finishedAt || 0));
        return Number.isFinite(start) && end > start ? (end - start) / 1000 : null;
    })();

    return (
        <div className={cn('overflow-hidden rounded-xl border bg-[#2A2A2A] transition-colors', job.status === 'running' ? 'border-[#F97316]/40' : 'border-[#3A3A3A]')}>
            <div className="flex gap-3 p-3 sm:p-4">
                {/* Thumbnail / progress art */}
                <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-[#1A1A1A] sm:w-28">
                    {job.outputs.thumbnail
                        ? <img src={job.outputs.thumbnail} alt="" className="h-full w-full object-cover" />
                        : (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#F97316]/25 via-[#2A2A2A] to-[#1A1A1A]">
                                {active
                                    ? <span className="text-lg font-semibold tabular-nums text-white">{Math.round(progress * 100)}%</span>
                                    : <Clapperboard className="h-5 w-5 text-[#F97316]" />}
                            </div>
                        )}
                    {job.status === 'running' && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                            <div className="h-full bg-[#F97316] transition-all duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
                        </div>
                    )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug text-white" title={job.title}>{job.title}</p>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', chip.className)}>{chip.label}</span>
                    </div>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#777]">
                        <span className="inline-flex items-center gap-1"><MonitorPlay className="h-3 w-3" /> ~{formatDuration(job.estimates.longAudioSeconds)}</span>
                        <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" /> ~{formatDuration(job.estimates.shortAudioSeconds)}</span>
                        {active && job.status === 'running' && <span className="inline-flex items-center gap-1 text-[#B8B9BC]"><Clock className="h-3 w-3" /> {formatEta(jobEta(job, now))} left</span>}
                        {!active && elapsed && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> took {formatDuration(elapsed)}</span>}
                    </p>
                    {active && (
                        <p className="truncate text-xs text-[#B8B9BC]">
                            {job.status === 'queued' ? 'Waiting for the current job to finish'
                                : `${step?.label || 'Working'}${step && stepDetailText(step) ? ` · ${stepDetailText(step)}` : ''}`}
                        </p>
                    )}
                </div>
            </div>

            <div className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
                <StepTimeline job={job} />

                {job.error && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{job.error}</span>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    {job.status === 'done' && (
                        <>
                            {job.outputs.longVideo && (
                                <Button size="sm" onClick={() => setPreview(preview === 'long' ? null : 'long')} className="h-8 bg-[#F97316] text-white hover:bg-[#EA580C]">
                                    <Play className="mr-1.5 h-3.5 w-3.5" /> Long video
                                </Button>
                            )}
                            {job.outputs.shortVideo && (
                                <Button size="sm" variant="outline" onClick={() => setPreview(preview === 'short' ? null : 'short')} className="h-8 border-[#3A3A3A] bg-transparent text-white hover:bg-[#3A3A3A]">
                                    <Play className="mr-1.5 h-3.5 w-3.5" /> Promo short
                                </Button>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                                {[
                                    { href: job.outputs.longVideo, icon: Film, label: 'Download long video' },
                                    { href: job.outputs.shortVideo, icon: Smartphone, label: 'Download promo short' },
                                    { href: job.outputs.thumbnail, icon: ImageIcon, label: 'Download thumbnail' },
                                ].filter(l => l.href).map(l => (
                                    <a key={l.label} href={l.href} download title={l.label} className="relative rounded-md p-2 text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white">
                                        <l.icon className="h-4 w-4" />
                                        <Download className="absolute bottom-1 right-1 h-2.5 w-2.5" />
                                    </a>
                                ))}
                                <button
                                    type="button"
                                    title="Copy upload checklist"
                                    onClick={() => { navigator.clipboard?.writeText(checklist); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                                    className="rounded-md p-2 text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white"
                                >
                                    {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                </button>
                            </div>
                        </>
                    )}
                    {active && (
                        <Button size="sm" variant="outline" onClick={onCancel} className="h-8 border-[#3A3A3A] bg-transparent text-white hover:bg-[#3A3A3A]">
                            <Square className="mr-1.5 h-3 w-3" /> Cancel
                        </Button>
                    )}
                    {(job.status === 'failed' || job.status === 'cancelled') && (
                        <Button size="sm" onClick={onRetry} className="h-8 bg-[#F97316] text-white hover:bg-[#EA580C]">
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Resume
                        </Button>
                    )}
                </div>

                {preview && (
                    <div className="relative overflow-hidden rounded-lg bg-black">
                        <video
                            key={preview}
                            src={preview === 'long' ? job.outputs.longVideo : job.outputs.shortVideo}
                            controls
                            autoPlay
                            className={cn('mx-auto', preview === 'short' ? 'max-h-[480px]' : 'w-full')}
                        />
                        <button type="button" onClick={() => setPreview(null)} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80" aria-label="Close preview">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- page

export default function LongForm() {
    const { user } = useAuth();
    const userId = user?.id || 'default';
    const { jobs, loaded, activeCount, act, addJob, longCharsPerSecond } = useLongformJobs();
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [presets, setPresets] = useState<Preset[]>([]);
    const [channelId, setChannelId] = useState('');
    const [tab, setTab] = useState<Side>('long');
    const [sides, setSides] = useState<Record<Side, SideState>>({ long: emptySide, short: emptySide });
    const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!activeCount) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [activeCount]);

    useEffect(() => {
        if (userId === 'default') return;
        (async () => {
            try {
                const [profilesRes, presetsRes] = await Promise.all([
                    apiFetch(`/api/channel-profiles/${userId}`),
                    apiFetch(`/api/presets?userId=${userId}`),
                ]);
                const loadedProfiles = (await profilesRes.json()).profiles || [];
                setProfiles(loadedProfiles);
                setPresets(await presetsRes.json());
                if (loadedProfiles[0]) setChannelId(loadedProfiles[0].id);
            } catch (err) {
                console.error('[LongForm] Failed to load presets', err);
            }
        })();
    }, [userId]);

    const grouped = useMemo(() => ({
        audio: presets.filter(p => p.type === 'audio'),
        caption: presets.filter(p => p.type === 'caption_style'),
        hook: presets.filter(p => p.type === 'hook_style'),
    }), [presets]);

    const side = sides[tab];
    const setSide = (next: SideState) => setSides(prev => ({ ...prev, [tab]: next }));

    const videoSeconds = (s: Side) => {
        const preset = presets.find(p => p.id === sides[s].audioPresetId);
        // "Channel default" is unknown here; long-form jobs normally use the local voice
        const localRate = s === 'long' ? VIDEO_CHARS_PER_SECOND.long : VIDEO_CHARS_PER_SECOND.local;
        const rate = !preset || preset.ttsProvider === 'local' ? localRate : VIDEO_CHARS_PER_SECOND.other;
        // The whole video is narrated: its own hook, script and (promo short) the CTA line
        const script = s === 'short' && sides.short.script && !CTA_RE.test(sides.short.script.slice(-160))
            ? `${sides.short.script} ${CTA_LINE}` : sides[s].script;
        return (sides[s].hook.length + script.length) / rate;
    };
    const longSeconds = videoSeconds('long');
    // The promo short is sped up to fit its voice preset's length (a fixed target, or a length picked
    // from its min-max range), hook and CTA included, like a regular short
    const shortPreset = presets.find(p => p.id === sides.short.audioPresetId);
    const shortCap = shortPreset?.targetDurationMax || shortPreset?.targetDuration || null;
    const shortRawSeconds = videoSeconds('short');
    const shortSeconds = shortCap ? Math.min(shortRawSeconds, shortCap) : shortRawSeconds;
    const shortCapMin = shortPreset?.targetDurationMin && shortPreset.targetDurationMin < shortSeconds ? shortPreset.targetDurationMin : null;
    const shortLabel = shortCapMin ? `${formatDuration(shortCapMin)}–${formatDuration(shortSeconds)}` : formatDuration(shortSeconds);
    const readyInSeconds = sides.long.script.length
        ? sides.long.script.length / (longCharsPerSecond || DEFAULT_LONG_CHARS_PER_SECOND) + 40
        : 0;

    const sidePayload = (s: SideState) => ({
        hook: s.hook,
        script: s.script,
        audioPresetId: s.audioPresetId === NONE ? null : s.audioPresetId,
        captionPresetId: s.captionPresetId === NONE ? null : s.captionPresetId,
        hookStylePresetId: s.hookStylePresetId === NONE ? null : s.hookStylePresetId,
    });

    const submit = async () => {
        setError('');
        setNotice('');
        setSubmitting(true);
        try {
            const res = await apiFetch('/api/longform/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId: channelId || null, short: sidePayload(sides.short), long: sidePayload(sides.long) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not start the job');
            // Inputs are kept so a typo can be fixed and resubmitted
            addJob(data.job);
            setNotice('Job started. Follow it in the queue (top right); you can close this page.');
            setFilter('all');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    const missing = [!sides.long.hook.trim() && 'long hook', !sides.long.script.trim() && 'long script', !sides.short.hook.trim() && 'short hook', !sides.short.script.trim() && 'short script'].filter(Boolean) as string[];
    const canSubmit = missing.length === 0 && !submitting;
    const visibleJobs = jobs.filter(j => filter === 'all' || (filter === 'active' ? isActive(j) : j.status === 'done'));

    return (
        <div className="mx-auto max-w-[1700px] space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
                        <Clapperboard className="h-6 w-6 text-[#F97316]" /> Long Form
                    </h1>
                    <p className="mt-1 text-sm text-[#B8B9BC]">One story → a 16:9 long video, a 9:16 promo short that points to it, and a thumbnail.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
                {/* ------------------------------------------------ composer */}
                <div className="flex min-w-0 flex-col rounded-2xl border border-[#3A3A3A] bg-[#2A2A2A]">
                    <div className="flex items-center gap-2 border-b border-[#3A3A3A] px-5 py-4">
                        <Wand2 className="h-4 w-4 text-[#F97316]" />
                        <h2 className="font-semibold text-white">New video</h2>
                    </div>

                    <div className="space-y-6 p-5">
                        <div className="max-w-sm">
                            <Field label="Channel">
                                <Select value={channelId} onValueChange={setChannelId}>
                                    <SelectTrigger className="h-10 bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                        <SelectValue placeholder="Select a channel" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                        {profiles.map(p => (
                                            <SelectItem key={p.id} value={p.id} className="text-white">
                                                <span className="flex items-center gap-2">
                                                    {p.image_url ? <img src={p.image_url} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="h-5 w-5 rounded-full bg-[#F97316]" />}
                                                    {p.name}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>

                        {/* Scripts */}
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#1A1A1A] p-1">
                                {([
                                    { key: 'long', label: 'Long video', sub: '16:9 · 40–50 min', icon: MonitorPlay },
                                    { key: 'short', label: 'Promo short', sub: '9:16 · ~3 min', icon: Smartphone },
                                ] as const).map(t => (
                                    <button
                                        key={t.key}
                                        type="button"
                                        onClick={() => setTab(t.key)}
                                        className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                                            tab === t.key ? 'bg-[#F97316] text-white' : 'text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white')}
                                    >
                                        <t.icon className="h-4 w-4 shrink-0" />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium leading-tight">{t.label}</span>
                                            <span className={cn('block text-[11px] leading-tight', tab === t.key ? 'text-white/80' : 'text-[#777]')}>{t.sub}</span>
                                        </span>
                                        {sides[t.key].hook.trim() && sides[t.key].script.trim() && <CheckCircle2 className={cn('ml-auto h-4 w-4 shrink-0', tab === t.key ? 'text-white' : 'text-green-500')} />}
                                    </button>
                                ))}
                            </div>

                            <Field label="Hook" hint={`${side.hook.length} chars · ${tab === 'long' ? 'long video + thumbnail' : 'promo short only'}`}>
                                <textarea
                                    value={side.hook}
                                    onChange={e => setSide({ ...side, hook: e.target.value })}
                                    rows={3}
                                    placeholder={tab === 'long'
                                        ? 'My Sister Smiled In Front Of 38 Guests, Told My Fiancé I Only Wanted His Money, And Swore I Was Hiding A Secret Man…'
                                        : 'The hook for the promo short…'}
                                    className="w-full resize-none rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] px-3 py-2 text-sm text-white placeholder:text-[#555] focus:border-[#F97316] focus:outline-none"
                                />
                            </Field>

                            <textarea
                                value={side.script}
                                onChange={e => setSide({ ...side, script: e.target.value })}
                                placeholder={tab === 'long' ? 'Paste the full story…' : 'The opening of the story, up to a cliffhanger…'}
                                className={cn('w-full resize-y rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-[#555] focus:border-[#F97316] focus:outline-none',
                                    tab === 'long' ? 'min-h-[260px]' : 'min-h-[200px]')}
                            />
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#777]">
                                <span className="tabular-nums">{side.script.length.toLocaleString()} characters</span>
                                <span className="tabular-nums">≈ {tab === 'long' ? formatDuration(longSeconds) : shortLabel} of video{tab === 'short' && shortCap && shortRawSeconds > shortCap ? ' (sped up to fit the voice preset)' : ''}</span>
                                {tab === 'short' && side.script.trim() && !CTA_RE.test(side.script.slice(-160)) && (
                                    <span className="inline-flex items-center gap-1 text-[#B8B9BC]"><Sparkles className="h-3 w-3 text-[#F97316]" /> "{CTA_LINE}" is added at the end</span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <PresetSelect label="Voice" value={side.audioPresetId} onChange={v => setSide({ ...side, audioPresetId: v })} presets={grouped.audio} />
                                <PresetSelect label="Captions" value={side.captionPresetId} onChange={v => setSide({ ...side, captionPresetId: v })} presets={grouped.caption} />
                                <PresetSelect label="Hook card" value={side.hookStylePresetId} onChange={v => setSide({ ...side, hookStylePresetId: v })} presets={grouped.hook} />
                            </div>
                        </div>
                    </div>

                    {/* Submit bar */}
                    <div className="mt-auto space-y-3 border-t border-[#3A3A3A] bg-[#252525] px-5 py-4 rounded-b-2xl">
                        {error && (
                            <div className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">
                                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                            </div>
                        )}
                        {notice && (
                            <div className="flex items-center gap-2 rounded-lg border border-green-400/20 bg-green-400/10 px-3 py-2 text-sm text-green-300">
                                <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
                            </div>
                        )}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#B8B9BC]">
                                <span className="inline-flex items-center gap-1.5"><MonitorPlay className="h-3.5 w-3.5 text-[#777]" /> {sides.long.script ? `~${formatDuration(longSeconds)}` : '—'}</span>
                                <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-[#777]" /> {sides.short.script ? `~${shortLabel}` : '—'}</span>
                                <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#777]" /> {readyInSeconds ? `ready in ${formatEta(readyInSeconds)}` : 'add a script'}</span>
                            </div>
                            <Button onClick={submit} disabled={!canSubmit} className="h-10 bg-[#F97316] px-5 text-white hover:bg-[#EA580C] disabled:opacity-50" title={missing.length ? `Missing: ${missing.join(', ')}` : undefined}>
                                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
                                Create both videos
                            </Button>
                        </div>
                        {missing.length > 0 && <p className="text-right text-[11px] text-[#777]">Missing: {missing.join(', ')}</p>}
                    </div>
                </div>

                {/* ------------------------------------------------ job feed */}
                <div className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:self-start">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold text-white">
                            Jobs {activeCount > 0 && <span className="ml-1 rounded-full bg-[#F97316] px-2 py-0.5 text-xs text-white">{activeCount} active</span>}
                        </h2>
                        <div className="flex rounded-lg bg-[#1A1A1A] p-0.5 text-xs">
                            {(['all', 'active', 'done'] as const).map(f => (
                                <button key={f} type="button" onClick={() => setFilter(f)}
                                    className={cn('rounded-md px-2.5 py-1 capitalize transition-colors', filter === f ? 'bg-[#3A3A3A] text-white' : 'text-[#777] hover:text-white')}>
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto xl:pr-1">
                        {!loaded ? (
                            <div className="flex items-center justify-center rounded-2xl border border-dashed border-[#3A3A3A] py-16 text-[#777]">
                                <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                        ) : visibleJobs.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-[#3A3A3A] px-6 py-16 text-center">
                                <Film className="mx-auto h-8 w-8 text-[#555]" />
                                <p className="mt-3 text-sm font-medium text-white">{filter === 'all' ? 'No videos yet' : `No ${filter} jobs`}</p>
                                <p className="mt-1 text-xs text-[#777]">Jobs run in the background; you can leave this page.</p>
                            </div>
                        ) : visibleJobs.map(job => (
                            <JobCard key={job.id} job={job} now={now} onCancel={() => act(job.id, 'cancel')} onRetry={() => act(job.id, 'retry')} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
