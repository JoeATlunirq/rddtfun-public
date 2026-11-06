import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Music, Loader2, Pencil, Save, X, Type } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import { CaptionPreview, CaptionStyle } from '@/components/CaptionPreview';
import { VisualFilterPreview } from '@/components/VisualFilterPreview';
import { HookPreview } from '@/components/HookPreview';
import {
    FONT_OPTIONS, CAPTION_ANIMATION_OPTIONS, HOOK_ANIMATION_OPTIONS, CAPTION_TEMPLATES, CAPTION_TEMPLATE_GROUPS, HOOK_STYLE_TEMPLATES,
    COLOR_MIX_PALETTE,
    type HookStyleFields,
} from '@/lib/videoStyles';

interface Voice {
    voice_id: string;
    name: string;
    category: string;
}

interface AudioPreset {
    id: string;
    userId: string;
    type: 'audio';
    name: string;
    ttsProvider?: 'elevenlabs' | 'fish' | 'vibi' | 'local';
    voiceId: string;
    voiceName?: string;
    voiceGender?: 'male' | 'female';
    fishAudioModelId?: string;
    fishAudioModelName?: string;
    vibiVoiceId?: string;
    vibiVoiceName?: string;
    vibiModelId?: string;
    localVoiceId?: string;
    localVoiceName?: string;
    localEngine?: string;
    // Audio Processing settings
    thresholdDb: number;
    minDuration: number;
    targetDuration: number | null;
    targetDurationMin?: number | null;
    targetDurationMax?: number | null;
    leftPadding: number;
    rightPadding: number;
    addBackgroundMusic: boolean;
    musicVolumeDb: number;
    customMusicUrl?: string;
}



interface CaptionPreset {
    id: string;
    userId: string;
    type: 'caption_style';
    name: string;
    captionStyle: CaptionStyle;
}

type HookStyle = HookStyleFields;

const PREVIEW_HOOK_TEXT = 'Teachers of Reddit, what is the wildest excuse a student ever gave you?';

interface HookStylePreset {
    id: string;
    userId: string;
    type: 'hook_style';
    name: string;
    hookStyle: HookStyle;
}

const parseDuration = (value: string | number | null) => {
    if (value === null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d+):(\d{1,2})$/);
    if (match) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        return seconds < 60 ? minutes * 60 + seconds : null;
    }
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return minutes > 0 ? `${minutes}:${remainder.toString().padStart(2, '0')}` : String(remainder);
};

