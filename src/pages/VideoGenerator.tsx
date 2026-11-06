import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, AlertCircle, CheckCircle2, Loader2, RefreshCw, Music, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';

interface Profile {
    id: string;
    name: string;
    nickname?: string;
    image_url?: string;
    font: string;
    style: 'single' | 'grouped';
    background_video_type: string;
    hook_animation_type: 'fall' | 'float';
    subtitle_size: number;
    stroke_size: number;
    caption_animation_type?: 'scale' | 'slide' | 'fade' | 'motion-blur' | 'none';
    visual_filter?: 'none' | 'vibrant' | 'dark' | 'warm' | 'cool';
    caption_preset_id?: string;
    hook_style_preset_id?: string;
    male_voice_preset_id?: string;
    female_voice_preset_id?: string;
    visual_filter_preset_id?: string;
}

interface AudioPreset {
    id: string;
    name: string;
    voiceId: string;
    voiceName?: string;
    ttsProvider?: 'elevenlabs' | 'fish' | 'vibi' | 'local';
    fishAudioModelId?: string;
    fishAudioModelName?: string;
    vibiVoiceId?: string;
    vibiVoiceName?: string;
    localVoiceId?: string;
    localVoiceName?: string;
}

interface UserSettings {
    elevenlabs_api_key?: string;
    fish_audio_api_key?: string;
    vibi_api_key?: string;
}

type GenerationStatus = 'idle' | 'audio_processing' | 'video_processing' | 'complete' | 'error';

