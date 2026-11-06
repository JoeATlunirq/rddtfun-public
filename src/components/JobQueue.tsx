import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Clapperboard, Square, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLongformJobs } from '@/hooks/useLongformJobs';
import { currentStep, isActive, jobProgress, LongformJob, STEP_SHORT_LABELS, stepDetailText, formatEta, jobEta } from '@/types/longform';
import { cn } from '@/lib/utils';

/** Re-render every second so ETAs and progress count down between polls. */
function useNow(active: boolean) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [active]);
    return now;
}

function ProgressRing({ value, size = 18 }: { value: number; size?: number }) {
    const r = (size - 3) / 2;
    const c = 2 * Math.PI * r;
    return (
        <svg width={size} height={size} className="-rotate-90 shrink-0">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#3A3A3A" strokeWidth="2.5" />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - value)} className="transition-[stroke-dashoffset] duration-700" />
        </svg>
    );
}

function QueueRow({ job, now, onCancel }: { job: LongformJob; now: number; onCancel: () => void }) {
    const progress = jobProgress(job, now);
    const step = currentStep(job);
    const active = isActive(job);
    return (
        <div className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-[#2A2A2A]">
            <div className="relative h-11 w-[72px] shrink-0 overflow-hidden rounded-md bg-[#2A2A2A]">
                {job.outputs.thumbnail
                    ? <img src={job.outputs.thumbnail} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F97316]/25 to-[#2A2A2A]">
                        <Clapperboard className="h-4 w-4 text-[#F97316]" />
                    </div>}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-white" title={job.title}>{job.title}</p>
                    {job.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                    {job.status === 'failed' && <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />}
                    {active && (
                        <button type="button" onClick={onCancel} title="Cancel" className="rounded p-0.5 text-[#777] hover:bg-[#3A3A3A] hover:text-white">
                            <Square className="h-3 w-3" />
                        </button>
                    )}
                </div>
                {active ? (
                    <>
                        <p className="mt-0.5 truncate text-xs text-[#B8B9BC]">
                            {job.status === 'queued' ? 'Waiting in queue' : `${STEP_SHORT_LABELS[step?.id || ''] || step?.label || 'Working'}${stepDetailText(step!) ? ` · ${stepDetailText(step!)}` : ''}`}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2A2A2A]">
                                <div className="h-full rounded-full bg-[#F97316] transition-all duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-[#B8B9BC]">
                                {job.status === 'queued' ? 'queued' : `${Math.round(progress * 100)}% · ${formatEta(jobEta(job, now))}`}
                            </span>
                        </div>
                    </>
                ) : (
                    <p className="mt-0.5 truncate text-xs text-[#777]">
                        {job.status === 'done' ? `Ready · ${new Date(job.updatedAt || job.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                            : job.status === 'failed' ? 'Failed · open to resume' : 'Cancelled'}
                    </p>
                )}
            </div>
        </div>
    );
}

/** Branded toast in the corner when a job finishes while the app is open. Rendered once, in Layout. */
export function FinishedToasts() {
    const { finished, dismissFinished } = useLongformJobs();
    useEffect(() => {
        if (!finished.length) return;
        const timers = finished.map(j => setTimeout(() => dismissFinished(j.id), 10000));
        return () => timers.forEach(clearTimeout);
    }, [finished, dismissFinished]);
    if (!finished.length) return null;
    return (
        <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
            {finished.slice(0, 3).map(job => (
                <div key={job.id} className="flex items-start gap-3 rounded-xl border border-[#3A3A3A] bg-[#1F1F1F] p-3 shadow-2xl animate-in slide-in-from-bottom-2">
                    {job.status === 'done'
                        ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                        : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />}
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{job.status === 'done' ? 'Videos ready' : 'Video job failed'}</p>
                        <p className="truncate text-xs text-[#B8B9BC]">{job.title}</p>
                        <Link to="/longform" onClick={() => dismissFinished(job.id)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#F97316] hover:underline">
                            {job.status === 'done' ? 'Open downloads' : 'See error and resume'} <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                    <button type="button" onClick={() => dismissFinished(job.id)} className="rounded p-1 text-[#777] hover:bg-[#2A2A2A] hover:text-white" aria-label="Dismiss">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}

// Finished jobs older than this are hidden from the popup ("Clear"); per browser, jobs and videos are kept
const CLEARED_KEY = 'rddtfun_queue_cleared_at';
const readClearedAt = () => {
    try {
        return Number(localStorage.getItem(CLEARED_KEY)) || 0;
    } catch {
        return 0;
    }
};

/** Top-bar queue indicator: a live pill while jobs run, opening a dropdown with every job. */
export default function JobQueue({ compact = false }: { compact?: boolean }) {
    const { jobs, activeCount, act } = useLongformJobs();
    const now = useNow(activeCount > 0);
    const [clearedAt, setClearedAt] = useState(readClearedAt);
    const running = jobs.find(j => j.status === 'running');
    const overall = running ? jobProgress(running, now) : 0;
    const recent = jobs.filter(j => isActive(j) || (j.updatedAt || j.createdAt) > clearedAt).slice(0, 6);
    const clearable = recent.some(j => !isActive(j));
    const clear = () => {
        const at = Date.now();
        setClearedAt(at);
        try {
            localStorage.setItem(CLEARED_KEY, String(at));
        } catch { /* private mode: clears for this visit only */ }
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
                        activeCount > 0
                            ? 'border-[#F97316]/40 bg-[#F97316]/10 text-white hover:bg-[#F97316]/20'
                            : 'border-[#2A2A2A] bg-[#222222] text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white',
                    )}
                    aria-label="Video queue"
                >
                    {activeCount > 0 ? <ProgressRing value={overall} /> : <Clapperboard className="h-4 w-4" />}
                    {!compact && (activeCount > 0
                        ? <span className="tabular-nums">{running ? `Rendering · ${Math.round(overall * 100)}%` : `${activeCount} queued`}</span>
                        : <span>Queue</span>)}
                    {activeCount > 1 && <span className="rounded-full bg-[#F97316] px-1.5 text-[11px] leading-5 text-white">{activeCount}</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] p-0">
                <div className="flex items-center justify-between border-b border-[#2A2A2A] px-4 py-3">
                    <p className="text-sm font-semibold">Video queue</p>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-[#B8B9BC]">{activeCount > 0 ? `${activeCount} active` : 'All done'}</span>
                        {clearable && (
                            <button type="button" onClick={clear} className="text-xs font-medium text-[#F97316] hover:underline">
                                Clear
                            </button>
                        )}
                    </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-1.5">
                    {recent.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                            <Clapperboard className="mx-auto h-6 w-6 text-[#555]" />
                            <p className="mt-2 text-sm text-[#B8B9BC]">{jobs.length ? 'Nothing running' : 'No video jobs yet'}</p>
                        </div>
                    ) : recent.map(job => (
                        <QueueRow key={job.id} job={job} now={now} onCancel={() => act(job.id, 'cancel')} />
                    ))}
                </div>
                <Link to="/longform" className="flex items-center justify-between border-t border-[#2A2A2A] px-4 py-3 text-sm text-[#F97316] hover:bg-[#2A2A2A]">
                    Open Long Form <ArrowRight className="h-4 w-4" />
                </Link>
            </PopoverContent>
        </Popover>
    );
}
