import type { CaptionAnimation } from '@/lib/videoStyles';

export interface ChannelProfile {
    id: string;
    name: string;
    nickname?: string;
    image_url: string | null;
    font: string;
    font_url?: string;
    voice_id?: string;
    style?: 'single' | 'grouped';
    background_video_type?: string;
    hook_animation_type?: 'fall' | 'float';
    pitch_up?: boolean;
    subtitle_size?: number;
    stroke_size?: number;
    audio_speed?: number;
    platform?: string;
    language?: string;
    caption_preset_id?: string | null;
    caption_preset_name?: string | null;
    caption_animation_type?: CaptionAnimation;
    caption_color?: string;
    rainbow_text?: boolean;
    male_voice_preset_id?: string | null;
    female_voice_preset_id?: string | null;
    hook_style_preset_id?: string | null;
    visual_filter_preset_id?: string | null;
    created_at?: string;
    updated_at?: string;
}

