// Types for the frontend (src/components/HookPreview.tsx imports this module directly)
export interface HookAnimationState {
    scale: number;
    translateY: number;
    rotation: number;
    blur: number;
    opacity: number;
}

export const PRESET_VARIANTS: string[];
export const AWARD_CYCLE_FRAMES: number;
export const AWARD_LOOP_MIN_FRAMES: number;
export function awardFrameIndex(frame: number, frameCount: number, cycle?: number): number;
export function hookAnimationState(variant: string, frame: number, audioDurationInSeconds: number, fps: number): HookAnimationState;
