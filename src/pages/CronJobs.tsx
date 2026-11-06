import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Plus, Play, Pause, Trash2, Edit2, Clock, RefreshCw,
    CheckCircle2, XCircle, AlertCircle, Loader2, History,
    X, Zap, FileText, ArrowRight, ArrowLeft, Sparkles, Copy
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import type { ChannelProfile } from '@/types/channel';
import type { CronJob, CronJobExecution, CronJobFormData, AlgorithmConfig } from '@/types/cronJob';

// Constants
const SCHEDULE_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 2 hours', value: '0 */2 * * *' },
    { label: 'Every 4 hours', value: '0 */4 * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Once daily (midnight)', value: '0 0 * * *' },
    { label: 'Once daily (noon)', value: '0 12 * * *' },
    { label: 'Twice daily (8am & 8pm)', value: '0 8,20 * * *' },
];

const ALGORITHM_TYPES = [
    { value: 'random', label: 'Random Selection', description: 'Randomly select from qualifying videos' },
    { value: 'top_videos', label: 'Top Performing', description: 'Select the highest viewed video' },
];

const SCRIPT_MODES = [
    { value: 'w4w', label: 'Word for Word', description: 'Use the original script directly - no AI modification' },
    { value: 'claude_remake', label: 'Claude Remake', description: 'Use Claude AI to rewrite the script in your style' },
];

const TIMEFRAME_OPTIONS = [
    { value: '7d', label: 'Last 7 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '28d', label: 'Last 28 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '365d', label: 'All Time' },
];

const DEFAULT_CLAUDE_PROMPT = `You are a script writer for viral Reddit-style short form video content.

Based on the source video, create a new engaging script. Your response MUST include:

{HOOK}
Your attention-grabbing hook here (1-2 sentences)

{BODY}
Your main script content here (3-6 sentences)

The content should be conversational, authentic, and suitable for a 30-60 second video.`;

const DEFAULT_ALGORITHM_CONFIG: AlgorithmConfig = {
    channelHandles: [],
    channelIds: [],
    timeFrame: '28d',
    minViews: 10000,
    maxVideos: 10,
    source: 'viewstats',
};

