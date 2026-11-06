import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { isActive, LongformJob } from '@/types/longform';

interface JobsContextValue {
    jobs: LongformJob[];
    loaded: boolean;
    activeCount: number;
    reload: () => Promise<void>;
    act: (id: string, verb: 'cancel' | 'retry') => Promise<void>;
    addJob: (job: LongformJob) => void;
    /** Jobs that finished (or failed) while the app was open, newest first; the queue shows them as toasts. */
    finished: LongformJob[];
    dismissFinished: (id: string) => void;
    /** Measured long-video speed from past jobs (script chars per second of wall time), if any. */
    longCharsPerSecond: number | null;
}

const JobsContext = createContext<JobsContextValue | null>(null);

/** One poller for the whole app: the top-bar queue and the Long Form page read the same jobs. */
export function LongformJobsProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [jobs, setJobs] = useState<LongformJob[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [finished, setFinished] = useState<LongformJob[]>([]);
    const [longCharsPerSecond, setLongCharsPerSecond] = useState<number | null>(null);
    const lastStatus = useRef<Map<string, string>>(new Map());

    const reload = useCallback(async () => {
        try {
            const res = await apiFetch('/api/longform/jobs');
            if (!res.ok) return;
            const body = await res.json();
            const receivedAt = Date.now();
            const next: LongformJob[] = (body.jobs || []).map((j: LongformJob) => ({ ...j, receivedAt }));
            setLongCharsPerSecond(body.speed?.longCharsPerSecond ?? null);
            // A job that was running when we last looked and is now done/failed gets a toast
            const ended = next.filter(j => {
                const before = lastStatus.current.get(j.id);
                return before && (before === 'running' || before === 'queued') && (j.status === 'done' || j.status === 'failed');
            });
            lastStatus.current = new Map(next.map(j => [j.id, j.status]));
            if (ended.length) {
                setFinished(prev => [...ended, ...prev.filter(p => !ended.some(e => e.id === p.id))]);
                ended.forEach(job => {
                    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
                        new Notification(job.status === 'done' ? 'Videos ready' : 'Video job failed', { body: job.title, icon: '/getbrainrot-logo.png' });
                    }
                });
            }
            setJobs(next);
        } catch (err) {
            console.error('[Queue] Failed to load jobs', err);
        } finally {
            setLoaded(true);
        }
    }, []);

    const activeCount = jobs.filter(isActive).length;
    useEffect(() => {
        // Team-only accounts (from a team invite) can't run video jobs
        if (!user || user.app_metadata?.team_only === true) return;
        reload();
        const interval = setInterval(reload, activeCount > 0 ? 2000 : 15000);
        return () => clearInterval(interval);
    }, [user, activeCount, reload]);

    const act = useCallback(async (id: string, verb: 'cancel' | 'retry') => {
        await apiFetch(`/api/longform/jobs/${id}/${verb}`, { method: 'POST' });
        await reload();
    }, [reload]);

    const addJob = useCallback((job: LongformJob) => {
        lastStatus.current.set(job.id, job.status);
        setJobs(prev => [{ ...job, receivedAt: Date.now() }, ...prev.filter(j => j.id !== job.id)]);
        // Ask once, when the user first starts a job, so a finished render can notify a background tab
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
    }, []);

    const dismissFinished = useCallback((id: string) => setFinished(prev => prev.filter(j => j.id !== id)), []);

    return (
        <JobsContext.Provider value={{ jobs, loaded, activeCount, reload, act, addJob, finished, dismissFinished, longCharsPerSecond }}>
            {children}
        </JobsContext.Provider>
    );
}

export function useLongformJobs() {
    const value = useContext(JobsContext);
    if (!value) throw new Error('useLongformJobs must be used inside LongformJobsProvider');
    return value;
}
