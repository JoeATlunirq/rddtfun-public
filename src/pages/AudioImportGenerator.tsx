import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, AlertCircle, CheckCircle2, Loader2, RefreshCw, Upload, FileAudio, X } from 'lucide-react';
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
}

interface AudioPreset {
    id: string;
    name: string;
    voiceId: string;
    voiceName?: string;
}

type GenerationStatus = 'idle' | 'uploading' | 'processing' | 'rendering' | 'complete' | 'error';

export default function AudioImportGenerator() {
    const { user } = useAuth();
    const userId = user?.id || 'default';
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [hookText, setHookText] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [selectedAudioPresetId, setSelectedAudioPresetId] = useState<string>('');

    // Resources
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [audioPresets, setAudioPresets] = useState<AudioPreset[]>([]);

    // Generation state
    const [status, setStatus] = useState<GenerationStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');

    useEffect(() => {
        if (userId !== 'default') {
            loadData();
        }
    }, [userId]);

    const loadData = async () => {
        try {
            const [profilesRes, presetsRes] = await Promise.all([
                apiFetch(`/api/channel-profiles/${userId}`),
                apiFetch(`/api/presets?userId=${userId}`)
            ]);

            const profilesData = await profilesRes.json();
            const presetsData = await presetsRes.json();

            setProfiles(profilesData.profiles || []);
            if (profilesData.profiles?.length > 0) {
                setSelectedProfileId(profilesData.profiles[0].id);
            }

            const audioOnly = presetsData.filter((p: any) => p.type === 'audio');
            setAudioPresets(audioOnly);
            if (audioOnly.length > 0) {
                setSelectedAudioPresetId(audioOnly[0].id);
            }
        } catch (err) {
            console.error('Error loading data:', err);
        }
    };

    const selectedProfile = profiles.find(p => p.id === selectedProfileId);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.type === 'audio/mpeg' || file.type === 'audio/wav' || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
                setAudioFile(file);
                setError('');
            } else {
                setError('Please upload an MP3 or WAV file');
            }
        }
    };

    const clearFile = () => {
        setAudioFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const generateVideo = async () => {
        if (!audioFile) {
            setError('Please upload an audio file');
            return;
        }

        if (!hookText.trim()) {
            setError('Please enter hook text');
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

        setStatus('uploading');
        setProgress(0);
        setError('');
        setGeneratedVideoUrl('');

        try {
            // Convert file to base64
            const reader = new FileReader();
            const audioBase64 = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(audioFile);
            });

            const response = await apiFetch('/api/generate-video-from-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audioData: audioBase64,
                    audioFileName: audioFile.name,
                    hookText,
                    userId,
                    channelId: selectedProfile.id,
                    channelName: selectedProfile.name,
                    channelImageUrl: selectedProfile.image_url || '',
                    channelFont: selectedProfile.font,
                    channelStyle: selectedProfile.style,
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

            const streamReader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (streamReader) {
                while (true) {
                    const { done, value } = await streamReader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split('\n\n').filter(l => l.trim());

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);

                            if (data.type === 'status_update') {
                                if (data.status === 'processing') {
                                    setStatus('processing');
                                    setProgress(20);
                                } else if (data.status === 'rendering') {
                                    setStatus('rendering');
                                    setProgress(40);
                                } else if (data.status === 'video_complete') {
                                    setStatus('complete');
                                    setProgress(100);
                                    if (data.hookVideo) setGeneratedVideoUrl(data.hookVideo);
                                } else if (data.status === 'error') {
                                    setStatus('error');
                                    setError(data.message || 'Video generation failed');
                                }
                            } else if (data.type === 'step_progress') {
                                if (data.stepId === 'video_generation') {
                                    setProgress(40 + (data.progress * 0.6));
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
        switch (status) {
            case 'uploading': return 'Uploading audio...';
            case 'processing': return 'Processing audio...';
            case 'rendering': return `Rendering video... ${Math.round(progress)}%`;
            case 'complete': return 'Video complete!';
            case 'error': return 'Error occurred';
            default: return '';
        }
    };

    const isGenerating = status !== 'idle' && status !== 'complete' && status !== 'error';

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[#F97316]/10 rounded-lg">
                    <FileAudio className="w-6 h-6 text-[#F97316]" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white">Audio Import</h1>
                    <p className="text-sm text-[#B8B9BC]">Upload your own audio file to generate a video</p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
                {/* Configuration Sidebar */}
                <div className="w-full md:w-80 space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-white text-lg">Channel Profile</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
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
                            <CardTitle className="text-white text-lg">Audio Preset</CardTitle>
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
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[10px] text-[#B8B9BC] mt-2 italic">
                                Controls silence removal and processing settings
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Main Content Area */}
                <div className="min-w-0 flex-1 space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <CardTitle className="text-white">Upload Audio</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* File Upload */}
                            <div className="space-y-2">
                                <Label className="text-white">Audio File (MP3 or WAV)</Label>
                                {audioFile ? (
                                    <div className="flex items-center gap-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                                        <FileAudio className="w-8 h-8 text-[#F97316]" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-white text-sm truncate">{audioFile.name}</p>
                                            <p className="text-[#B8B9BC] text-xs">
                                                {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={clearFile}
                                            disabled={isGenerating}
                                            className="text-[#B8B9BC] hover:text-white"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div
                                        className="border-2 border-dashed border-[#3A3A3A] rounded-lg p-8 text-center cursor-pointer hover:border-[#F97316] transition-colors"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Upload className="w-10 h-10 text-[#B8B9BC] mx-auto mb-3" />
                                        <p className="text-white font-medium">Click to upload audio</p>
                                        <p className="text-[#B8B9BC] text-sm">MP3 or WAV files only</p>
                                    </div>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".mp3,.wav,audio/mpeg,audio/wav"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    disabled={isGenerating}
                                />
                            </div>

                            {/* Hook Text */}
                            <div className="space-y-2">
                                <Label htmlFor="hookText" className="text-white">Hook Text (displays on hook card)</Label>
                                <Input
                                    id="hookText"
                                    placeholder="What appears on the hook card..."
                                    value={hookText}
                                    onChange={(e) => setHookText(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    disabled={isGenerating}
                                />
                                <p className="text-[10px] text-[#B8B9BC] italic">
                                    This text will appear on the Reddit-style hook card
                                </p>
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
                                    disabled={isGenerating || !audioFile || !hookText.trim() || !selectedProfile || !selectedAudioPresetId}
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