export default function CronJobs() {
    const { user } = useAuth();
    const userId = user?.id || 'default';

    const [jobs, setJobs] = useState<CronJob[]>([]);
    const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [showWizard, setShowWizard] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [editingJob, setEditingJob] = useState<CronJob | null>(null);
    const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
    const [executions, setExecutions] = useState<CronJobExecution[]>([]);
    const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState('jobs');
    const [promptError, setPromptError] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState<CronJobFormData>({
        name: '',
        schedule: '0 */6 * * *',
        enabled: true,
        profile_id: null,
        algorithm_type: 'random',
        script_mode: 'w4w',
        algorithm_config: { ...DEFAULT_ALGORITHM_CONFIG },
        claude_prompt: DEFAULT_CLAUDE_PROMPT,
        videos_per_run: 1,
        telegram_notifications: true,
    });
    const [channelHandlesInput, setChannelHandlesInput] = useState('');

    useEffect(() => {
        if (userId !== 'default') {
            loadJobs();
            loadProfiles();
        }
    }, [userId]);

    const loadJobs = async () => {
        try {
            const response = await apiFetch(`/api/cron-jobs?userId=${userId}`);
            const data = await response.json();
            setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load cron jobs:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadProfiles = async () => {
        try {
            const response = await apiFetch(`/api/channel-profiles/${userId}`);
            const data = await response.json();
            setProfiles(data.profiles || []);
        } catch (err) {
            console.error('Failed to load profiles:', err);
        }
    };

    const loadExecutions = async (jobId: string) => {
        try {
            const response = await apiFetch(`/api/cron-jobs/${jobId}/executions`);
            const data = await response.json();
            setExecutions(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load executions:', err);
        }
    };

    const resetWizard = () => {
        setWizardStep(1);
        setEditingJob(null);
        setFormData({
            name: '',
            schedule: '0 */6 * * *',
            enabled: true,
            profile_id: profiles.length > 0 ? profiles[0].id : null,
            algorithm_type: 'random',
            script_mode: 'w4w',
            algorithm_config: { ...DEFAULT_ALGORITHM_CONFIG },
            claude_prompt: DEFAULT_CLAUDE_PROMPT,
            videos_per_run: 1,
            telegram_notifications: true,
        });
        setChannelHandlesInput('');
        setPromptError(null);
    };

    const handleCreateJob = () => {
        resetWizard();
        setShowWizard(true);
    };

    const handleEditJob = (job: CronJob) => {
        setEditingJob(job);
        setFormData({
            name: job.name,
            schedule: job.schedule,
            enabled: job.enabled,
            profile_id: job.profile_id,
            algorithm_type: job.algorithm_type || 'random',
            script_mode: job.script_mode || 'w4w',
            algorithm_config: job.algorithm_config || { ...DEFAULT_ALGORITHM_CONFIG },
            claude_prompt: job.claude_prompt || DEFAULT_CLAUDE_PROMPT,
            videos_per_run: job.videos_per_run,
            telegram_notifications: job.telegram_notifications,
        });
        setChannelHandlesInput(job.algorithm_config?.channelHandles?.join(', ') || '');
        setWizardStep(1);
        setPromptError(null);
        setShowWizard(true);
    };

    // Pure check function - safe to call during render (no side effects)
    const canProceed = (step: number): boolean => {
        switch (step) {
            case 1:
                return !!formData.name && !!formData.schedule && !!formData.profile_id;
            case 2:
                return channelHandlesInput.trim().length > 0;
            case 3:
                if (formData.script_mode === 'claude_remake') {
                    const hasHook = formData.claude_prompt.includes('{HOOK}');
                    const hasBody = formData.claude_prompt.includes('{BODY}');
                    return hasHook && hasBody;
                }
                return true;
            default:
                return true;
        }
    };

    const handleNext = () => {
        // Validate step 3 prompt and set error if needed
        if (wizardStep === 3 && formData.script_mode === 'claude_remake') {
            const hasHook = formData.claude_prompt.includes('{HOOK}');
            const hasBody = formData.claude_prompt.includes('{BODY}');
            if (!hasHook || !hasBody) {
                setPromptError('Prompt must include {HOOK} and {BODY} placeholders');
                return;
            }
            setPromptError(null);
        }
        if (canProceed(wizardStep)) {
            setWizardStep(s => s + 1);
        }
    };

    const handleBack = () => {
        setWizardStep(s => s - 1);
    };

    const handleSaveJob = async () => {
        const channelHandles = channelHandlesInput
            .split(',')
            .map(h => h.trim())
            .filter(h => h.length > 0);

        const jobData = {
            user_id: userId,
            ...formData,
            algorithm_config: {
                ...formData.algorithm_config,
                channelHandles,
            },
        };

        try {
            if (editingJob) {
                const response = await apiFetch(`/api/cron-jobs/${editingJob.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(jobData),
                });
                if (!response.ok) throw new Error('Failed to update job');
            } else {
                const response = await apiFetch('/api/cron-jobs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(jobData),
                });
                if (!response.ok) throw new Error('Failed to create job');
            }

            setShowWizard(false);
            loadJobs();
        } catch (err) {
            console.error('Failed to save job:', err);
            alert('Failed to save job. Please try again.');
        }
    };

    const handleDeleteJob = async (jobId: string) => {
        if (!confirm('Are you sure you want to delete this job?')) return;
        try {
            await apiFetch(`/api/cron-jobs/${jobId}`, { method: 'DELETE' });
            loadJobs();
            if (selectedJob?.id === jobId) {
                setSelectedJob(null);
                setExecutions([]);
            }
        } catch (err) {
            console.error('Failed to delete job:', err);
        }
    };

    const handleToggleJob = async (job: CronJob) => {
        try {
            await apiFetch(`/api/cron-jobs/${job.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !job.enabled }),
            });
            loadJobs();
        } catch (err) {
            console.error('Failed to toggle job:', err);
        }
    };

    const handleRunNow = async (job: CronJob) => {
        setRunningJobs(prev => new Set(prev).add(job.id));
        try {
            const response = await apiFetch(`/api/cron-jobs/${job.id}/run`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed');
            if (selectedJob?.id === job.id) loadExecutions(job.id);
            loadJobs();
        } catch (err: any) {
            alert(`Failed: ${err.message}`);
        } finally {
            setRunningJobs(prev => { const n = new Set(prev); n.delete(job.id); return n; });
        }
    };

    const handleViewExecutions = (job: CronJob) => {
        setSelectedJob(job);
        loadExecutions(job.id);
        setActiveTab('history');
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'success':
                return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" /> Success</Badge>;
            case 'failed':
                return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
            case 'running':
            case 'researching':
            case 'generating_script':
            case 'rendering':
                return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running</Badge>;
            default:
                return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><AlertCircle className="w-3 h-3 mr-1" /> {status}</Badge>;
        }
    };

    const formatRelativeTime = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
        return `${Math.floor(mins / 1440)}d ago`;
    };

    // Wizard Step 1: Basic Info
    const renderStep1 = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-semibold text-white">Step 1: Basic Settings</h3>
                <p className="text-sm text-[#B8B9BC] mt-1">Name your job and choose when to run</p>
            </div>
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-white">Job Name *</Label>
                    <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="My Daily Videos"
                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                    />
                </div>
                <div className="space-y-2">
                    <Label className="text-white">Schedule *</Label>
                    <Select value={formData.schedule} onValueChange={(v) => setFormData({ ...formData, schedule: v })}>
                        <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] z-[10000]">
                            {SCHEDULE_PRESETS.map(p => (
                                <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="text-white">Channel Profile *</Label>
                    <Select value={formData.profile_id || ''} onValueChange={(v) => setFormData({ ...formData, profile_id: v })}>
                        <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white"><SelectValue placeholder="Select profile..." /></SelectTrigger>
                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] z-[10000]">
                            {profiles.map(p => (
                                <SelectItem key={p.id} value={p.id} className="text-white">{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-[#B8B9BC]">The voice, style, and settings for generated videos</p>
                </div>
            </div>
        </div>
    );

    // Wizard Step 2: Research Settings
    const renderStep2 = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-semibold text-white">Step 2: Research Settings</h3>
                <p className="text-sm text-[#B8B9BC] mt-1">Configure how to find source videos</p>
            </div>
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-white">Competitor Channels *</Label>
                    <Input
                        value={channelHandlesInput}
                        onChange={(e) => setChannelHandlesInput(e.target.value)}
                        placeholder="@channel1, @channel2, @channel3"
                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                    />
                    <p className="text-xs text-[#B8B9BC]">YouTube channel handles to research (comma-separated)</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-white">Selection Algorithm</Label>
                        <Select value={formData.algorithm_type} onValueChange={(v: any) => setFormData({ ...formData, algorithm_type: v })}>
                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] z-[10000]">
                                {ALGORITHM_TYPES.map(a => (
                                    <SelectItem key={a.value} value={a.value} className="text-white">{a.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-white">Time Frame</Label>
                        <Select value={formData.algorithm_config.timeFrame} onValueChange={(v: any) => setFormData({ ...formData, algorithm_config: { ...formData.algorithm_config, timeFrame: v } })}>
                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] z-[10000]">
                                {TIMEFRAME_OPTIONS.map(t => (
                                    <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label className="text-white">Minimum Views</Label>
                    <Input
                        type="number"
                        value={formData.algorithm_config.minViews}
                        onChange={(e) => setFormData({ ...formData, algorithm_config: { ...formData.algorithm_config, minViews: parseInt(e.target.value) || 0 } })}
                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                    />
                    <p className="text-xs text-[#B8B9BC]">Only select videos with at least this many views</p>
                </div>
            </div>
        </div>
    );

    // Wizard Step 3: Script Mode
    const renderStep3 = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-semibold text-white">Step 3: Script Mode</h3>
                <p className="text-sm text-[#B8B9BC] mt-1">Choose how to generate the video script</p>
            </div>

            {/* Script Mode Selection */}
            <div className="grid grid-cols-2 gap-4">
                {SCRIPT_MODES.map(mode => (
                    <button
                        key={mode.value}
                        onClick={() => setFormData({ ...formData, script_mode: mode.value as 'w4w' | 'claude_remake' })}
                        className={`p-4 rounded-lg border-2 text-left transition-colors ${formData.script_mode === mode.value
                            ? 'border-[#F97316] bg-[#F97316]/10'
                            : 'border-[#3A3A3A] bg-[#1A1A1A] hover:border-[#F97316]/50'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            {mode.value === 'w4w' ? <Copy className="w-5 h-5 text-[#F97316]" /> : <Sparkles className="w-5 h-5 text-[#F97316]" />}
                            <span className="font-semibold text-white">{mode.label}</span>
                        </div>
                        <p className="text-sm text-[#B8B9BC]">{mode.description}</p>
                    </button>
                ))}
            </div>

            {/* Claude Prompt (only if claude_remake) */}
            {formData.script_mode === 'claude_remake' && (
                <div className="space-y-2 pt-4 border-t border-[#3A3A3A]">
                    <Label className="text-white">Claude Prompt</Label>
                    <p className="text-xs text-[#B8B9BC]">
                        Must include <code className="bg-[#1A1A1A] px-1 rounded">{'{HOOK}'}</code> and <code className="bg-[#1A1A1A] px-1 rounded">{'{BODY}'}</code> placeholders
                    </p>
                    <Textarea
                        value={formData.claude_prompt}
                        onChange={(e) => { setFormData({ ...formData, claude_prompt: e.target.value }); setPromptError(null); }}
                        rows={8}
                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white font-mono text-sm resize-none"
                    />
                    {promptError && <p className="text-sm text-red-400">{promptError}</p>}
                </div>
            )}
        </div>
    );

    // Wizard Step 4: Review
    const renderStep4 = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-semibold text-white">Step 4: Review & Create</h3>
                <p className="text-sm text-[#B8B9BC] mt-1">Confirm your job settings</p>
            </div>

            <div className="space-y-4 bg-[#1A1A1A] rounded-lg p-4">
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Job Name</span>
                    <span className="text-white font-medium">{formData.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Schedule</span>
                    <span className="text-white">{SCHEDULE_PRESETS.find(p => p.value === formData.schedule)?.label}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Profile</span>
                    <span className="text-white">{profiles.find(p => p.id === formData.profile_id)?.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Channels</span>
                    <span className="text-white">{channelHandlesInput.split(',').filter(c => c.trim()).length} channels</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Algorithm</span>
                    <span className="text-white">{ALGORITHM_TYPES.find(a => a.value === formData.algorithm_type)?.label}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#3A3A3A]">
                    <span className="text-[#B8B9BC]">Script Mode</span>
                    <span className="text-white">{SCRIPT_MODES.find(m => m.value === formData.script_mode)?.label}</span>
                </div>
                <div className="flex justify-between py-2">
                    <span className="text-[#B8B9BC]">Time Frame</span>
                    <span className="text-white">{TIMEFRAME_OPTIONS.find(t => t.value === formData.algorithm_config.timeFrame)?.label}</span>
                </div>
            </div>

            <div className="flex items-center justify-between pt-4">
                <div><Label className="text-white">Telegram Notifications</Label></div>
                <Switch checked={formData.telegram_notifications} onCheckedChange={(v) => setFormData({ ...formData, telegram_notifications: v })} />
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white">Scheduled Jobs</h2>
                    <p className="text-[#B8B9BC] mt-1">Automate video generation with competitor research</p>
                </div>
                <Button onClick={handleCreateJob} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                    <Plus className="mr-2 h-4 w-4" />
                    New Job
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <TabsTrigger value="jobs">Active Jobs</TabsTrigger>
                    <TabsTrigger value="history">Execution History</TabsTrigger>
                </TabsList>

                <TabsContent value="jobs" className="mt-4">
                    {loading ? (
                        <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                            <CardContent className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 text-[#F97316] animate-spin" />
                                <span className="ml-2 text-[#B8B9BC]">Loading jobs...</span>
                            </CardContent>
                        </Card>
                    ) : jobs.length === 0 ? (
                        <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4">
                                    <Clock className="w-6 h-6 text-[#F97316]" />
                                </div>
                                <h4 className="text-lg font-medium text-white mb-2">No Scheduled Jobs</h4>
                                <p className="text-sm text-[#B8B9BC] text-center mb-4 max-w-md">Create your first job to automate video generation.</p>
                                <Button onClick={handleCreateJob} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    <Plus className="w-4 h-4 mr-2" />Create First Job
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4">
                            {jobs.map((job) => (
                                <Card key={job.id} className="bg-[#2A2A2A] border-[#3A3A3A] hover:border-[#F97316]/50 transition-colors">
                                    <CardContent className="p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full overflow-hidden border border-[#3A3A3A] bg-[#3A3A3A] flex items-center justify-center">
                                                    {job.channel_profiles?.image_url ? (
                                                        <img src={job.channel_profiles.image_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Zap className="w-5 h-5 text-[#F97316]" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-medium text-white">{job.name}</h3>
                                                        <Badge variant="outline" className={job.enabled ? 'border-green-500/50 text-green-400' : 'border-gray-500/50 text-gray-400'}>
                                                            {job.enabled ? 'Active' : 'Paused'}
                                                        </Badge>
                                                        <Badge variant="outline" className="border-[#F97316]/50 text-[#F97316]">
                                                            {job.script_mode === 'w4w' ? 'W4W' : 'Claude'}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 text-sm text-[#B8B9BC]">
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {SCHEDULE_PRESETS.find(p => p.value === job.schedule)?.label || job.schedule}
                                                        </span>
                                                        {job.channel_profiles && <span>• {job.channel_profiles.name}</span>}
                                                        {job.last_run && <span>• Last: {formatRelativeTime(job.last_run)}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => handleViewExecutions(job)} className="text-[#B8B9BC] hover:text-white"><History className="w-4 h-4" /></Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleRunNow(job)} disabled={runningJobs.has(job.id)} className="text-[#B8B9BC] hover:text-white">
                                                    {runningJobs.has(job.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleToggleJob(job)} className="text-[#B8B9BC] hover:text-white">
                                                    {job.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleEditJob(job)} className="text-[#B8B9BC] hover:text-white"><Edit2 className="w-4 h-4" /></Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteJob(job.id)} className="text-[#B8B9BC] hover:text-red-400"><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-white">{selectedJob ? `History: ${selectedJob.name}` : 'Execution History'}</CardTitle>
                                    <CardDescription className="text-[#B8B9BC]">{selectedJob ? 'Past executions' : 'Select a job'}</CardDescription>
                                </div>
                                {selectedJob && <Button variant="ghost" size="sm" onClick={() => loadExecutions(selectedJob.id)}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {!selectedJob ? (
                                <div className="text-center py-8 text-[#B8B9BC]"><History className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>Select a job from Active Jobs</p></div>
                            ) : executions.length === 0 ? (
                                <div className="text-center py-8 text-[#B8B9BC]"><FileText className="w-8 h-8 mx-auto mb-2 opacity-50" /><p>No executions yet</p></div>
                            ) : (
                                <div className="space-y-3">
                                    {executions.map((exec) => (
                                        <div key={exec.id} className="p-4 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">{getStatusBadge(exec.status)}<span className="text-sm text-[#B8B9BC]">{new Date(exec.started_at).toLocaleString()}</span></div>
                                                {exec.video_url && <a href={exec.video_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#F97316] hover:underline">View Video</a>}
                                            </div>
                                            {exec.source_video && <div className="text-sm text-[#B8B9BC] mt-2"><span className="text-white">Source:</span> {exec.source_video.title}</div>}
                                            {exec.generated_hook && <div className="text-sm text-[#B8B9BC] mt-2"><span className="text-white">Hook:</span> {exec.generated_hook}</div>}
                                            {exec.error_message && <div className="text-sm text-red-400 mt-2"><span className="text-white">Error:</span> {exec.error_message}</div>}

                                            {/* Metadata section */}
                                            {exec.metadata && (
                                                <div className="mt-3 pt-3 border-t border-[#3A3A3A] grid grid-cols-2 gap-2 text-xs">
                                                    {exec.metadata.source_video && (
                                                        <div className="col-span-2">
                                                            <span className="text-[#B8B9BC]">Source: </span>
                                                            <span className="text-white">{exec.metadata.source_video.channel}</span>
                                                            {exec.metadata.source_video.views && <span className="text-[#B8B9BC]"> • {(exec.metadata.source_video.views / 1000).toFixed(0)}K views</span>}
                                                        </div>
                                                    )}
                                                    {exec.metadata.presets?.caption && (
                                                        <div><span className="text-[#B8B9BC]">Caption: </span><span className="text-white">{exec.metadata.presets.caption}</span></div>
                                                    )}
                                                    {exec.metadata.presets?.audio && (
                                                        <div><span className="text-[#B8B9BC]">Voice: </span><span className="text-white">{exec.metadata.presets.audio}</span></div>
                                                    )}
                                                    {exec.metadata.settings?.target_duration && (
                                                        <div><span className="text-[#B8B9BC]">Target: </span><span className="text-white">{exec.metadata.settings.target_duration}s</span></div>
                                                    )}
                                                    {exec.metadata.settings?.add_background_music && (
                                                        <div><span className="text-green-400">🎵 Music</span></div>
                                                    )}
                                                    {exec.metadata.detected_gender && (
                                                        <div><span className="text-[#B8B9BC]">Voice: </span><span className="text-white">{exec.metadata.detected_gender}</span></div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}           </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Multi-Step Wizard Modal */}
            {showWizard && createPortal(
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A] w-full max-w-xl">
                        <CardHeader className="border-b border-[#3A3A3A]">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-white">{editingJob ? 'Edit Job' : 'Create New Job'}</CardTitle>
                                <Button variant="ghost" size="icon" onClick={() => setShowWizard(false)} className="text-[#B8B9BC] hover:text-white"><X className="w-4 h-4" /></Button>
                            </div>
                            {/* Step Indicator */}
                            <div className="flex items-center justify-center gap-2 mt-4">
                                {[1, 2, 3, 4].map(step => (
                                    <div key={step} className="flex items-center">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${wizardStep === step ? 'bg-[#F97316] text-white' :
                                            wizardStep > step ? 'bg-green-500 text-white' : 'bg-[#3A3A3A] text-[#B8B9BC]'
                                            }`}>{wizardStep > step ? <CheckCircle2 className="w-4 h-4" /> : step}</div>
                                        {step < 4 && <div className={`w-12 h-0.5 mx-1 ${wizardStep > step ? 'bg-green-500' : 'bg-[#3A3A3A]'}`} />}
                                    </div>
                                ))}
                            </div>
                        </CardHeader>
                        <CardContent className="py-6">
                            {wizardStep === 1 && renderStep1()}
                            {wizardStep === 2 && renderStep2()}
                            {wizardStep === 3 && renderStep3()}
                            {wizardStep === 4 && renderStep4()}
                        </CardContent>
                        <div className="flex justify-between px-6 py-4 border-t border-[#3A3A3A]">
                            <Button variant="ghost" onClick={wizardStep === 1 ? () => setShowWizard(false) : handleBack} className="text-[#B8B9BC]">
                                {wizardStep === 1 ? 'Cancel' : <><ArrowLeft className="w-4 h-4 mr-2" />Back</>}
                            </Button>
                            {wizardStep < 4 ? (
                                <Button onClick={handleNext} disabled={!canProceed(wizardStep)} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    Next<ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            ) : (
                                <Button onClick={handleSaveJob} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    {editingJob ? 'Save Changes' : 'Create Job'}
                                </Button>
                            )}
                        </div>
                    </Card>
                </div>,
                document.body
            )}
        </div>
    );
}
