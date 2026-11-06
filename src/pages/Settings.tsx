import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Users2, Save, X, Upload, CheckCircle2, Key, Bell } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import type { ChannelProfile } from '@/types/channel';
import { FONT_OPTIONS } from '@/lib/videoStyles';
import AuraChannelSettings from '@/components/AuraChannelSettings';
import TeamSettings from '@/components/TeamSettings';

interface UserSettings {
    elevenlabs_api_key?: string;
    fish_audio_api_key?: string;
    vibi_api_key?: string;
    groq_api_key?: string;
    local_tts_url?: string;
    local_tts_api_key?: string;
    telegram_user_id?: string;
}

export default function Settings() {
    const { user, updatePassword, enrollMFA, verifyMFA, unenrollMFA, supabase } = useAuth();
    const userId = user?.id || 'default';
    // Accounts made from a team invite only get the Team tab (the rest is the owner's tooling)
    const teamOnly = user?.app_metadata?.team_only === true;

    const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [userSettings, setUserSettings] = useState<UserSettings>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [showProfileDialog, setShowProfileDialog] = useState(false);
    const [editingProfile, setEditingProfile] = useState<ChannelProfile | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [activeTab, setActiveTab] = useState(() => {
        return localStorage.getItem('rddtfun_settings_tab') || 'channels';
    });

    // Profile form state
    const [profileForm, setProfileForm] = useState({
        name: '',
        nickname: '',
        image_url: '',
        caption_preset_id: null as string | null,
        male_voice_preset_id: null as string | null,
        female_voice_preset_id: null as string | null,
        hook_style_preset_id: null as string | null,
        visual_filter_preset_id: null as string | null,
        font: 'Roboto',
        style: 'single' as 'single' | 'grouped',
        background_video_type: 'cooking',
        hook_animation_type: 'fall' as 'fall' | 'float',
        subtitle_size: 64,
        stroke_size: 8
    });

    const [profileSettings, setProfileSettings] = useState({
        email: user?.email || '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

    const [mfaData, setMfaData] = useState<{
        factorId: string;
        qrCode: string;
        secret: string;
    } | null>(null);
    const [mfaCode, setMfaCode] = useState('');
    const [isMfaActive, setIsMfaActive] = useState(false);
    const [loadingMfa, setLoadingMfa] = useState(false);
    const [showMfaChallenge, setShowMfaChallenge] = useState(false);
    const [challengeFactorId, setChallengeFactorId] = useState('');
    const [captionPresets, setCaptionPresets] = useState<any[]>([]);
    const [audioPresets, setAudioPresets] = useState<any[]>([]);
    const [hookStylePresets, setHookStylePresets] = useState<any[]>([]);
    const [visualFilterPresets, setVisualFilterPresets] = useState<any[]>([]);

    useEffect(() => {
        if (userId !== 'default' && !teamOnly) {
            loadProfiles();
            loadUserSettings();
            loadCaptionPresets();
            loadAudioPresets();
            loadHookStylePresets();
            loadVisualFilterPresets();
            checkMfaStatus();
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

    const checkMfaStatus = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (error) throw error;
            const activeMfa = data.all.find(f => f.status === 'verified');
            setIsMfaActive(!!activeMfa);
        } catch (err) {
            console.error('Error checking MFA status:', err);
        }
    };

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        localStorage.setItem('rddtfun_settings_tab', value);
    };

    const loadProfiles = async () => {
        try {
            const response = await apiFetch(`/api/channel-profiles/${userId}`);
            const data = await response.json();
            setProfiles(data.profiles || []);
        } catch (err) {
            console.error('Failed to load profiles:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadCaptionPresets = async () => {
        try {
            const response = await apiFetch(`/api/presets?userId=${userId}`);
            const data = await response.json();
            setCaptionPresets(data.filter((p: any) => p.type === 'caption_style') || []);
        } catch (err) {
            console.error('Failed to load caption presets:', err);
        }
    };

    const loadAudioPresets = async () => {
        try {
            const response = await apiFetch(`/api/presets?userId=${userId}`);
            const data = await response.json();
            setAudioPresets(data.filter((p: any) => p.type === 'audio') || []);
        } catch (err) {
            console.error('Failed to load audio presets:', err);
        }
    };

    const loadHookStylePresets = async () => {
        try {
            const response = await apiFetch(`/api/presets?userId=${userId}`);
            const data = await response.json();
            setHookStylePresets(data.filter((p: any) => p.type === 'hook_style') || []);
        } catch (err) {
            console.error('Failed to load hook style presets:', err);
        }
    };

    const loadUserSettings = async () => {
        try {
            const response = await apiFetch(`/api/user-settings/${userId}`);
            const data = await response.json();
            // Data is now normalized to snake_case on the backend, 
            // but we'll still handle camelCase for legacy local data
            setUserSettings({
                elevenlabs_api_key: data.elevenlabs_api_key || data.elevenlabsApiKey || '',
                fish_audio_api_key: data.fish_audio_api_key || data.fishAudioApiKey || '',
                vibi_api_key: data.vibi_api_key || data.vibiApiKey || '',
                groq_api_key: data.groq_api_key || data.groqApiKey || '',
                local_tts_url: data.local_tts_url || '',
                local_tts_api_key: data.local_tts_api_key || '',
                telegram_user_id: data.telegram_user_id || data.telegramUserId || ''
            });
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const saveUserSettings = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const response = await apiFetch('/api/save-user-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    elevenlabsApiKey: userSettings.elevenlabs_api_key,
                    fishAudioApiKey: userSettings.fish_audio_api_key,
                    vibiApiKey: userSettings.vibi_api_key,
                    groqApiKey: userSettings.groq_api_key,
                    localTtsUrl: userSettings.local_tts_url,
                    localTtsApiKey: userSettings.local_tts_api_key,
                    telegramUserId: userSettings.telegram_user_id
                })
            });
            console.log("Saving users settings from FE", userSettings);
            const data = await response.json();
            if (data.success) {
                setSaved(true);
                // Immediately refresh settings to ensure we have the latest
                await loadUserSettings();
                setTimeout(() => setSaved(false), 3000);
            } else {
                alert('Error saving settings');
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleCreateProfile = () => {
        setEditingProfile(null);
        setProfileForm({
            name: '',
            nickname: '',
            image_url: '',
            caption_preset_id: null,
            male_voice_preset_id: null,
            female_voice_preset_id: null,
            hook_style_preset_id: null,
            font: 'Roboto',
            style: 'single',
            background_video_type: 'cooking',
            hook_animation_type: 'fall',
            subtitle_size: 64,
            stroke_size: 8,
            visual_filter_preset_id: null
        });
        setShowProfileDialog(true);
    };

    const handleEditProfile = (profile: ChannelProfile) => {
        setEditingProfile(profile);
        setProfileForm({
            name: profile.name,
            nickname: profile.nickname || '',
            image_url: profile.image_url || '',
            caption_preset_id: profile.caption_preset_id || null,
            male_voice_preset_id: profile.male_voice_preset_id || null,
            female_voice_preset_id: profile.female_voice_preset_id || null,
            hook_style_preset_id: profile.hook_style_preset_id || null,
            visual_filter_preset_id: profile.visual_filter_preset_id || null,
            font: profile.font || 'Roboto',
            style: profile.style || 'single',
            background_video_type: profile.background_video_type || 'cooking',
            hook_animation_type: profile.hook_animation_type || 'fall',
            subtitle_size: profile.subtitle_size || 64,
            stroke_size: profile.stroke_size || 8
        });
        setShowProfileDialog(true);
    };

    const handleImageUpload = useCallback(async (file: File) => {
        setUploadingImage(true);
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const imageData = reader.result as string;

                const response = await apiFetch('/api/upload-profile-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        imageData,
                        fileName: file.name
                    })
                });

                const data = await response.json();
                if (data.success) {
                    setProfileForm(prev => ({ ...prev, image_url: data.imageUrl }));
                } else {
                    alert('Failed to upload image');
                }
                setUploadingImage(false);
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error('Error uploading image:', err);
            setUploadingImage(false);
        }
    }, [userId]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageUpload(file);
        }
    }, [handleImageUpload]);

    const handleUpdatePassword = async () => {
        if (profileSettings.newPassword !== profileSettings.confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        if (profileSettings.newPassword.length < 6) {
            alert('Password must be at least 6 characters');
            return;
        }
        if (!profileSettings.currentPassword) {
            alert('Please enter your current password');
            return;
        }

        setSaving(true);
        try {
            // Check session level
            const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalError) throw aalError;

            // If user is at AAL1 but has AAL2 capabilities (MFA enabled), upgrade session first
            if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
                const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
                if (factorsError) throw factorsError;

                const verifiedFactor = factors.all.find(f => f.status === 'verified' && f.factor_type === 'totp');
                if (verifiedFactor) {
                    // Trigger MFA Challenge UI
                    setChallengeFactorId(verifiedFactor.id);
                    setShowMfaChallenge(true);
                    setSaving(false);
                    return; // Stop here, wait for MFA verification
                }
            }

            // At this point, either user is AAL2 or doesn't have MFA. Proceed with update.
            // Note: If MFA is enabled but we are AAL1 and failed to find a factor, updatePassword will likely fail.
            const { error } = await updatePassword(profileSettings.newPassword);
            if (error) throw error;

            alert('Password updated successfully!');
            setProfileSettings({
                ...profileSettings,
                currentPassword: '',
                newPassword: '',
                confirmPassword: ''
            });
        } catch (err) {
            console.error('Error updating password:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            alert('Failed to update password: ' + message);
        } finally {
            if (!showMfaChallenge) setSaving(false);
        }
    };

    const handleChallengeVerify = async () => {
        setLoadingMfa(true);
        try {
            const { error } = await verifyMFA(challengeFactorId, mfaCode);
            if (error) throw error;

            // MFA Verified! Session should now be AAL2.
            setShowMfaChallenge(false);
            setMfaCode('');

            // Retry the password update
            // We can just call handleUpdatePassword again, it should pass the AAL check now.
            // But we need to use 'saving' state correctly.
            setLoadingMfa(false);
            handleUpdatePassword();
        } catch (err) {
            console.error('Error verifying MFA challenge:', err);
            alert('Verification failed');
            setLoadingMfa(false);
        }
    };

    const handleEnableMfa = async () => {
        setLoadingMfa(true);
        try {
            const { data, error } = await enrollMFA();
            if (error) throw error;

            setMfaData({
                factorId: data.id,
                qrCode: data.totp.qr_code,
                secret: data.totp.secret
            });
        } catch (err) {
            console.error('Error enabling MFA:', err);
            alert('Failed to start MFA enrollment');
        } finally {
            setLoadingMfa(false);
        }
    };

    const handleVerifyMfa = async () => {
        if (!mfaData || !mfaCode) return;
        setLoadingMfa(true);
        try {
            const { error } = await verifyMFA(mfaData.factorId, mfaCode);
            if (error) throw error;

            setIsMfaActive(true);
            setMfaData(null);
            setMfaCode('');
            alert('2FA enabled successfully!');
        } catch (err) {
            console.error('Error verifying MFA:', err);
            alert('Verification failed: Incorrect code');
        } finally {
            setLoadingMfa(false);
        }
    };

    const handleTestTelegram = async () => {
        if (!userSettings.telegram_user_id) {
            alert('Please enter a Telegram User ID first');
            return;
        }

        try {
            const res = await apiFetch('/api/test-telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramUserId: userSettings.telegram_user_id })
            });

            const data = await res.json();
            if (data.success) {
                alert('Test message sent! Check your Telegram.');
            } else {
                alert('Failed to send test message: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error sending test message:', error);
            alert('Error sending test message');
        }
    };

    const handleDisableMfa = async () => {
        if (!confirm('Are you sure you want to disable 2FA? This will reduce your account security.')) return;

        try {
            const { data, error: factorsError } = await supabase.auth.mfa.listFactors();
            if (factorsError) throw factorsError;

            const factor = data.all.find(f => f.status === 'verified');
            if (!factor) return;

            const { error } = await unenrollMFA(factor.id);
            if (error) throw error;

            setIsMfaActive(false);
            alert('2FA disabled');
        } catch (err) {
            console.error('Error disabling MFA:', err);
            alert('Failed to disable 2FA');
        }
    };
    const handleSaveProfile = async () => {
        if (!profileForm.name.trim()) {
            alert('Profile name is required');
            return;
        }

        const newProfile = {
            id: editingProfile?.id || `profile-${Date.now()}`,
            ...profileForm
        };

        console.log('[Save Profile] caption_preset_id:', profileForm.caption_preset_id);
        console.log('[Save Profile] Full profile:', newProfile);

        let updatedProfiles;
        if (editingProfile) {
            updatedProfiles = profiles.map(p => p.id === editingProfile.id ? newProfile : p);
        } else {
            updatedProfiles = [...profiles, newProfile];
        }

        try {
            const response = await apiFetch('/api/save-channel-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, profiles: updatedProfiles })
            });
            if (!response.ok) throw new Error('Failed to save profile');
            await loadProfiles();
            setShowProfileDialog(false);
        } catch (err) {
            console.error('Failed to save profile:', err);
            alert('Failed to save profile');
        }
    };

    const handleDeleteProfile = async (id: string) => {
        if (!confirm('Are you sure you want to delete this profile?')) return;

        const updatedProfiles = profiles.filter(p => p.id !== id);
        try {
            const response = await apiFetch('/api/save-channel-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, profiles: updatedProfiles })
            });
            if (!response.ok) throw new Error('Failed to delete profile');
            await loadProfiles();
        } catch (err) {
            console.error('Failed to delete profile:', err);
        }
    };

    if (teamOnly) {
        return (
            <div className="space-y-6">
                <TeamSettings />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <TabsTrigger value="channels">Channel Profiles</TabsTrigger>
                    <TabsTrigger value="api">API & Integrations</TabsTrigger>
                    <TabsTrigger value="aura">Aura</TabsTrigger>
                    <TabsTrigger value="team">Team</TabsTrigger>
                    <TabsTrigger value="profile">User Profile</TabsTrigger>
                </TabsList>

                {/* Channel Profiles Tab */}
                <TabsContent value="channels" className="space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-2">
                                    <Users2 className="w-5 h-5 text-[#F97316]" />
                                    <CardTitle className="text-white">Channel Profiles</CardTitle>
                                </div>
                                <Button
                                    onClick={handleCreateProfile}
                                    className="w-full bg-[#F97316] text-white hover:bg-[#EA580C] sm:w-auto"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Profile
                                </Button>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                Manage your channel profiles for video generation
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading && userId !== 'default' ? (
                                <div className="flex flex-col items-center justify-center p-8 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                                    <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4 animate-pulse">
                                        <Users2 className="w-6 h-6 text-[#F97316]" />
                                    </div>
                                    <h4 className="text-lg font-medium text-white mb-2">Loading Profiles...</h4>
                                </div>
                            ) : profiles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-8 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                                    <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4">
                                        <Users2 className="w-6 h-6 text-[#F97316]" />
                                    </div>
                                    <h4 className="text-lg font-medium text-white mb-2">No Profiles Yet</h4>
                                    <p className="text-sm text-[#B8B9BC] text-center mb-4">
                                        Create your first channel profile to get started.
                                    </p>
                                    <Button
                                        onClick={handleCreateProfile}
                                        className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        Create Profile
                                    </Button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {profiles.map((profile) => (
                                        <div
                                            key={profile.id}
                                            className="p-4 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] hover:border-[#F97316]/50 transition-colors"
                                        >
                                            <div className="flex items-start justify-between gap-3 sm:items-center">
                                                <div className="min-w-0 flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full overflow-hidden border border-[#3A3A3A] bg-[#3A3A3A] flex items-center justify-center">
                                                        {profile.image_url ? (
                                                            <img
                                                                src={profile.image_url}
                                                                alt={profile.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <span className="text-white text-sm font-bold">
                                                                {profile.name.charAt(0).toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-white">
                                                            {profile.nickname
                                                                ? `${profile.nickname} (${profile.name})`
                                                                : profile.name}
                                                        </p>
                                                        <p className="text-xs text-[#B8B9BC]">
                                                            {profile.caption_preset_name ? `${profile.caption_preset_name} • ` : ''}{profile.font} • {profile.style || 'single'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEditProfile(profile)}
                                                        className="hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-white"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDeleteProfile(profile.id)}
                                                        className="hover:bg-[#3A3A3A] text-[#B8B9BC] hover:text-red-400"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Profile Dialog */}
                    {showProfileDialog && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
                            <Card className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto border-[#3A3A3A] bg-[#2A2A2A] sm:max-h-[90vh]">
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-white">
                                            {editingProfile ? 'Edit Profile' : 'Create Profile'}
                                        </CardTitle>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setShowProfileDialog(false)}
                                            className="text-[#B8B9BC] hover:text-white"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Image Upload Dropzone */}
                                    <div className="space-y-2">
                                        <Label className="text-white">Profile Image</Label>
                                        <div
                                            onDrop={handleDrop}
                                            onDragOver={(e) => e.preventDefault()}
                                            onClick={() => document.getElementById('image-upload')?.click()}
                                            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${uploadingImage
                                                ? 'border-[#F97316] bg-[#F97316]/10'
                                                : 'border-[#3A3A3A] hover:border-[#F97316]/50 bg-[#1A1A1A]'
                                                }`}
                                        >
                                            {profileForm.image_url ? (
                                                <div className="flex flex-col items-center">
                                                    <img
                                                        src={profileForm.image_url}
                                                        alt="Preview"
                                                        className="w-16 h-16 rounded-full object-cover mb-2"
                                                    />
                                                    <p className="text-sm text-[#B8B9BC]">Click or drop to change</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <Upload className={`w-8 h-8 mb-2 ${uploadingImage ? 'text-[#F97316] animate-pulse' : 'text-[#B8B9BC]'}`} />
                                                    <p className="text-sm text-[#B8B9BC]">
                                                        {uploadingImage ? 'Uploading...' : 'Drop an image or click to upload'}
                                                    </p>
                                                </div>
                                            )}
                                            <input
                                                id="image-upload"
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleImageUpload(file);
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="text-white">Name *</Label>
                                            <Input
                                                value={profileForm.name}
                                                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                                                placeholder="Channel Name"
                                                className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-white">Nickname</Label>
                                            <Input
                                                value={profileForm.nickname}
                                                onChange={(e) => setProfileForm({ ...profileForm, nickname: e.target.value })}
                                                placeholder="Display Name"
                                                className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-white">Background Clip Type</Label>
                                        <Select
                                            value={profileForm.background_video_type}
                                            onValueChange={(v) => setProfileForm({ ...profileForm, background_video_type: v })}
                                        >
                                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                <SelectItem value="cooking" className="text-white">Cooking</SelectItem>
                                                <SelectItem value="satisfying" className="text-white">Satisfying</SelectItem>
                                                <SelectItem value="zesh-satisfying" className="text-white">V2 Satisfying</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-white">Visual Filter (Enhancement)</Label>
                                        <Select
                                            value={profileForm.visual_filter_preset_id || 'none'}
                                            onValueChange={(v) => {
                                                const val = v === 'none' ? null : v;
                                                setProfileForm({ ...profileForm, visual_filter_preset_id: val });
                                            }}
                                        >
                                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                <SelectValue placeholder="Standard (None)" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                <SelectItem value="none" className="text-white italic text-gray-400">Standard (None)</SelectItem>
                                                {visualFilterPresets.map((preset) => (
                                                    <SelectItem key={preset.id} value={preset.id} className="text-white">
                                                        {preset.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-[#3A3A3A]">
                                        <div className="space-y-2">
                                            <Label className="text-white">Caption Style</Label>
                                            <Select
                                                value={profileForm.caption_preset_id || 'custom'}
                                                onValueChange={(v) => {
                                                    const val = v === 'custom' ? null : v;
                                                    setProfileForm({ ...profileForm, caption_preset_id: val });
                                                }}
                                            >
                                                <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                    <SelectItem value="custom" className="text-white font-medium italic text-[#F97316]">
                                                        Manual Configuration (Custom)
                                                    </SelectItem>
                                                    {captionPresets.map((preset) => (
                                                        <SelectItem key={preset.id} value={preset.id} className="text-white">
                                                            {preset.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-[#B8B9BC]">
                                                Use a saved visual style or configure manually.
                                            </p>
                                        </div>

                                        {/* Voice Preset Selectors */}
                                        <div className="space-y-4 pt-4 border-t border-[#3A3A3A]">
                                            <h5 className="text-white font-medium">Voice Presets</h5>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label className="text-white">Male Voice Preset</Label>
                                                    <Select
                                                        value={profileForm.male_voice_preset_id || 'none'}
                                                        onValueChange={(v) => {
                                                            const val = v === 'none' ? null : v;
                                                            setProfileForm({ ...profileForm, male_voice_preset_id: val });
                                                        }}
                                                    >
                                                        <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="none" className="text-[#777]">
                                                                None Selected
                                                            </SelectItem>
                                                            {audioPresets
                                                                .filter((p: any) => p.voiceGender === 'male')
                                                                .map((preset: any) => (
                                                                    <SelectItem key={preset.id} value={preset.id} className="text-white">
                                                                        {preset.name}
                                                                    </SelectItem>
                                                                ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-white">Female Voice Preset</Label>
                                                    <Select
                                                        value={profileForm.female_voice_preset_id || 'none'}
                                                        onValueChange={(v) => {
                                                            const val = v === 'none' ? null : v;
                                                            setProfileForm({ ...profileForm, female_voice_preset_id: val });
                                                        }}
                                                    >
                                                        <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                            <SelectItem value="none" className="text-[#777]">
                                                                None Selected
                                                            </SelectItem>
                                                            {audioPresets
                                                                .filter((p: any) => p.voiceGender === 'female')
                                                                .map((preset: any) => (
                                                                    <SelectItem key={preset.id} value={preset.id} className="text-white">
                                                                        {preset.name}
                                                                    </SelectItem>
                                                                ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <p className="text-xs text-[#B8B9BC]">
                                                Assign voice presets by gender for easier content creation.
                                            </p>
                                        </div>

                                        {/* Hook Style Preset Selector */}
                                        <div className="space-y-2 pt-4 border-t border-[#3A3A3A]">
                                            <Label className="text-white">Hook Style Preset</Label>
                                            <Select
                                                value={profileForm.hook_style_preset_id || 'none'}
                                                onValueChange={(v) => {
                                                    const val = v === 'none' ? null : v;
                                                    setProfileForm({ ...profileForm, hook_style_preset_id: val });
                                                }}
                                            >
                                                <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                    <SelectItem value="none" className="text-[#777]">
                                                        Default Style
                                                    </SelectItem>
                                                    {hookStylePresets.map((preset: any) => (
                                                        <SelectItem key={preset.id} value={preset.id} className="text-white">
                                                            {preset.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-[#B8B9BC]">
                                                Choose a custom hook card appearance or use the default style.
                                            </p>
                                        </div>

                                        {/* Manual Configuration Fields - Only show if 'custom' */}
                                        {!profileForm.caption_preset_id && (
                                            <div className="space-y-4 pl-4 border-l-2 border-[#3A3A3A] animate-in fade-in slide-in-from-top-2">
                                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label className="text-white">Font</Label>
                                                        <Select
                                                            value={profileForm.font}
                                                            onValueChange={(v) => setProfileForm({ ...profileForm, font: v })}
                                                        >
                                                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
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
                                                            value={profileForm.style}
                                                            onValueChange={(v) => setProfileForm({ ...profileForm, style: v as 'single' | 'grouped' })}
                                                        >
                                                            <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                                <SelectItem value="single" className="text-white">Single Word</SelectItem>
                                                                <SelectItem value="grouped" className="text-white">Grouped</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label className="text-white">Subtitle Size</Label>
                                                        <Input
                                                            type="number"
                                                            value={profileForm.subtitle_size}
                                                            onChange={(e) => setProfileForm({ ...profileForm, subtitle_size: parseInt(e.target.value) || 64 })}
                                                            className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-white">Stroke Size</Label>
                                                        <Input
                                                            type="number"
                                                            value={profileForm.stroke_size}
                                                            onChange={(e) => setProfileForm({ ...profileForm, stroke_size: parseInt(e.target.value) || 8 })}
                                                            className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                                        />
                                                    </div>
                                                </div>

                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-[#3A3A3A]">
                                        <div className="space-y-2">
                                            <Label className="text-white">Hook Animation</Label>
                                            <Select
                                                value={profileForm.hook_animation_type}
                                                onValueChange={(v) => setProfileForm({ ...profileForm, hook_animation_type: v as 'fall' | 'float' })}
                                            >
                                                <SelectTrigger className="bg-[#1A1A1A] border-[#3A3A3A] text-white">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                                                    <SelectItem value="fall" className="text-white">Falling</SelectItem>
                                                    <SelectItem value="float" className="text-white">Floating</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-[#B8B9BC]">
                                                Choose how captions appear at the start.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-4">
                                        <Button
                                            onClick={handleSaveProfile}
                                            className="flex-1 bg-[#F97316] hover:bg-[#EA580C] text-white"
                                        >
                                            <Save className="w-4 h-4 mr-2" />
                                            Save Profile
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => setShowProfileDialog(false)}
                                            className="border-[#3A3A3A] text-white hover:bg-[#3A3A3A]"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* MFA Challenge Dialog used for AAL2 Upgrade */}
                    {showMfaChallenge && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
                            <Card className="bg-[#2A2A2A] border-[#3A3A3A] w-full max-w-sm">
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-white">Security Check</CardTitle>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { setShowMfaChallenge(false); setMfaCode(''); }}
                                            className="text-[#B8B9BC] hover:text-white"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    <CardDescription className="text-[#B8B9BC]">
                                        Please enter your 2FA code to verify your identity before changing your password.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Input
                                        value={mfaCode}
                                        onChange={(e) => setMfaCode(e.target.value)}
                                        placeholder="000000"
                                        maxLength={6}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white text-center tracking-[0.5em] text-lg font-mono"
                                    />
                                    <Button
                                        onClick={handleChallengeVerify}
                                        disabled={loadingMfa || mfaCode.length !== 6}
                                        className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white"
                                    >
                                        {loadingMfa ? 'Verifying...' : 'Verify'}
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>

                {/* User Profile Tab */}


                {/* API & Integrations Tab */}
                <TabsContent value="api">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Key className="w-5 h-5 text-[#F97316]" />
                                <CardTitle className="text-white">API & Integrations</CardTitle>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                Configure your API keys and integration settings
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="elevenlabs-key" className="text-white">ElevenLabs API Key</Label>
                                    <Input
                                        id="elevenlabs-key"
                                        type="password"
                                        placeholder="Enter your ElevenLabs API key"
                                        value={userSettings.elevenlabs_api_key || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, elevenlabs_api_key: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="fish-audio-key" className="text-white">Fish Audio API Key</Label>
                                    <Input
                                        id="fish-audio-key"
                                        type="password"
                                        placeholder="Enter your Fish Audio API key"
                                        value={userSettings.fish_audio_api_key || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, fish_audio_api_key: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="vibi-key" className="text-white">Vibi API Key</Label>
                                    <Input
                                        id="vibi-key"
                                        type="password"
                                        placeholder="Enter your Vibi API key"
                                        value={userSettings.vibi_api_key || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, vibi_api_key: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                    <p className="text-sm text-gray-400">Cheaper TTS alternative to ElevenLabs.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="groq-key" className="text-white">Groq API Key</Label>
                                    <Input
                                        id="groq-key"
                                        type="password"
                                        placeholder="Enter your Groq API key"
                                        value={userSettings.groq_api_key || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, groq_api_key: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                    <p className="text-sm text-gray-400">Used for caption timings instead of ElevenLabs. Free tier available.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="local-tts-url" className="text-white">Local TTS URL</Label>
                                    <Input
                                        id="local-tts-url"
                                        type="text"
                                        placeholder="http://localhost:3910"
                                        value={userSettings.local_tts_url || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, local_tts_url: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                    <Input
                                        id="local-tts-api-key"
                                        type="password"
                                        placeholder="Local TTS API key (only if your server needs one)"
                                        value={userSettings.local_tts_api_key || ''}
                                        onChange={(e) => setUserSettings({ ...userSettings, local_tts_api_key: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    />
                                    <p className="text-sm text-gray-400">Free voice-cloned TTS and caption timings on your own machine (backend/local-tts/start.sh). Leave blank for localhost:3910.</p>
                                </div>
                                <div className="space-y-2 pt-2 border-t border-[#3A3A3A]">
                                    <Label htmlFor="telegram-user-id" className="text-white">Telegram User ID</Label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            id="telegram-user-id"
                                            type="text"
                                            placeholder="Enter your Telegram user ID"
                                            value={userSettings.telegram_user_id || ''}
                                            onChange={(e) => setUserSettings({ ...userSettings, telegram_user_id: e.target.value })}
                                            className="bg-[#1A1A1A] border-[#3A3A3A] text-white flex-1"
                                        />
                                        <Button
                                            variant="outline"
                                            onClick={handleTestTelegram}
                                            disabled={!userSettings.telegram_user_id}
                                            className="border-[#3A3A3A] text-white hover:bg-[#3A3A3A] hover:text-[#F97316] transition-colors"
                                            title="Send Test Notification"
                                        >
                                            <Bell className="w-4 h-4" />
                                            <span className="sr-only sm:not-sr-only sm:ml-2">Test</span>
                                        </Button>
                                    </div>
                                    <p className="text-xs text-[#B8B9BC]">
                                        Message @userinfobot on Telegram to get your user ID
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <Button
                                    onClick={saveUserSettings}
                                    disabled={saving}
                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                >
                                    <Save className="w-4 h-4 mr-2" />
                                    {saving ? 'Saving...' : 'Save Settings'}
                                </Button>
                                {saved && (
                                    <span className="flex items-center gap-1 text-green-500 text-sm">
                                        <CheckCircle2 className="w-4 h-4" />
                                        Saved successfully!
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Aura Tab */}
                <TabsContent value="aura">
                    <AuraChannelSettings />
                </TabsContent>

                {/* Team Tab */}
                <TabsContent value="team">
                    <TeamSettings />
                </TabsContent>

                {/* User Profile Tab */}
                <TabsContent value="profile">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Users2 className="w-5 h-5 text-[#F97316]" />
                                <CardTitle className="text-white">User Profile</CardTitle>
                            </div>
                            <CardDescription className="text-[#B8B9BC]">
                                Manage your account settings and security
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email" className="text-white">Email Address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={profileSettings.email}
                                        onChange={(e) => setProfileSettings({ ...profileSettings, email: e.target.value })}
                                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                        disabled
                                    />
                                    <p className="text-xs text-[#B8B9BC]">Email cannot be changed currently</p>
                                </div>

                                <div className="pt-4 border-t border-[#3A3A3A] space-y-4">
                                    <h4 className="text-white font-medium">Change Password</h4>
                                    <div className="space-y-2">
                                        <Label htmlFor="current-password" className="text-white">Current Password</Label>
                                        <Input
                                            id="current-password"
                                            type="password"
                                            placeholder="Enter current password"
                                            value={profileSettings.currentPassword}
                                            onChange={(e) => setProfileSettings({ ...profileSettings, currentPassword: e.target.value })}
                                            className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                        />
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="new-password" className="text-white">New Password</Label>
                                            <Input
                                                id="new-password"
                                                type="password"
                                                placeholder="Enter new password"
                                                value={profileSettings.newPassword}
                                                onChange={(e) => setProfileSettings({ ...profileSettings, newPassword: e.target.value })}
                                                className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="confirm-password" className="text-white">Confirm Password</Label>
                                            <Input
                                                id="confirm-password"
                                                type="password"
                                                placeholder="Confirm new password"
                                                value={profileSettings.confirmPassword}
                                                onChange={(e) => setProfileSettings({ ...profileSettings, confirmPassword: e.target.value })}
                                                className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        onClick={handleUpdatePassword}
                                        disabled={saving}
                                        className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                    >
                                        {saving ? 'Updating...' : 'Update Password'}
                                    </Button>
                                </div>

                                <div className="pt-4 border-t border-[#3A3A3A] space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-white">Two-Factor Authentication (2FA)</Label>
                                            <p className="text-xs text-[#B8B9BC]">Add an extra layer of security to your account</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isMfaActive ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleDisableMfa}
                                                    className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                                                >
                                                    Disable 2FA
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    onClick={handleEnableMfa}
                                                    disabled={loadingMfa || !!mfaData}
                                                    className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                                >
                                                    {loadingMfa ? 'Loading...' : 'Enable 2FA'}
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {mfaData && (
                                        <div className="p-4 bg-[#1A1A1A] rounded-lg border border-[#F97316]/30 space-y-4">
                                            <div className="text-center space-y-2">
                                                <p className="text-sm text-white font-medium">Scan this QR code with your authenticator app</p>
                                                <div className="inline-block p-2 bg-white rounded-lg">
                                                    <img src={mfaData.qrCode} alt="MFA QR Code" className="w-48 h-48" />
                                                </div>
                                                <p className="text-xs text-[#B8B9BC]">Manual code: <code className="text-[#F97316]">{mfaData.secret}</code></p>
                                            </div>

                                            <div className="space-y-2">
                                                <Label className="text-white text-sm">Enter 6-digit verification code</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        value={mfaCode}
                                                        onChange={(e) => setMfaCode(e.target.value)}
                                                        placeholder="000000"
                                                        maxLength={6}
                                                        className="bg-[#2A2A2A] border-[#3A3A3A] text-white text-center tracking-[0.5em] text-lg font-mono"
                                                    />
                                                    <Button
                                                        onClick={handleVerifyMfa}
                                                        disabled={loadingMfa || mfaCode.length !== 6}
                                                        className="bg-[#F97316] hover:bg-[#EA580C] text-white"
                                                    >
                                                        Verify
                                                    </Button>
                                                </div>
                                            </div>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setMfaData(null)}
                                                className="w-full text-[#B8B9BC] hover:text-white"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
