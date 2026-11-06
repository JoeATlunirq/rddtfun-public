export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface JobStep {
    id: string;
    label: string;
    status: StepStatus;
    progress: number;
    startedAt?: number;
    finishedAt?: number;
    detail?: {
        framesDone?: number;
        totalFrames?: number;
        fps?: number;
        chunk?: number;
        chunks?: number;
        parts?: number;
        partsVoiced?: number;
        partsRendered?: number;
        charsPerSecond?: number;
        message?: string;
    };
}

export interface LongformJob {
    id: string;
    status: JobStatus;
    error: string | null;
    title: string;
    shortTitle: string;
    steps: JobStep[];
    outputs: { shortVideo?: string; longVideo?: string; thumbnail?: string };
    etaSeconds: number;
    createdAt: number;
    updatedAt?: number;
    estimates: { shortAudioSeconds: number; longAudioSeconds: number };
    /** Client-side: when this copy of the job was fetched (the ETA counts down from there). */
    receivedAt?: number;
}

export const isActive = (job: LongformJob) => job.status === 'queued' || job.status === 'running';

/** Seconds left, counting down smoothly from the last server ETA between polls. */
export function jobEta(job: LongformJob, now = Date.now()) {
    return Math.max(0, (job.etaSeconds || 0) - (job.receivedAt ? (now - job.receivedAt) / 1000 : 0));
}

/** Overall progress 0..1 from elapsed time and the ETA (steps have very different lengths). */
export function jobProgress(job: LongformJob, now = Date.now()) {
    if (job.status === 'done') return 1;
    const started = Math.min(...job.steps.map(s => s.startedAt || Infinity));
    if (!Number.isFinite(started) || job.status === 'queued') return 0;
    const elapsed = Math.max(0, (now - started) / 1000);
    return Math.min(0.99, elapsed / Math.max(1, elapsed + jobEta(job, now)));
}

/** Time left, rounded so it reads calmly: "~7 min", "~1 min", "<1 min". */
export function formatEta(seconds: number) {
    if (seconds < 50) return '<1 min';
    if (seconds < 90) return '~1 min';
    const minutes = Math.round(seconds / 60);
    return minutes >= 60 ? `~${Math.floor(minutes / 60)}h ${minutes % 60}m` : `~${minutes} min`;
}

/** The step that is running now, or the failed one. */
export const currentStep = (job: LongformJob) =>
    job.steps.find(s => s.status === 'running') || job.steps.find(s => s.status === 'failed') || null;

/** Short, human labels for the pipeline steps (the server's labels are long). */
export const STEP_SHORT_LABELS: Record<string, string> = {
    prepare: 'Setup',
    narrate_short: 'Short voice',
    long_video: 'Long video',
    render_short: 'Short render',
    thumbnail: 'Thumbnail',
    save: 'Save',
    // older jobs
    narrate_long: 'Long voice',
    render_long: 'Long render',
};

export function formatDuration(seconds: number) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${s}s`;
}

export function stepDetailText(step: JobStep) {
    const d = step.detail || {};
    if (step.status !== 'running') return '';
    if (d.message) return d.message;
    if (step.id === 'long_video' && d.parts) {
        return `voice ${d.partsVoiced || 0}/${d.parts} · video ${d.partsRendered || 0}/${d.parts}`;
    }
    if (d.totalFrames) return `${Math.round(d.fps || 0)} fps`;
    if (d.chunks) return `chunk ${d.chunk}/${d.chunks}`;
    return '';
}