export default function VideoGenerator() {
    const { user } = useAuth();
    const userId = user?.id || 'default';

    // Form state
    const [hook, setHook] = useState('');
    const [script, setScript] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [selectedAudioPresetId, setSelectedAudioPresetId] = useState<string>('');

    // Resources
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [audioPresets, setAudioPresets] = useState<AudioPreset[]>([]);
    const [userSettings, setUserSettings] = useState<UserSettings>({});

    // Generation state
    const [status, setStatus] = useState<GenerationStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [statusDetail, setStatusDetail] = useState('');
    const [error, setError] = useState('');
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');

    useEffect(() => {
        if (userId !== 'default') {
            loadData();
        }
    }, [userId]);

    const loadData = async () => {
        try {
            const [profilesRes, presetsRes, settingsRes] = await Promise.all([
                apiFetch(`/api/channel-profiles/${userId}`),
                apiFetch(`/api/presets?userId=${userId}`),
                apiFetch(`/api/user-settings/${userId}`)
            ]);

            const profilesData = await profilesRes.json();
            const presetsData = await presetsRes.json();
            const settingsData = await settingsRes.json();

            const loadedProfiles = profilesData.profiles || [];
            const audioOnly = presetsData.filter((p: any) => p.type === 'audio');
            setProfiles(loadedProfiles);
            setAudioPresets(audioOnly);

            if (loadedProfiles.length > 0) {
                const firstProfile = loadedProfiles[0];
                const assignedAudioPresetId = firstProfile.female_voice_preset_id || firstProfile.male_voice_preset_id;
                setSelectedProfileId(firstProfile.id);
                setSelectedAudioPresetId(
                    audioOnly.some((preset: AudioPreset) => preset.id === assignedAudioPresetId)
                        ? assignedAudioPresetId
                        : audioOnly[0]?.id || ''
                );
            } else if (audioOnly.length > 0) {
                setSelectedAudioPresetId(audioOnly[0].id);
            }

            // Map settings ensuring both cases are handled
            setUserSettings({
                elevenlabs_api_key: settingsData.elevenlabs_api_key || settingsData.elevenlabsApiKey,
                fish_audio_api_key: settingsData.fish_audio_api_key || settingsData.fishAudioApiKey,
                vibi_api_key: settingsData.vibi_api_key || settingsData.vibiApiKey
            });
        } catch (err) {
            console.error('Error loading data:', err);
        }
    };

    const selectedProfile = profiles.find(p => p.id === selectedProfileId);
    const selectedAudioPreset = audioPresets.find(p => p.id === selectedAudioPresetId);

    const PROVIDER_LABELS: Record<string, string> = {
        elevenlabs: 'ElevenLabs',
        fish: 'Fish Audio',
        vibi: 'Vibi',
        local: 'Local TTS',
    };
    const providerOf = (preset?: AudioPreset) => preset?.ttsProvider || 'elevenlabs';
    const providerLabelOf = (preset?: AudioPreset) => PROVIDER_LABELS[providerOf(preset)];
    const voiceNameOf = (preset?: AudioPreset) => {
        const prov = providerOf(preset);
        if (prov === 'vibi') return preset?.vibiVoiceName;
        if (prov === 'fish') return preset?.fishAudioModelName;
        if (prov === 'local') return preset?.localVoiceName || preset?.localVoiceId;
        return preset?.voiceName;
    };
    const hasKeyForProvider = (prov: string) => {
        if (prov === 'vibi') return Boolean(userSettings.vibi_api_key);
        if (prov === 'fish') return Boolean(userSettings.fish_audio_api_key);
        // Local TTS runs on this machine and needs no key.
        if (prov === 'local') return true;
        return Boolean(userSettings.elevenlabs_api_key);
    };

    const selectProfile = (profileId: string) => {
        const profile = profiles.find(item => item.id === profileId);
        const assignedAudioPresetId = profile?.female_voice_preset_id || profile?.male_voice_preset_id;
        setSelectedProfileId(profileId);
        if (assignedAudioPresetId && audioPresets.some(preset => preset.id === assignedAudioPresetId)) {
            setSelectedAudioPresetId(assignedAudioPresetId);
        }
    };

    const generateVideo = async () => {
        if (!hook.trim() || !script.trim()) {
            setError('Please enter both hook and script');
            return;
        }

        if (!selectedProfile) {
            setError('Please select a channel profile');
            return;
        }

        if (!selectedAudioPresetId) {
            setError('Please select an audio preset');
            return;
        }

        // Only require the key for the provider this preset actually uses.
        const provider = providerOf(selectedAudioPreset);
        const apiKey = userSettings.elevenlabs_api_key;

        if (provider === 'vibi' && !userSettings.vibi_api_key) {
            setError('Please configure your Vibi API key in Settings');
            return;
        }
        if (provider === 'fish' && !userSettings.fish_audio_api_key) {
            setError('Please configure your Fish Audio API key in Settings');
            return;
        }
        if (provider === 'elevenlabs' && !apiKey) {
            setError('Please configure your ElevenLabs API key in Settings');
            return;
        }

        setStatus('audio_processing');
        setProgress(0);
        setStatusDetail('Starting...');
        setError('');
        setGeneratedVideoUrl('');

        console.log('[Generate Video] Request Body:', JSON.stringify({
            hook,
            channelId: selectedProfile.id,
            audio_preset_id: selectedAudioPresetId,
            caption_preset_id: selectedProfile.caption_preset_id,
            hook_style_preset_id: selectedProfile.hook_style_preset_id
        }, null, 2));

        try {
            const response = await apiFetch('/api/generate-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hook,
                    script,
                    userId,
                    channelId: selectedProfile.id,
                    channelName: selectedProfile.name,
                    channelImageUrl: selectedProfile.image_url || '',
                    channelFont: selectedProfile.font,
                    channelStyle: selectedProfile.style,
                    elevenlabsApiKey: apiKey,
                    subtitle_size: selectedProfile.subtitle_size,
                    stroke_size: selectedProfile.stroke_size,
                    background_video_type: selectedProfile.background_video_type,
                    hook_animation_type: selectedProfile.hook_animation_type,
                    caption_animation_type: selectedProfile.caption_animation_type,
                    audio_preset_id: selectedAudioPresetId,
                    caption_preset_id: selectedProfile.caption_preset_id,
                    hook_style_preset_id: selectedProfile.hook_style_preset_id
                })
            });

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n\n').filter(l => l.trim());

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);

                            if (data.type === 'status_update') {
                                if (data.message && data.status !== 'error') {
                                    setStatusDetail(data.message);
                                }
                                if (data.status === 'audio_processing') {
                                    setStatus('audio_processing');
                                } else if (data.status === 'audio_complete') {
                                    setStatus('video_processing');
                                    setProgress(10);
                                } else if (data.status === 'video_processing') {
                                    setStatus('video_processing');
                                } else if (data.status === 'video_complete') {
                                    setStatus('complete');
                                    setProgress(100);
                                    setStatusDetail('');
                                    if (data.hookVideo) setGeneratedVideoUrl(data.hookVideo);
                                } else if (data.status === 'error') {
                                    setStatus('error');
                                    setError(data.message || 'Video generation failed');
                                }
                            } else if (data.type === 'step_progress') {
                                if (data.stepId === 'video_generation') {
                                    setProgress(15 + (data.progress * 0.85));
                                }
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
        } catch (err) {
            setStatus('error');
            setError('Failed to generate video');
        }
    };

    const getStatusMessage = () => {
        // Prefer the live message streamed from the backend when we have one.
        if (statusDetail && (status === 'audio_processing' || status === 'video_processing')) {
            return progress > 0 && status === 'video_processing'
                ? `${statusDetail} ${Math.round(progress)}%`
                : statusDetail;
        }
        switch (status) {
            case 'audio_processing': return 'Processing audio...';
            case 'video_processing': return `Rendering video... ${Math.round(progress)}%`;
            case 'complete': return 'Video complete!';
            case 'error': return 'Error occurred';
            default: return '';
        }
    };

    const isGenerating = status !== 'idle' && status !== 'complete' && status !== 'error';

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
                {/* Configuration Sidebar */}
                <div className="w-full md:w-80 space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-white text-lg flex items-center gap-2">
                                <FileText className="w-4 h-4 text-[#F97316]" />
                                Channel Profile
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Select value={selectedProfileId} onValueChange={selectProfile}>
                                <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                    <SelectValue placeholder="Select a profile" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    {profiles.map(profile => (
                                        <SelectItem key={profile.id} value={profile.id} className="text-white">
                                            {profile.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>

                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-white text-lg flex items-center gap-2">
                                <Music className="w-4 h-4 text-[#F97316]" />
                                Audio Preset
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Select value={selectedAudioPresetId} onValueChange={setSelectedAudioPresetId}>
                                <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                    <SelectValue placeholder="Select a preset" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                    {audioPresets.map(preset => (
                                        <SelectItem key={preset.id} value={preset.id} className="text-white">
                                            {preset.name}
                                            <span className="text-[#B8B9BC]"> · {providerLabelOf(preset)}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedAudioPreset && (
                                <div className="mt-3 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[10px] px-2 py-0.5 rounded border border-[#F97316]/40 bg-[#F97316]/10 text-[#F97316] font-medium">
                                            {providerLabelOf(selectedAudioPreset)}
                                        </span>
                                        {voiceNameOf(selectedAudioPreset) && (
                                            <span className="text-[10px] text-[#B8B9BC]">
                                                {voiceNameOf(selectedAudioPreset)}
                                            </span>
                                        )}
                                    </div>
                                    {!hasKeyForProvider(providerOf(selectedAudioPreset)) && (
                                        <p className="text-[10px] text-yellow-500">
                                            No {providerLabelOf(selectedAudioPreset)} API key in Settings
                                        </p>
                                    )}
                                </div>
                            )}
                            <p className="text-[10px] text-[#B8B9BC] mt-2 italic">
                                Controls voice, speed, and silence removal
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Main Content Area */}
                <div className="min-w-0 flex-1 space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <CardTitle className="text-white">Content</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="hook" className="text-white">Hook</Label>
                                <Textarea
                                    id="hook"
                                    placeholder="The absolute first thing people hear..."
                                    value={hook}
                                    onChange={(e) => setHook(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white min-h-[80px]"
                                    disabled={isGenerating}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="script" className="text-white">Script</Label>
                                <Textarea
                                    id="script"
                                    placeholder="The rest of your story..."
                                    value={script}
                                    onChange={(e) => setScript(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white min-h-[200px]"
                                    disabled={isGenerating}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardContent className="pt-6">
                            {error && (
                                <div className="mb-4 flex items-center gap-2 text-red-400 bg-red-400/10 px-4 py-2 rounded border border-red-400/20 text-sm">
                                    <AlertCircle className="h-4 w-4" />
                                    {error}
                                </div>
                            )}

                            {status !== 'idle' && status !== 'error' && (
                                <div className="mb-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            {status === 'complete' ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Loader2 className="h-4 w-4 animate-spin text-[#F97316]" />
                                            )}
                                            <span className="text-white font-medium">{getStatusMessage()}</span>
                                        </div>
                                        <span className="text-xs text-[#B8B9BC]">{Math.round(progress)}%</span>
                                    </div>
                                    <div className="w-full bg-[#1A1A1A] rounded-full h-1.5 overflow-hidden">
                                        <div
                                            className="bg-gradient-to-r from-[#F97316] to-[#FB923C] h-full transition-all duration-300"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {generatedVideoUrl && (
                                <div className="mb-6 p-2 bg-[#1A1A1A] rounded-xl border border-[#3A3A3A]">
                                    <video
                                        src={generatedVideoUrl}
                                        controls
                                        className="w-full aspect-[9/16] max-w-[300px] mx-auto rounded-lg shadow-2xl"
                                    />
                                </div>
                            )}

                            <div className="flex flex-col justify-center gap-3 sm:flex-row">
                                <Button
                                    onClick={generateVideo}
                                    size="lg"
                                    className="w-full bg-[#F97316] px-8 font-bold text-white shadow-lg shadow-[#F97316]/20 transition-all hover:bg-[#EA580C] sm:w-auto sm:hover:scale-105"
                                    disabled={isGenerating || !hook.trim() || !script.trim() || !selectedProfile || !selectedAudioPresetId}
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="mr-2 h-4 w-4 fill-current" />
                                            Generate Video
                                        </>
                                    )}
                                </Button>

                                {status === 'complete' && (
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        onClick={() => {
                                            setStatus('idle');
                                            setProgress(0);
                                            setGeneratedVideoUrl('');
                                        }}
                                        className="border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                    >
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Reset
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