export default function Presets() {
    const { user } = useAuth();
    const userId = user?.id || 'default';

    const [audioPresets, setAudioPresets] = useState<AudioPreset[]>([]);
    const [captionPresets, setCaptionPresets] = useState<CaptionPreset[]>([]);
    const [hookStylePresets, setHookStylePresets] = useState<HookStylePreset[]>([]);
    const [showAudioForm, setShowAudioForm] = useState(false);
    const [showCaptionForm, setShowCaptionForm] = useState(false);
    const [showHookStyleForm, setShowHookStyleForm] = useState(false);
    const [voices, setVoices] = useState<Voice[]>([]);
    const [loadingVoices, setLoadingVoices] = useState(false);
    const [elevenlabsApiKey, setElevenlabsApiKey] = useState('');
    const [editingAudioId, setEditingAudioId] = useState<string | null>(null);
    const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
    const [editingHookStyleId, setEditingHookStyleId] = useState<string | null>(null);
    const [fishAudioApiKey, setFishAudioApiKey] = useState('');
    const [vibiApiKey, setVibiApiKey] = useState('');
    const [vibiVoices, setVibiVoices] = useState<{ voice_id: string; name: string; kind?: string }[]>([]);
    const [loadingVibiVoices, setLoadingVibiVoices] = useState(false);
    const [localVoices, setLocalVoices] = useState<{ voice_id: string; name: string; type?: string }[]>([]);
    const [loadingLocalVoices, setLoadingLocalVoices] = useState(false);
    const [fishAudioVoices, setFishAudioVoices] = useState<{ _id: string; title: string; cover_image?: string }[]>([]);
    const [loadingFishVoices, setLoadingFishVoices] = useState(false);
    const [activeTab, setActiveTab] = useState(() => {
        return localStorage.getItem('rddtfun_presets_tab') || 'audio';
    });

    // Audio form state
    const [audioForm, setAudioForm] = useState({
        name: '',
        ttsProvider: 'elevenlabs' as 'elevenlabs' | 'fish' | 'vibi' | 'local',
        voiceId: '',
        voiceName: '',
        voiceGender: 'male' as 'male' | 'female',
        fishAudioModelId: '',
        fishAudioModelName: '',
        vibiVoiceId: '',
        vibiVoiceName: '',
        vibiModelId: '',
        localVoiceId: '',
        localVoiceName: '',
        localEngine: '',
        // Audio Processing settings
        thresholdDb: -40,
        minDuration: 0.2,
        targetDuration: null as number | string | null,
        useDurationRange: false,
        targetDurationMin: '',
        targetDurationMax: '',
        leftPadding: 0.05,
        rightPadding: 0.05,
        addBackgroundMusic: false,
        musicVolumeDb: -18,
        customMusicUrl: ''
    });
    const [uploadingMusic, setUploadingMusic] = useState(false);



    // Caption form state
    const [captionForm, setCaptionForm] = useState({
        name: '',
        captionStyle: {
            font: 'Roboto',
            style: 'single',
            subtitle_size: 64,
            stroke_size: 8,
            hook_animation_type: 'fall',
            caption_animation_type: 'scale',
            visual_filter: 'none',
            color: '#FFFFFF'
        } as CaptionStyle
    });

    const setCaptionStyle = (patch: Partial<CaptionStyle>) =>
        setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, ...patch } });

    // Hook style form state
    const [hookStyleForm, setHookStyleForm] = useState({
        name: '',
        hookStyle: {
            titleColor: '#FFFFFF',
            backgroundColor: '#000000',
            font: 'Roboto',
            borderRadius: 12,
            hookTopPosition: false
        } as HookStyle
    });

    useEffect(() => {
        if (userId !== 'default') {
            loadPresets();
            loadUserSettings();
        }
    }, [userId]);

    const [showPresetDialog, setShowPresetDialog] = useState(false);
    const [editingPresetId, setEditingPresetId] = useState<string | null>(null);

    const handleSaveVisualFilterPreset = async () => {
        if (!visualFilterForm.name) {
            alert('Name is required');
            return;
        }

        const presetData = {
            id: editingPresetId || crypto.randomUUID(),
            userId: userId,
            name: visualFilterForm.name,
            type: 'visual_filter',
            visual_filter: visualFilterForm.filterType
            // We store visual_filter directly in the preset object as per our new schema direction
        };

        try {
            await apiFetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(presetData)
            });

            // Re-load
            loadVisualFilterPresets();
            setShowPresetDialog(false);
        } catch (err) {
            console.error('Error saving visual filter preset:', err);
            alert('Failed to save preset');
        }
    };

    // Check existing save functions to match pattern

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        localStorage.setItem('rddtfun_presets_tab', value);
    };



    const [visualFilterPresets, setVisualFilterPresets] = useState<any[]>([]);
    const [visualFilterForm, setVisualFilterForm] = useState({
        name: '',
        filterType: 'none' as 'none' | 'vibrant' | 'dark' | 'warm' | 'cool'
    });

    useEffect(() => {
        if (userId !== 'default') {
            loadPresets();
            loadVisualFilterPresets();
            loadUserSettings();
        }
    }, [userId]);

    const loadVisualFilterPresets = async () => {
        try {
            const response = await apiFetch(`/api/presets?userId=${userId}`);
            const data = await response.json();
            setVisualFilterPresets(data.filter((p: any) => p.type === 'visual_filter') || []);
        } catch (err) {
            console.error('Failed to load visual filter presets:', err);
        }
    };

    const loadPresets = async () => {
        try {
            const response = await apiFetch(`/api/presets?userId=${userId}`);
            const data = await response.json();
            setAudioPresets(data.filter((p: { type: string }) => p.type === 'audio') || []);
            setCaptionPresets(data.filter((p: { type: string }) => p.type === 'caption_style') || []);
            setHookStylePresets(data.filter((p: { type: string }) => p.type === 'hook_style') || []);
        } catch (err) {
            console.error('Failed to load presets:', err);
        }
    };

    const loadUserSettings = async () => {
        try {
            const response = await apiFetch(`/api/user-settings/${userId}`);
            const data = await response.json();
            const apiKey = data.elevenlabs_api_key || data.elevenlabsApiKey;
            if (apiKey) {
                setElevenlabsApiKey(apiKey);
            }
            const fishKey = data.fish_audio_api_key || data.fishAudioApiKey;
            console.log('[Presets] Loaded Fish Audio Key:', fishKey ? 'Yes (***)' : 'No');
            if (fishKey) {
                setFishAudioApiKey(fishKey);
            }
            const vibiKey = data.vibi_api_key || data.vibiApiKey;
            if (vibiKey) {
                setVibiApiKey(vibiKey);
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const loadVoices = async () => {
        if (!elevenlabsApiKey) {
            alert('Please configure your ElevenLabs API key in Settings first');
            return;
        }

        setLoadingVoices(true);
        try {
            const response = await apiFetch('/api/elevenlabs/voices');
            const data = await response.json();
            if (data.voices) {
                setVoices(data.voices);
            } else {
                alert('Failed to load voices');
            }
        } catch (err) {
            console.error('Failed to load voices:', err);
            alert('Failed to load voices');
        } finally {
            setLoadingVoices(false);
        }
    };

    const loadFishAudioVoices = async () => {
        console.log('[Presets] Loading Fish Audio voices...');
        console.log('[Presets] API Key present:', !!fishAudioApiKey);

        if (!fishAudioApiKey) {
            alert('Please configure your Fish Audio API key in Settings first');
            return;
        }

        setLoadingFishVoices(true);
        try {
            console.log('[Presets] Fetching from /api/fish-audio/voices...');
            const response = await apiFetch('/api/fish-audio/voices');
            console.log('[Presets] Response status:', response.status);

            const data = await response.json();
            console.log('[Presets] Data received:', data);

            if (data.items) {
                setFishAudioVoices(data.items);
                console.log(`[Presets] Set ${data.items.length} voices`);
            } else {
                console.error('[Presets] No items in response:', data);
                alert('Failed to load Fish Audio voices');
            }
        } catch (err) {
            console.error('Failed to load Fish Audio voices:', err);
            alert('Failed to load Fish Audio voices');
        } finally {
            setLoadingFishVoices(false);
        }
    };

    const loadVibiVoices = async () => {
        if (!vibiApiKey) {
            alert('Please configure your Vibi API key in Settings first');
            return;
        }
        setLoadingVibiVoices(true);
        try {
            const response = await apiFetch('/api/vibi/voices');
            const data = await response.json();
            if (data.voices) {
                setVibiVoices(data.voices);
            } else {
                alert(data.error || 'Failed to load Vibi voices');
            }
        } catch (err) {
            console.error('Failed to load Vibi voices:', err);
            alert('Failed to load Vibi voices');
        } finally {
            setLoadingVibiVoices(false);
        }
    };

    const loadLocalVoices = async () => {
        setLoadingLocalVoices(true);
        try {
            const response = await apiFetch('/api/local-tts/voices');
            const data = await response.json();
            if (data.voices) {
                // Cloned voices first, then the server's built-in voices.
                const sorted = [...data.voices].sort((a, b) =>
                    Number(a.type !== 'clone') - Number(b.type !== 'clone'));
                setLocalVoices(sorted);
            } else {
                alert(data.error || 'Failed to load local TTS voices');
            }
        } catch (err) {
            console.error('Failed to load local TTS voices:', err);
            alert('Failed to load local TTS voices. Is backend/local-tts/start.sh running?');
        } finally {
            setLoadingLocalVoices(false);
        }
    };

    const handleOpenAudioForm = async () => {
        setEditingAudioId(null);
        setAudioForm({
            name: '',
            ttsProvider: 'elevenlabs',
            voiceId: '',
            voiceName: '',
            voiceGender: 'male',
            fishAudioModelId: '',
            fishAudioModelName: '',
            vibiVoiceId: '',
            vibiVoiceName: '',
            vibiModelId: '',
            localVoiceId: '',
            localVoiceName: '',
            localEngine: '',
            thresholdDb: -40,
            minDuration: 0.2,
            targetDuration: null,
            useDurationRange: false,
            targetDurationMin: '',
            targetDurationMax: '',
            leftPadding: 0.05,
            rightPadding: 0.05,
            addBackgroundMusic: false,
            musicVolumeDb: -18,
            customMusicUrl: ''
        });
        setShowAudioForm(true);
        if (voices.length === 0 && elevenlabsApiKey) {
            await loadVoices();
        }
    };

    const handleEditAudio = async (preset: AudioPreset) => {
        setEditingAudioId(preset.id);
        setAudioForm({
            name: preset.name,
            ttsProvider: preset.ttsProvider || 'elevenlabs',
            voiceId: preset.voiceId,
            voiceName: preset.voiceName || '',
            voiceGender: preset.voiceGender || 'male',
            fishAudioModelId: preset.fishAudioModelId || '',
            fishAudioModelName: preset.fishAudioModelName || '',
            vibiVoiceId: preset.vibiVoiceId || '',
            vibiVoiceName: preset.vibiVoiceName || '',
            vibiModelId: preset.vibiModelId || '',
            localVoiceId: preset.localVoiceId || '',
            localVoiceName: preset.localVoiceName || '',
            localEngine: preset.localEngine || '',
            thresholdDb: preset.thresholdDb,
            minDuration: preset.minDuration,
            targetDuration: formatDuration(preset.targetDuration) || null,
            useDurationRange: Boolean(preset.targetDurationMin && preset.targetDurationMax),
            targetDurationMin: formatDuration(preset.targetDurationMin),
            targetDurationMax: formatDuration(preset.targetDurationMax),
            leftPadding: preset.leftPadding,
            rightPadding: preset.rightPadding,
            addBackgroundMusic: preset.addBackgroundMusic,
            musicVolumeDb: preset.musicVolumeDb,
            customMusicUrl: preset.customMusicUrl || ''
        });
        setShowAudioForm(true);
        // Load voices based on provider
        if (preset.ttsProvider === 'fish' && fishAudioVoices.length === 0 && fishAudioApiKey) {
            await loadFishAudioVoices();
        } else if (preset.ttsProvider === 'vibi' && vibiVoices.length === 0 && vibiApiKey) {
            await loadVibiVoices();
        } else if (preset.ttsProvider === 'local' && localVoices.length === 0) {
            await loadLocalVoices();
        } else if (voices.length === 0 && elevenlabsApiKey) {
            await loadVoices();
        }
    };

    const saveAudioPreset = async () => {
        if (!audioForm.name.trim()) {
            alert('Preset name is required');
            return;
        }
        // Validate voice selection based on provider
        if (audioForm.ttsProvider === 'elevenlabs' && !audioForm.voiceId) {
            alert('Please select an ElevenLabs voice');
            return;
        }
        if (audioForm.ttsProvider === 'fish' && !audioForm.fishAudioModelId) {
            alert('Please select a Fish Audio voice');
            return;
        }
        if (audioForm.ttsProvider === 'vibi' && !audioForm.vibiVoiceId) {
            alert('Please select a Vibi voice');
            return;
        }
        if (audioForm.ttsProvider === 'local' && !audioForm.localVoiceId) {
            alert('Please select a local TTS voice');
            return;
        }

        const targetDuration = audioForm.useDurationRange ? null : parseDuration(audioForm.targetDuration);
        const targetDurationMin = audioForm.useDurationRange ? parseDuration(audioForm.targetDurationMin) : null;
        const targetDurationMax = audioForm.useDurationRange ? parseDuration(audioForm.targetDurationMax) : null;
        if (audioForm.useDurationRange && (!targetDurationMin || !targetDurationMax || targetDurationMax < targetDurationMin)) {
            alert('Enter a valid duration range where the maximum is at least the minimum');
            return;
        }
        if (!audioForm.useDurationRange && audioForm.targetDuration && !targetDuration) {
            alert('Enter duration as seconds or m:ss');
            return;
        }

        const preset: AudioPreset = {
            id: editingAudioId || `audio-${Date.now()}`,
            type: 'audio',
            userId,
            name: audioForm.name,
            ttsProvider: audioForm.ttsProvider,
            voiceId: audioForm.voiceId,
            voiceName: audioForm.voiceName,
            voiceGender: audioForm.voiceGender,
            fishAudioModelId: audioForm.fishAudioModelId || undefined,
            fishAudioModelName: audioForm.fishAudioModelName || undefined,
            vibiVoiceId: audioForm.vibiVoiceId || undefined,
            vibiVoiceName: audioForm.vibiVoiceName || undefined,
            vibiModelId: audioForm.vibiModelId || undefined,
            localVoiceId: audioForm.localVoiceId || undefined,
            localVoiceName: audioForm.localVoiceName || undefined,
            localEngine: audioForm.localEngine || undefined,
            thresholdDb: audioForm.thresholdDb,
            minDuration: audioForm.minDuration,
            targetDuration,
            targetDurationMin,
            targetDurationMax,
            leftPadding: audioForm.leftPadding,
            rightPadding: audioForm.rightPadding,
            addBackgroundMusic: audioForm.addBackgroundMusic,
            musicVolumeDb: audioForm.musicVolumeDb,
            customMusicUrl: audioForm.customMusicUrl || undefined
        };

        try {
            await apiFetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preset)
            });

            if (editingAudioId) {
                setAudioPresets(audioPresets.map(p => p.id === editingAudioId ? preset : p));
            } else {
                setAudioPresets([...audioPresets, preset]);
            }

            setShowAudioForm(false);
            setEditingAudioId(null);
        } catch (err) {
            console.error('Failed to save preset:', err);
            alert('Failed to save preset');
        }
    };

    const deleteAudioPreset = async (id: string) => {
        if (!confirm('Delete this preset?')) return;
        try {
            const response = await apiFetch(`/api/presets/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete preset');
            }
            setAudioPresets(audioPresets.filter(p => p.id !== id));
        } catch (err) {
            console.error('Failed to delete preset:', err);
            alert('Failed to delete preset');
        }
    };



    const handleEditCaption = (preset: CaptionPreset) => {
        setEditingCaptionId(preset.id);
        setCaptionForm({
            name: preset.name,
            captionStyle: preset.captionStyle
        });
        setShowCaptionForm(true);
    };

    const handleSaveCaptionPreset = async () => {
        if (!captionForm.name) {
            alert('Please enter a preset name');
            return;
        }

        const presetId = editingCaptionId || crypto.randomUUID();
        const preset: CaptionPreset = {
            id: presetId,
            userId,
            type: 'caption_style',
            name: captionForm.name,
            captionStyle: captionForm.captionStyle
        };

        try {
            await apiFetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preset)
            });

            if (editingCaptionId) {
                setCaptionPresets(captionPresets.map(p => p.id === editingCaptionId ? preset : p));
            } else {
                setCaptionPresets([...captionPresets, preset]);
            }
            setShowCaptionForm(false);
            setEditingCaptionId(null);
            // Reset form
            setCaptionForm({
                name: '',
                captionStyle: {
                    font: 'Roboto',
                    style: 'single',
                    subtitle_size: 64,
                    stroke_size: 8,
                    hook_animation_type: 'fall',
                    caption_animation_type: 'scale',
                    visual_filter: 'none',
                    color: '#FFFFFF'
                }
            });
        } catch (error) {
            console.error('Error saving caption preset:', error);
            alert('Failed to save caption preset');
        }
    };

    const handleDeleteCaptionPreset = async (id: string) => {
        if (!confirm('Are you sure you want to delete this preset?')) return;
        try {
            const response = await apiFetch(`/api/presets/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete preset');
            }
            setCaptionPresets(captionPresets.filter(p => p.id !== id));
        } catch (error) {
            console.error('Error deleting preset:', error);
            alert('Failed to delete preset');
        }
    };

    // --- Hook Style Preset Functions ---
    const handleOpenHookStyleForm = () => {
        setEditingHookStyleId(null);
        setHookStyleForm({
            name: '',
            hookStyle: {
                titleColor: '#FFFFFF',
                backgroundColor: '#000000',
                font: 'Roboto',
                borderRadius: 12,
                hookTopPosition: false
            }
        });
        setShowHookStyleForm(true);
    };

    const setHookStyle = (patch: Partial<HookStyle>) =>
        setHookStyleForm({ ...hookStyleForm, hookStyle: { ...hookStyleForm.hookStyle, ...patch } });

    const handleEditHookStyle = (preset: HookStylePreset) => {
        setEditingHookStyleId(preset.id);
        setHookStyleForm({
            name: preset.name,
            hookStyle: preset.hookStyle || {
                titleColor: '#FFFFFF',
                backgroundColor: '#000000',
                font: 'Roboto',
                borderRadius: 12,
                hookTopPosition: false
            }
        });
        setShowHookStyleForm(true);
    };

    const handleSaveHookStylePreset = async () => {
        if (!hookStyleForm.name) {
            alert('Please enter a preset name');
            return;
        }

        const presetId = editingHookStyleId || crypto.randomUUID();
        const preset: HookStylePreset = {
            id: presetId,
            userId,
            type: 'hook_style',
            name: hookStyleForm.name,
            hookStyle: hookStyleForm.hookStyle
        };

        try {
            await apiFetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preset)
            });

            if (editingHookStyleId) {
                setHookStylePresets(hookStylePresets.map(p => p.id === editingHookStyleId ? preset : p));
            } else {
                setHookStylePresets([...hookStylePresets, preset]);
            }
            setShowHookStyleForm(false);
            setEditingHookStyleId(null);
            // Reset form
            setHookStyleForm({
                name: '',
                hookStyle: {
                    titleColor: '#FFFFFF',
                    backgroundColor: '#000000',
                    font: 'Roboto',
                    borderRadius: 12,
                    hookTopPosition: false
                }
            });
        } catch (error) {
            console.error('Error saving hook style preset:', error);
            alert('Failed to save hook style preset');
        }
    };

    const handleDeleteHookStylePreset = async (id: string) => {
        if (!confirm('Are you sure you want to delete this preset?')) return;
        try {
            const response = await apiFetch(`/api/presets/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete preset');
            }
            setHookStylePresets(hookStylePresets.filter(p => p.id !== id));
        } catch (error) {
            console.error('Error deleting preset:', error);
            alert('Failed to delete preset');
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white">Presets</h2>
                <p className="text-[#B8B9BC] mt-1">Save audio and content configurations for quick access</p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <TabsTrigger value="audio">Audio</TabsTrigger>
                    <TabsTrigger value="caption">Caption Styles</TabsTrigger>
                    <TabsTrigger value="hook_style">Hook Styles</TabsTrigger>
                    <TabsTrigger value="visual_filter">Visual Filters</TabsTrigger>
                </TabsList>

                {/* Audio Presets Tab */}
                <TabsContent value="audio">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-2">
                                    <Music className="w-5 h-5 text-[#F97316]" />
                                    <CardTitle className="text-white">Audio Presets</CardTitle>
                                </div>
                                <Button
                                    onClick={handleOpenAudioForm}
                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Preset
                                </Button>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                Voice and audio processing configurations
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {showAudioForm && (
                                <div className="mb-6 p-4 bg-[#1A1A1A] rounded-lg border border-[#F97316]/30 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-white font-medium">
                                            {editingAudioId ? 'Edit Audio Preset' : 'New Audio Preset'}
                                        </h4>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { setShowAudioForm(false); setEditingAudioId(null); }}
                                            className="text-[#B8B9BC] hover:text-white h-8 w-8"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-white">Preset Name *</Label>
                                        <Input
                                            value={audioForm.name}
                                            onChange={(e) => setAudioForm({ ...audioForm, name: e.target.value })}
                                            placeholder="e.g., Fast Narration"
                                            className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                        />
                                    </div>

                                    {/* TTS Provider Selection */}
                                    <div className="space-y-2">
                                        <Label className="text-white">TTS Provider *</Label>
                                        <Select
                                            value={audioForm.ttsProvider}
                                            onValueChange={(v: 'elevenlabs' | 'fish' | 'vibi' | 'local') => {
                                                setAudioForm({
                                                    ...audioForm,
                                                    ttsProvider: v,
                                                    voiceId: '',
                                                    voiceName: '',
                                                    fishAudioModelId: '',
                                                    fishAudioModelName: '',
                                                    vibiVoiceId: '',
                                                    vibiVoiceName: '',
                                                    vibiModelId: '',
                                                    localVoiceId: '',
                                                    localVoiceName: '',
                                                    localEngine: ''
                                                });
                                                if (v === 'local' && localVoices.length === 0) loadLocalVoices();
                                            }}
                                        >
                                            <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                <SelectValue placeholder="Select TTS Provider" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                <SelectItem value="elevenlabs" className="text-white">ElevenLabs</SelectItem>
                                                <SelectItem value="fish" className="text-white">Fish Audio</SelectItem>
                                                <SelectItem value="vibi" className="text-white">Vibi</SelectItem>
                                                <SelectItem value="local" className="text-white">Local (Pocket TTS)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Voice Selection - ElevenLabs */}
                                    {audioForm.ttsProvider === 'elevenlabs' && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-white">ElevenLabs Voice *</Label>
                                                {loadingVoices && <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />}
                                            </div>
                                            {!elevenlabsApiKey ? (
                                                <p className="text-sm text-yellow-500">
                                                    Configure your ElevenLabs API key in Settings first
                                                </p>
                                            ) : voices.length === 0 ? (
                                                <Button
                                                    variant="outline"
                                                    onClick={loadVoices}
                                                    disabled={loadingVoices}
                                                    className="w-full border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                                >
                                                    {loadingVoices ? 'Loading...' : 'Load Voices'}
                                                </Button>
                                            ) : (
                                                <Select
                                                    value={audioForm.voiceId}
                                                    onValueChange={(v) => {
                                                        const voice = voices.find(voice => voice.voice_id === v);
                                                        setAudioForm({
                                                            ...audioForm,
                                                            voiceId: v,
                                                            voiceName: voice?.name || ''
                                                        });
                                                    }}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue placeholder="Select a voice" />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] max-h-60">
                                                        {voices.map(voice => (
                                                            <SelectItem
                                                                key={voice.voice_id}
                                                                value={voice.voice_id}
                                                                className="text-white hover:bg-[#3A3A3A]"
                                                            >
                                                                {voice.name} ({voice.category})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </div>
                                    )}

                                    {/* Voice Selection - Fish Audio */}
                                    {audioForm.ttsProvider === 'fish' && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-white">Fish Audio Voice *</Label>
                                                {loadingFishVoices && <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />}
                                            </div>
                                            {!fishAudioApiKey ? (
                                                <p className="text-sm text-yellow-500">
                                                    Configure your Fish Audio API key in Settings first
                                                </p>
                                            ) : fishAudioVoices.length === 0 ? (
                                                <Button
                                                    variant="outline"
                                                    onClick={loadFishAudioVoices}
                                                    disabled={loadingFishVoices}
                                                    className="w-full border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                                >
                                                    {loadingFishVoices ? 'Loading...' : 'Load Fish Audio Voices'}
                                                </Button>
                                            ) : (
                                                <Select
                                                    value={audioForm.fishAudioModelId}
                                                    onValueChange={(v) => {
                                                        const model = fishAudioVoices.find(m => m._id === v);
                                                        setAudioForm({
                                                            ...audioForm,
                                                            fishAudioModelId: v,
                                                            fishAudioModelName: model?.title || ''
                                                        });
                                                    }}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue placeholder="Select a Fish Audio voice" />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] max-h-60">
                                                        {fishAudioVoices.map(model => (
                                                            <SelectItem
                                                                key={model._id}
                                                                value={model._id}
                                                                className="text-white hover:bg-[#3A3A3A]"
                                                            >
                                                                {model.title}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </div>
                                    )}

                                    {/* Voice Selection - Vibi */}
                                    {audioForm.ttsProvider === 'vibi' && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-white">Vibi Voice *</Label>
                                                {loadingVibiVoices && <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />}
                                            </div>
                                            {!vibiApiKey ? (
                                                <p className="text-sm text-yellow-500">
                                                    Configure your Vibi API key in Settings first
                                                </p>
                                            ) : vibiVoices.length === 0 ? (
                                                <Button
                                                    variant="outline"
                                                    onClick={loadVibiVoices}
                                                    disabled={loadingVibiVoices}
                                                    className="w-full border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                                >
                                                    {loadingVibiVoices ? 'Loading...' : 'Load Vibi Voices'}
                                                </Button>
                                            ) : (
                                                <Select
                                                    value={audioForm.vibiVoiceId}
                                                    onValueChange={(v) => {
                                                        const voice = vibiVoices.find(x => x.voice_id === v);
                                                        setAudioForm({
                                                            ...audioForm,
                                                            vibiVoiceId: v,
                                                            vibiVoiceName: voice?.name || ''
                                                        });
                                                    }}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue placeholder="Select a Vibi voice" />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] max-h-60">
                                                        {vibiVoices.map(voice => (
                                                            <SelectItem
                                                                key={voice.voice_id}
                                                                value={voice.voice_id}
                                                                className="text-white hover:bg-[#3A3A3A]"
                                                            >
                                                                {voice.name}{voice.kind === 'cloned' ? ' (cloned)' : ''}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </div>
                                    )}

                                    {/* Voice Selection - Local TTS */}
                                    {audioForm.ttsProvider === 'local' && (
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-white">Local Voice *</Label>
                                                    {loadingLocalVoices && <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />}
                                                </div>
                                                {localVoices.length === 0 ? (
                                                    <Button
                                                        variant="outline"
                                                        onClick={loadLocalVoices}
                                                        disabled={loadingLocalVoices}
                                                        className="w-full border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                                    >
                                                        {loadingLocalVoices ? 'Loading...' : 'Load Local Voices'}
                                                    </Button>
                                                ) : (
                                                    <Select
                                                        value={audioForm.localVoiceId}
                                                        onValueChange={(v) => {
                                                            const voice = localVoices.find(x => x.voice_id === v);
                                                            setAudioForm({
                                                                ...audioForm,
                                                                localVoiceId: v,
                                                                localVoiceName: voice?.name || ''
                                                            });
                                                        }}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue placeholder="Select a cloned voice" />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] max-h-60">
                                                            {localVoices.map(voice => (
                                                                <SelectItem
                                                                    key={voice.voice_id}
                                                                    value={voice.voice_id}
                                                                    className="text-white hover:bg-[#3A3A3A]"
                                                                >
                                                                    {voice.name}{voice.type === 'clone' ? ' (cloned)' : ' (built-in)'}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                                <p className="text-xs text-[#B8B9BC]">
                                                    Clone a voice by putting a clean 10-30 s clip named {'<name>.wav'} in backend/local-tts/voices/. The server URL is set in Settings.
                                                </p>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-white">Engine</Label>
                                                <Select
                                                    value={audioForm.localEngine === 'fish-drama' ? 'fish-drama' : 'pocket'}
                                                    onValueChange={(v) => setAudioForm({ ...audioForm, localEngine: v === 'pocket' ? '' : v })}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                        <SelectItem value="pocket" className="text-white">Pocket TTS · this Mac, free</SelectItem>
                                                        <SelectItem value="fish-drama" className="text-white">Fish Drama 3 · cloud GPU, ~$0.25 per long video</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                {audioForm.localEngine === 'fish-drama' && (
                                                    <p className="text-xs text-[#B8B9BC]">
                                                        Uses the same voice clip on Modal (upload it to the fish-drama-voices volume). Word timings still come from this Mac.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Voice Gender */}
                                    <div className="space-y-2">
                                        <Label className="text-white">Voice Gender</Label>
                                        <div className="flex items-center gap-4">
                                            <button
                                                type="button"
                                                onClick={() => setAudioForm({ ...audioForm, voiceGender: 'male' })}
                                                className={`px-4 py-2 rounded-md border transition-colors ${audioForm.voiceGender === 'male'
                                                    ? 'bg-[#F97316] border-[#F97316] text-white'
                                                    : 'bg-[#2A2A2A] border-[#3A3A3A] text-[#B8B9BC] hover:bg-[#3A3A3A]'
                                                    }`}
                                            >
                                                Male
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setAudioForm({ ...audioForm, voiceGender: 'female' })}
                                                className={`px-4 py-2 rounded-md border transition-colors ${audioForm.voiceGender === 'female'
                                                    ? 'bg-[#F97316] border-[#F97316] text-white'
                                                    : 'bg-[#2A2A2A] border-[#3A3A3A] text-[#B8B9BC] hover:bg-[#3A3A3A]'
                                                    }`}
                                            >
                                                Female
                                            </button>
                                        </div>
                                        <p className="text-xs text-[#777]">
                                            Used for selecting gender-specific presets in channel profiles
                                        </p>
                                    </div>

                                    {/* Audio Processing Settings */}
                                    <div className="pt-4 border-t border-[#3A3A3A]">
                                        <h5 className="text-white font-medium mb-4">Audio Processing Settings</h5>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <Label className="text-white text-sm">Threshold</Label>
                                                    <span className="text-[#B8B9BC] text-xs">{audioForm.thresholdDb} dB</span>
                                                </div>
                                                <Slider
                                                    value={[audioForm.thresholdDb]}
                                                    onValueChange={([v]) => setAudioForm({ ...audioForm, thresholdDb: v })}
                                                    min={-60}
                                                    max={-20}
                                                    step={1}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <Label className="text-white text-sm">Min Duration</Label>
                                                    <span className="text-[#B8B9BC] text-xs">{audioForm.minDuration}s</span>
                                                </div>
                                                <Slider
                                                    value={[audioForm.minDuration]}
                                                    onValueChange={([v]) => setAudioForm({ ...audioForm, minDuration: v })}
                                                    min={0.1}
                                                    max={1.0}
                                                    step={0.05}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <Label className="text-white text-sm">Left Padding</Label>
                                                    <span className="text-[#B8B9BC] text-xs">{audioForm.leftPadding}s</span>
                                                </div>
                                                <Slider
                                                    value={[audioForm.leftPadding]}
                                                    onValueChange={([v]) => setAudioForm({ ...audioForm, leftPadding: v })}
                                                    min={0}
                                                    max={0.2}
                                                    step={0.01}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <Label className="text-white text-sm">Right Padding</Label>
                                                    <span className="text-[#B8B9BC] text-xs">{audioForm.rightPadding}s</span>
                                                </div>
                                                <Slider
                                                    value={[audioForm.rightPadding]}
                                                    onValueChange={([v]) => setAudioForm({ ...audioForm, rightPadding: v })}
                                                    min={0}
                                                    max={0.2}
                                                    step={0.01}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-3 mt-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <Label className="text-white text-sm">Random Maximum Duration Range</Label>
                                                    <p className="text-xs text-[#B8B9BC]">Longer videos speed up to a random maximum; shorter videos stay at 1x</p>
                                                </div>
                                                <Switch
                                                    checked={audioForm.useDurationRange}
                                                    onCheckedChange={(checked) => setAudioForm({ ...audioForm, useDurationRange: checked })}
                                                />
                                            </div>
                                            {audioForm.useDurationRange ? (
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-white text-xs">Minimum</Label>
                                                        <Input
                                                            type="text"
                                                            inputMode="numeric"
                                                            placeholder="2:40"
                                                            value={audioForm.targetDurationMin}
                                                            onChange={(e) => setAudioForm({ ...audioForm, targetDurationMin: e.target.value })}
                                                            className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-white text-xs">Maximum</Label>
                                                        <Input
                                                            type="text"
                                                            inputMode="numeric"
                                                            placeholder="2:58"
                                                            value={audioForm.targetDurationMax}
                                                            onChange={(e) => setAudioForm({ ...audioForm, targetDurationMax: e.target.value })}
                                                            className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    <Label className="text-white text-sm">Fixed Maximum Duration (optional)</Label>
                                                    <Input
                                                        type="text"
                                                        inputMode="numeric"
                                                        placeholder="Seconds or 2:45"
                                                        value={audioForm.targetDuration ?? ''}
                                                        onChange={(e) => setAudioForm({
                                                            ...audioForm,
                                                            targetDuration: e.target.value === '' ? null : e.target.value
                                                        })}
                                                        className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between mt-4">
                                            <Label className="text-white text-sm">Add Background Music</Label>
                                            <Switch
                                                checked={audioForm.addBackgroundMusic}
                                                onCheckedChange={(v) => setAudioForm({ ...audioForm, addBackgroundMusic: v })}
                                            />
                                        </div>

                                        {audioForm.addBackgroundMusic && (
                                            <div className="space-y-4 mt-2 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                                                <div className="flex justify-between">
                                                    <Label className="text-white text-sm">Music Volume</Label>
                                                    <span className="text-[#B8B9BC] text-xs">{audioForm.musicVolumeDb} dB</span>
                                                </div>
                                                <Slider
                                                    value={[audioForm.musicVolumeDb]}
                                                    onValueChange={([v]) => setAudioForm({ ...audioForm, musicVolumeDb: v })}
                                                    min={-30}
                                                    max={-6}
                                                    step={1}
                                                />

                                                {/* Custom Music Upload */}
                                                <div className="space-y-2 pt-3 border-t border-[#3A3A3A]">
                                                    <Label className="text-white text-sm">Custom Music (Optional)</Label>

                                                    {audioForm.customMusicUrl ? (
                                                        <div className="flex items-center gap-2 p-2 bg-[#2A2A2A] rounded border border-[#3A3A3A]">
                                                            <Music className="w-4 h-4 text-[#F97316]" />
                                                            <span className="text-[#B8B9BC] text-sm flex-1 truncate">
                                                                {audioForm.customMusicUrl.split('/').pop()}
                                                            </span>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => setAudioForm({ ...audioForm, customMusicUrl: '' })}
                                                                className="h-6 w-6 text-[#B8B9BC] hover:text-red-400"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="relative">
                                                            <input
                                                                type="file"
                                                                accept=".mp3,.wav,audio/mpeg,audio/wav"
                                                                onChange={async (e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (!file) return;

                                                                    setUploadingMusic(true);
                                                                    try {
                                                                        const reader = new FileReader();
                                                                        reader.onloadend = async () => {
                                                                            const audioData = reader.result as string;
                                                                            const res = await apiFetch('/api/upload-music', {
                                                                                method: 'POST',
                                                                                headers: { 'Content-Type': 'application/json' },
                                                                                body: JSON.stringify({
                                                                                    userId,
                                                                                    audioData,
                                                                                    fileName: file.name
                                                                                })
                                                                            });

                                                                            const data = await res.json();
                                                                            if (data.success && data.url) {
                                                                                setAudioForm({ ...audioForm, customMusicUrl: data.url });
                                                                            } else {
                                                                                alert('Failed to upload music file');
                                                                            }
                                                                            setUploadingMusic(false);
                                                                        };
                                                                        reader.readAsDataURL(file);
                                                                    } catch (err) {
                                                                        console.error('Music upload error:', err);
                                                                        alert('Failed to upload music file');
                                                                        setUploadingMusic(false);
                                                                    }
                                                                }}
                                                                className="hidden"
                                                                id="music-upload"
                                                            />
                                                            <label
                                                                htmlFor="music-upload"
                                                                className={`flex items-center justify-center gap-2 p-3 border-2 border-dashed border-[#3A3A3A] rounded-lg cursor-pointer hover:border-[#F97316]/50 transition-colors ${uploadingMusic ? 'opacity-50 pointer-events-none' : ''}`}
                                                            >
                                                                {uploadingMusic ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />
                                                                ) : (
                                                                    <Plus className="w-4 h-4 text-[#B8B9BC]" />
                                                                )}
                                                                <span className="text-sm text-[#B8B9BC]">
                                                                    {uploadingMusic ? 'Uploading...' : 'Upload MP3 or WAV'}
                                                                </span>
                                                            </label>
                                                        </div>
                                                    )}
                                                    <p className="text-xs text-[#777]">
                                                        Upload custom background music, or leave empty to use default.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-2 pt-4 sm:flex-row">
                                        <Button
                                            onClick={saveAudioPreset}
                                            className="bg-[#F97316] hover:bg-[#EA580C] text-white flex items-center gap-2"
                                        >
                                            <Save className="w-4 h-4" />
                                            {editingAudioId ? 'Update Preset' : 'Save Preset'}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => { setShowAudioForm(false); setEditingAudioId(null); }}
                                            className="border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {audioPresets.length === 0 && !showAudioForm ? (
                                <div className="flex flex-col items-center justify-center p-8 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                                    <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4">
                                        <Music className="w-6 h-6 text-[#F97316]" />
                                    </div>
                                    <h4 className="text-lg font-medium text-white mb-2">No Audio Presets</h4>
                                    <p className="text-sm text-[#B8B9BC] text-center mb-4">
                                        Create presets with voice and audio settings.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid gap-3">
                                    {audioPresets.map((preset) => (
                                        <div
                                            key={preset.id}
                                            className="flex flex-col items-start justify-between gap-3 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] p-4 transition-colors hover:border-[#F97316]/50 sm:flex-row sm:items-center"
                                        >
                                            <div>
                                                <p className="font-medium text-white">{preset.name}</p>
                                                <p className="text-xs text-[#B8B9BC]">
                                                    {({ local: 'Local TTS', vibi: 'Vibi', fish: 'Fish Audio' } as Record<string, string>)[preset.ttsProvider || ''] || 'ElevenLabs'} •
                                                    Voice: {preset.ttsProvider === 'local' ? (preset.localVoiceName || preset.localVoiceId)
                                                        : preset.ttsProvider === 'vibi' ? preset.vibiVoiceName
                                                            : preset.ttsProvider === 'fish' ? preset.fishAudioModelName
                                                                : preset.voiceName || preset.voiceId?.slice(0, 8)} •
                                                    Maximum: {preset.targetDurationMin && preset.targetDurationMax
                                                        ? `${formatDuration(preset.targetDurationMin)}–${formatDuration(preset.targetDurationMax)}`
                                                        : preset.targetDuration ? formatDuration(preset.targetDuration) : 'Auto'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEditAudio(preset)}
                                                    className="hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-white"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => deleteAudioPreset(preset.id)}
                                                    className="hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-red-400"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>


                {/* Caption Styles Tab */}
                <TabsContent value="caption">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-2">
                                    <Type className="w-5 h-5 text-[#F97316]" />
                                    <CardTitle className="text-white">Caption Styles</CardTitle>
                                </div>
                                <Button
                                    onClick={() => {
                                        setShowCaptionForm(true);
                                        setEditingCaptionId(null);
                                        setCaptionForm({
                                            name: '',
                                            captionStyle: {
                                                font: 'Roboto',
                                                style: 'single',
                                                subtitle_size: 64,
                                                stroke_size: 8,
                                                hook_animation_type: 'fall',
                                                caption_animation_type: 'scale',
                                                color: '#FFFFFF'
                                            }
                                        });
                                    }}
                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Style
                                </Button>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                visually customize caption fonts, colors, and animations
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {showCaptionForm && (
                                <div className="mb-6 p-4 bg-[#1A1A1A] rounded-lg border border-[#F97316]/30">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-white font-medium">
                                            {editingCaptionId ? 'Edit Caption Style' : 'New Caption Style'}
                                        </h4>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { setShowCaptionForm(false); setEditingCaptionId(null); }}
                                            className="text-[#B8B9BC] hover:text-white h-8 w-8"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                        {/* Left Column: Controls */}
                                        <div className="space-y-4">
                                            {CAPTION_TEMPLATE_GROUPS.map(group => (
                                                <div key={group.id} className="space-y-2">
                                                    <Label className="text-white">{group.label}</Label>
                                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                                        {CAPTION_TEMPLATES.filter(t => t.group === group.id).map(template => (
                                                            <button
                                                                key={template.id}
                                                                type="button"
                                                                onClick={() => setCaptionForm({
                                                                    name: template.name,
                                                                    // reset look fields the template doesn't set (box, color mix, highlight)
                                                                    captionStyle: {
                                                                        ...captionForm.captionStyle, rainbow_text: false, color_mix: false, box_color: null,
                                                                        ...template.style,
                                                                        palette: 'palette' in template.style ? [...template.style.palette] : captionForm.captionStyle.palette,
                                                                    } as CaptionStyle,
                                                                })}
                                                                className="text-left rounded-md border border-[#3A3A3A] bg-[#2A2A2A] px-3 py-2 hover:border-[#F97316]/60 transition-colors"
                                                            >
                                                                <span className="block text-sm text-white" style={{ fontFamily: `"${template.style.font}", sans-serif` }}>{template.name}</span>
                                                                <span className="block text-xs text-[#777]">{group.id === 'channel' ? `like ${template.inspiredBy}` : template.inspiredBy}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}

                                            <div className="space-y-2">
                                                <Label className="text-white">Preset Name *</Label>
                                                <Input
                                                    value={captionForm.name}
                                                    onChange={(e) => setCaptionForm({ ...captionForm, name: e.target.value })}
                                                    placeholder="e.g., Big Bold Yellow"
                                                    className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label className="text-white">Font</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.font}
                                                        onValueChange={(v) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, font: v } })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            {FONT_OPTIONS.map(font => (
                                                                <SelectItem key={font} value={font} className="text-white">{font}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-white">Style</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.style}
                                                        onValueChange={(v: any) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, style: v } })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="single" className="text-white">Single Word</SelectItem>
                                                            <SelectItem value="grouped" className="text-white">Grouped</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-white">Animation</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.caption_animation_type || 'scale'}
                                                        onValueChange={(v: any) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, caption_animation_type: v } })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            {CAPTION_ANIMATION_OPTIONS.map(option => (
                                                                <SelectItem key={option.value} value={option.value} className="text-white">{option.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-white">Text Case</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.text_case || 'none'}
                                                        onValueChange={(v: any) => setCaptionStyle({ text_case: v })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="none" className="text-white">As Spoken</SelectItem>
                                                            <SelectItem value="upper" className="text-white">ALL CAPS</SelectItem>
                                                            <SelectItem value="lower" className="text-white">lowercase</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-white">Shadow</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.shadow || 'none'}
                                                        onValueChange={(v: any) => setCaptionStyle({ shadow: v })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="none" className="text-white">None</SelectItem>
                                                            <SelectItem value="hard" className="text-white">Hard Drop Shadow</SelectItem>
                                                            <SelectItem value="soft" className="text-white">Soft Glow</SelectItem>
                                                            <SelectItem value="neon" className="text-white">Neon (glow in text color)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-white">Position</Label>
                                                    <Select
                                                        value={captionForm.captionStyle.position || 'center'}
                                                        onValueChange={(v: any) => setCaptionStyle({ position: v })}
                                                    >
                                                        <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="upper" className="text-white">Upper Third</SelectItem>
                                                            <SelectItem value="center" className="text-white">Center</SelectItem>
                                                            <SelectItem value="lower" className="text-white">Lower Third</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                            </div>



                                            <div className="space-y-2">
                                                <Label className="text-white">Size ({captionForm.captionStyle.subtitle_size}px)</Label>
                                                <Slider
                                                    value={[captionForm.captionStyle.subtitle_size]}
                                                    onValueChange={(([v]) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, subtitle_size: v } }))}
                                                    min={20}
                                                    max={400}
                                                    step={2}
                                                    className="py-2"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <Label className="text-white">Stroke Width ({captionForm.captionStyle.stroke_size}px)</Label>
                                                <Slider
                                                    value={[captionForm.captionStyle.stroke_size]}
                                                    onValueChange={(([v]) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, stroke_size: v } }))}
                                                    min={0}
                                                    max={20}
                                                    step={1}
                                                    className="py-2"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <Label className="text-white">Color</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        type="color"
                                                        value={captionForm.captionStyle.color || '#FFFFFF'}
                                                        onChange={(e) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, color: e.target.value } })}
                                                        className="w-12 h-10 p-1 bg-[#2A2A2A] border-[#3A3A3A]"
                                                    />
                                                    <Input
                                                        value={captionForm.captionStyle.color || '#FFFFFF'}
                                                        onChange={(e) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, color: e.target.value } })}
                                                        className="bg-[#2A2A2A] border-[#3A3A3A] text-white flex-1"
                                                    />
                                                </div>
                                            </div>

                                            {/* Rainbow Text Toggle */}
                                            <div className="flex items-center justify-between pt-2">
                                                <div>
                                                    <Label className="text-white">Rainbow Text</Label>
                                                    <p className="text-xs text-[#777]">Color every word with rotating vibrant colors</p>
                                                </div>
                                                <Switch
                                                    checked={captionForm.captionStyle.rainbow_text || false}
                                                    onCheckedChange={(v) => setCaptionForm({ ...captionForm, captionStyle: { ...captionForm.captionStyle, rainbow_text: v } })}
                                                />
                                            </div>

                                            {/* Color mix */}
                                            <div className="space-y-2 pt-2">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <Label className="text-white">Color Mix</Label>
                                                        <p className="text-xs text-[#777]">Random color per word from these, held for 1-3 words</p>
                                                    </div>
                                                    <Switch
                                                        checked={captionForm.captionStyle.color_mix || false}
                                                        onCheckedChange={(v) => setCaptionStyle({
                                                            color_mix: v,
                                                            rainbow_text: v ? false : captionForm.captionStyle.rainbow_text,
                                                            palette: captionForm.captionStyle.palette?.length ? captionForm.captionStyle.palette : [...COLOR_MIX_PALETTE],
                                                        })}
                                                    />
                                                </div>
                                                {captionForm.captionStyle.color_mix && (
                                                    <div className="flex gap-2">
                                                        {(captionForm.captionStyle.palette || COLOR_MIX_PALETTE).map((color, i) => (
                                                            <Input
                                                                key={i}
                                                                type="color"
                                                                value={color}
                                                                onChange={(e) => {
                                                                    const palette = [...(captionForm.captionStyle.palette || COLOR_MIX_PALETTE)];
                                                                    palette[i] = e.target.value;
                                                                    setCaptionStyle({ palette });
                                                                }}
                                                                className="w-12 h-9 p-1 bg-[#2A2A2A] border-[#3A3A3A]"
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Box behind captions */}
                                            <div className="flex items-center justify-between gap-4 pt-2">
                                                <div>
                                                    <Label className="text-white">Background Box</Label>
                                                    <p className="text-xs text-[#777]">Rounded box behind each word (CapCut box presets)</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {captionForm.captionStyle.box_color && (
                                                        <Input
                                                            type="color"
                                                            value={captionForm.captionStyle.box_color.slice(0, 7)}
                                                            onChange={(e) => setCaptionStyle({ box_color: e.target.value })}
                                                            className="w-10 h-8 p-1 bg-[#2A2A2A] border-[#3A3A3A]"
                                                        />
                                                    )}
                                                    <Switch
                                                        checked={!!captionForm.captionStyle.box_color}
                                                        onCheckedChange={(v) => setCaptionStyle({ box_color: v ? '#FFE81F' : null })}
                                                    />
                                                </div>
                                            </div>

                                            {/* Keyword highlights */}
                                            <div className="flex items-center justify-between gap-4 pt-2">
                                                <div>
                                                    <Label className="text-white">Highlight Key Words</Label>
                                                    <p className="text-xs text-[#777]">Color numbers, money, exclamations and every few key words</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {captionForm.captionStyle.highlight_mode === 'auto' && (
                                                        <Input
                                                            type="color"
                                                            value={captionForm.captionStyle.highlight_color || '#FFE81F'}
                                                            onChange={(e) => setCaptionStyle({ highlight_color: e.target.value })}
                                                            className="w-10 h-8 p-1 bg-[#2A2A2A] border-[#3A3A3A]"
                                                        />
                                                    )}
                                                    <Switch
                                                        checked={captionForm.captionStyle.highlight_mode === 'auto'}
                                                        onCheckedChange={(v) => setCaptionStyle({ highlight_mode: v ? 'auto' : 'none' })}
                                                    />
                                                </div>
                                            </div>

                                            <div className="pt-4 flex gap-2">
                                                <Button
                                                    onClick={handleSaveCaptionPreset}
                                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white flex-1"
                                                >
                                                    <Save className="w-4 h-4 mr-2" />
                                                    Save Style
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Right Column: Preview */}
                                        <div className="bg-[#111] rounded-lg p-4 border border-[#3A3A3A] flex flex-col items-center justify-center">
                                            <Label className="text-[#B8B9BC] mb-4">Live Preview</Label>
                                            <div className="w-full flex justify-center">
                                                <CaptionPreview
                                                    style={captionForm.captionStyle}
                                                    text={captionForm.name || "Visual Builder"}
                                                />
                                            </div>
                                            <p className="text-xs text-[#555] mt-4 text-center">
                                                This preview simulates the final video render.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {captionPresets.length === 0 && !showCaptionForm ? (
                                <div className="flex flex-col items-center justify-center p-8 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                                    <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4">
                                        <Type className="w-6 h-6 text-[#F97316]" />
                                    </div>
                                    <h4 className="text-lg font-medium text-white mb-2">No Caption Styles</h4>
                                    <p className="text-sm text-[#B8B9BC] text-center mb-4">
                                        Create your first visual caption style.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {captionPresets.map((preset) => (
                                        <div
                                            key={preset.id}
                                            className="p-4 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] hover:border-[#F97316]/50 transition-colors relative group"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <p className="font-medium text-white truncate pr-8">{preset.name}</p>
                                                <div className="absolute top-2 right-2 hidden group-hover:flex gap-1 bg-[#1A1A1A]/80 rounded p-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEditCaption(preset)}
                                                        className="h-6 w-6 hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-white"
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDeleteCaptionPreset(preset.id)}
                                                        className="h-6 w-6 hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-red-400"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                            {/* Mini Preview */}
                                            <div className="h-20 overflow-hidden relative rounded bg-black/50 border border-[#333] flex justify-center items-center">
                                                <div className="scale-50 origin-center w-[200%] h-[200%] flex justify-center items-center">
                                                    <CaptionPreview style={preset.captionStyle} text="Abc" />
                                                </div>
                                            </div>
                                            <p className="text-xs text-[#777] mt-2">
                                                {preset.captionStyle.font} • {preset.captionStyle.subtitle_size}px
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Hook Styles Tab */}
                <TabsContent value="hook_style">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-2">
                                    <Type className="w-5 h-5 text-[#F97316]" />
                                    <CardTitle className="text-white">Hook Style Presets</CardTitle>
                                </div>
                                <Button
                                    onClick={handleOpenHookStyleForm}
                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Hook Style
                                </Button>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                Customize hook card appearance (title color, background, font)
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {showHookStyleForm && (
                                <div className="mb-6 p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                                    <h4 className="text-white font-medium mb-4">
                                        {editingHookStyleId ? 'Edit Hook Style' : 'New Hook Style'}
                                    </h4>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label className="text-white">Preset Name *</Label>
                                            <Input
                                                value={hookStyleForm.name}
                                                onChange={(e) => setHookStyleForm({ ...hookStyleForm, name: e.target.value })}
                                                placeholder="My Hook Style"
                                                className="bg-[#2A2A2A] border-[#3A3A3A] text-white"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-white">Start from a channel look</Label>
                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                {HOOK_STYLE_TEMPLATES.map(template => (
                                                    <button
                                                        key={template.id}
                                                        type="button"
                                                        onClick={() => setHookStyleForm({
                                                            name: hookStyleForm.name || template.name,
                                                            hookStyle: { ...template.hookStyle },
                                                        })}
                                                        className="text-left rounded-md border border-[#3A3A3A] bg-[#2A2A2A] px-3 py-2 hover:border-[#F97316]/60 transition-colors"
                                                    >
                                                        <span className="flex items-center gap-2 text-sm text-white">
                                                            <span
                                                                className="inline-block h-3 w-3 rounded-sm border border-[#555]"
                                                                style={{ backgroundColor: template.hookStyle.backgroundColor }}
                                                            />
                                                            {template.name}
                                                        </span>
                                                        <span className="block text-xs text-[#777]">like {template.inspiredBy}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label className="text-white">Title Color</Label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="color"
                                                        value={hookStyleForm.hookStyle.titleColor}
                                                        onChange={(e) => setHookStyleForm({
                                                            ...hookStyleForm,
                                                            hookStyle: { ...hookStyleForm.hookStyle, titleColor: e.target.value }
                                                        })}
                                                        className="w-10 h-10 rounded border border-[#3A3A3A] cursor-pointer"
                                                    />
                                                    <Input
                                                        value={hookStyleForm.hookStyle.titleColor}
                                                        onChange={(e) => setHookStyleForm({
                                                            ...hookStyleForm,
                                                            hookStyle: { ...hookStyleForm.hookStyle, titleColor: e.target.value }
                                                        })}
                                                        className="bg-[#2A2A2A] border-[#3A3A3A] text-white flex-1"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label className="text-white">Background Color</Label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="color"
                                                        value={hookStyleForm.hookStyle.backgroundColor}
                                                        onChange={(e) => setHookStyleForm({
                                                            ...hookStyleForm,
                                                            hookStyle: { ...hookStyleForm.hookStyle, backgroundColor: e.target.value }
                                                        })}
                                                        className="w-10 h-10 rounded border border-[#3A3A3A] cursor-pointer"
                                                    />
                                                    <Input
                                                        value={hookStyleForm.hookStyle.backgroundColor}
                                                        onChange={(e) => setHookStyleForm({
                                                            ...hookStyleForm,
                                                            hookStyle: { ...hookStyleForm.hookStyle, backgroundColor: e.target.value }
                                                        })}
                                                        className="bg-[#2A2A2A] border-[#3A3A3A] text-white flex-1"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label className="text-white">Font</Label>
                                                <Select
                                                    value={hookStyleForm.hookStyle.font}
                                                    onValueChange={(v) => setHookStyleForm({
                                                        ...hookStyleForm,
                                                        hookStyle: { ...hookStyleForm.hookStyle, font: v }
                                                    })}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                        {FONT_OPTIONS.map(font => (
                                                            <SelectItem key={font} value={font} className="text-white">{font}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <Label className="text-white">Border Radius</Label>
                                                <div className="flex items-center gap-2">
                                                    <Slider
                                                        value={[hookStyleForm.hookStyle.borderRadius || 12]}
                                                        onValueChange={([v]) => setHookStyleForm({
                                                            ...hookStyleForm,
                                                            hookStyle: { ...hookStyleForm.hookStyle, borderRadius: v }
                                                        })}
                                                        min={0}
                                                        max={60}
                                                        step={1}
                                                        className="flex-1"
                                                    />
                                                    <span className="text-[#B8B9BC] text-sm w-8">{hookStyleForm.hookStyle.borderRadius}px</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Hook at Top - Engagement Boost */}
                                        <div className="flex items-center justify-between pt-4 border-t border-[#3A3A3A]">
                                            <div>
                                                <Label className="text-white">Hook at Top (Engagement Boost)</Label>
                                                <p className="text-xs text-[#777]">Position hook at top ~20% of frame. Captions appear in middle from frame 0.</p>
                                            </div>
                                            <Switch
                                                checked={hookStyleForm.hookStyle.hookTopPosition || false}
                                                onCheckedChange={(v) => setHookStyleForm({
                                                    ...hookStyleForm,
                                                    hookStyle: { ...hookStyleForm.hookStyle, hookTopPosition: v }
                                                })}
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label className="text-white">Animation</Label>
                                                <Select
                                                    value={hookStyleForm.hookStyle.animation || 'channel'}
                                                    onValueChange={(v) => setHookStyle({ animation: v === 'channel' ? null : v as HookStyle['animation'] })}
                                                >
                                                    <SelectTrigger className="bg-[#2A2A2A] border-[#3A3A3A] text-white">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                        <SelectItem value="channel" className="text-white">Use channel setting</SelectItem>
                                                        {HOOK_ANIMATION_OPTIONS.map(option => (
                                                            <SelectItem key={option.value} value={option.value} className="text-white">{option.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-white">Card Size ({Math.round((hookStyleForm.hookStyle.scale || 1) * 100)}%)</Label>
                                                <Slider
                                                    value={[hookStyleForm.hookStyle.scale || 1]}
                                                    onValueChange={([v]) => setHookStyle({ scale: v })}
                                                    min={0.8}
                                                    max={1.3}
                                                    step={0.02}
                                                    className="py-2"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-white">Title Line Spacing ({(hookStyleForm.hookStyle.titleLineHeight || 0.9).toFixed(2)})</Label>
                                                <Slider
                                                    value={[hookStyleForm.hookStyle.titleLineHeight || 0.9]}
                                                    onValueChange={([v]) => setHookStyle({ titleLineHeight: v })}
                                                    min={0.85}
                                                    max={1.4}
                                                    step={0.01}
                                                    className="py-2"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <Label className="text-white">Menu Dots (•••)</Label>
                                                    <p className="text-xs text-[#777]">Top-right overflow menu, like dark-mode Reddit</p>
                                                </div>
                                                <Switch
                                                    checked={hookStyleForm.hookStyle.menuDots || false}
                                                    onCheckedChange={(v) => setHookStyle({ menuDots: v })}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <Label className="text-white">Color the Question's Lead</Label>
                                                <p className="text-xs text-[#777]">"<span className="text-[#FF4B4B]">Teachers of Reddit</span>, what..." style questions</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {hookStyleForm.hookStyle.accentMode === 'lead' && (
                                                    <Input
                                                        type="color"
                                                        value={hookStyleForm.hookStyle.accentColor || '#FF4B4B'}
                                                        onChange={(e) => setHookStyle({ accentColor: e.target.value })}
                                                        className="w-10 h-8 p-1 bg-[#2A2A2A] border-[#3A3A3A]"
                                                    />
                                                )}
                                                <Switch
                                                    checked={hookStyleForm.hookStyle.accentMode === 'lead'}
                                                    onCheckedChange={(v) => setHookStyle({
                                                        accentMode: v ? 'lead' : 'none',
                                                        accentColor: hookStyleForm.hookStyle.accentColor || '#FF4B4B',
                                                    })}
                                                />
                                            </div>
                                        </div>

                                        {/* Preview - animated, on video, using the renderer's animation math */}
                                        <div className="space-y-2 pt-4 border-t border-[#3A3A3A]">
                                            <Label className="text-white">Live Preview</Label>
                                            <HookPreview hookStyle={hookStyleForm.hookStyle} text={PREVIEW_HOOK_TEXT} />
                                            <p className="text-xs text-[#555] text-center">
                                                Loops a 3.5s hook.{!hookStyleForm.hookStyle.animation && ' "Use channel setting" previews Falling.'}
                                                {hookStyleForm.hookStyle.hookTopPosition && ' The middle word stands in for your captions.'}
                                            </p>
                                        </div>

                                        <div className="flex flex-col gap-2 pt-4 sm:flex-row">
                                            <Button
                                                onClick={handleSaveHookStylePreset}
                                                className="bg-[#F97316] hover:bg-[#EA580C] text-white flex items-center gap-2"
                                            >
                                                <Save className="w-4 h-4" />
                                                {editingHookStyleId ? 'Update Style' : 'Save Style'}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                onClick={() => { setShowHookStyleForm(false); setEditingHookStyleId(null); }}
                                                className="border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {hookStylePresets.length === 0 && !showHookStyleForm ? (
                                <p className="text-[#B8B9BC] text-center py-8">
                                    No hook style presets yet. Create one to customize hook card appearance.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {hookStylePresets.map((preset) => (
                                        <div key={preset.id} className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-white font-medium">{preset.name}</span>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEditHookStyle(preset)}
                                                        className="h-7 w-7 text-[#B8B9BC] hover:text-white"
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDeleteHookStylePreset(preset.id)}
                                                        className="h-7 w-7 text-[#B8B9BC] hover:text-red-400"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                            {/* Mini Preview */}
                                            <div className="flex justify-center p-3 bg-black/50 rounded border border-[#333]">
                                                <div
                                                    style={{
                                                        backgroundColor: preset.hookStyle?.backgroundColor || '#000000',
                                                        borderRadius: `${preset.hookStyle?.borderRadius || 12}px`,
                                                        padding: '8px 16px',
                                                        fontFamily: preset.hookStyle?.font || 'Roboto'
                                                    }}
                                                >
                                                    <span style={{ color: preset.hookStyle?.titleColor || '#FFFFFF', fontWeight: 'bold', fontSize: '12px' }}>
                                                        Sample
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-[#777] mt-2">
                                                {preset.hookStyle?.font || 'Roboto'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="visual_filter">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <CardTitle className="text-white">Visual Filter Presets</CardTitle>
                                <Button
                                    onClick={() => {
                                        setVisualFilterForm({ name: '', filterType: 'none' });
                                        setEditingPresetId(null);
                                        setShowPresetDialog(true);
                                    }}
                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Visual Filter
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {visualFilterPresets.map((preset) => (
                                    <div key={preset.id} className="p-4 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-white font-medium">{preset.name}</span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setVisualFilterForm({ name: preset.name, filterType: preset.visual_filter });
                                                    setEditingPresetId(preset.id);
                                                    setShowPresetDialog(true);
                                                }}
                                                className="h-6 w-6 hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-white"
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </Button>
                                        </div>
                                        <div className="rounded overflow-hidden border border-[#333]">
                                            <VisualFilterPreview filterType={preset.visual_filter} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs >
            {/* Visual Filter Dialog */}
            {
                showPresetDialog && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-2 sm:p-4">
                        <Card className="max-h-[calc(100dvh-1rem)] w-full max-w-4xl overflow-y-auto border-[#3A3A3A] bg-[#2A2A2A] sm:max-h-[90vh]">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-white">
                                        {editingPresetId ? 'Edit Visual Filter' : 'New Visual Filter'}
                                    </CardTitle>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowPresetDialog(false)}
                                        className="text-[#B8B9BC] hover:text-white"
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <Label className="text-white">Preset Name</Label>
                                        <Input
                                            value={visualFilterForm.name}
                                            onChange={(e) => setVisualFilterForm({ ...visualFilterForm, name: e.target.value })}
                                            placeholder="e.g., Cinematic Dark"
                                            className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-white">Filter Style</Label>
                                        <Select
                                            value={visualFilterForm.filterType}
                                            onValueChange={(v: any) => setVisualFilterForm({ ...visualFilterForm, filterType: v })}
                                        >
                                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A] z-[200]">
                                                <SelectItem value="none" className="text-white">Standard (None)</SelectItem>
                                                <SelectItem value="vibrant" className="text-white">Vibrant (Pop)</SelectItem>
                                                <SelectItem value="dark" className="text-white">Cinema (Contrast)</SelectItem>
                                                <SelectItem value="warm" className="text-white">Warm (Subtle)</SelectItem>
                                                <SelectItem value="cool" className="text-white">Cool (Subtle)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                                        <Button
                                            onClick={handleSaveVisualFilterPreset}
                                            className="bg-[#F97316] hover:bg-[#EA580C] text-white flex-1"
                                        >
                                            <Save className="w-4 h-4 mr-2" />
                                            {editingPresetId ? 'Update Preset' : 'Save Preset'}
                                        </Button>
                                    </div>
                                </div>

                                {/* Preview Column */}
                                <div className="flex flex-col gap-2">
                                    <Label className="text-white">Preview (9:16)</Label>
                                    <div className="border border-[#333] rounded overflow-hidden max-w-[280px] mx-auto w-full">
                                        <VisualFilterPreview filterType={visualFilterForm.filterType} />
                                    </div>
                                    <p className="text-xs text-[#777] text-center">
                                        Filters are applied to the generated video background.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )
            }
        </div >
    );
}
