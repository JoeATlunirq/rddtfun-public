import { useCurrentFrame, interpolate, Easing, Audio, useVideoConfig, Img, delayRender, continueRender, staticFile, OffthreadVideo } from 'remotion';
import React from 'react';

// S3 Asset Base URL
const S3_BUCKET_URL = 'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com';

// Font file mapping - MATCHING PREVIEW EXACTLY
const fontFilesMap: Record<string, string> = {
    'Roboto': 'Fonts/Roboto.woff2',
    'Montserrat': 'Fonts/Montserrat.woff2',
    'Fredoka': 'Fonts/Fredoka.woff2',
    'Komika Axis': 'Fonts/Roboto.woff2',
    'Lilita One': 'Fonts/LilitaOne.woff2',
    'Jellee': 'Fonts/Jellee-Roman.ttf',
    'Ubuntu': 'Fonts/Ubuntu.woff2',
};

const getS3AssetUrl = (path: string) => {
    return `${S3_BUCKET_URL}/${path}`;
};

interface Props {
    channelName?: string;
    channelImage?: string;
    hookText?: string;
    audioUrl?: string;
    audioDurationInSeconds?: number;
    // Font props
    font?: string;
    fontUrl?: string;
    // Add asset URLs props
    assetUrls?: {
        badge?: string;
        bubble?: string;
        share?: string;
    };
    // Add bucket info props
    bucketName?: string;
    bucketRegion?: string;
    startFrom?: number;
    endAt?: number;
    hookStyle?: {
        titleColor: string;
        backgroundColor: string;
        font: string;
        borderRadius: number;
        hookTopPosition?: boolean;
    } | null;
    isSingleAudioBlock?: boolean;
    hookSplitTime?: number;
}

// Helper function to get asset URL or fallback to S3 asset
const getAssetUrl = (assetUrls: any, key: string, s3Assets: any, fallbackKey: string) => {
    if (assetUrls && assetUrls[key]) {
        return assetUrls[key];
    }
    return s3Assets[fallbackKey];
};

// Helper function to get video URL
const getVideoUrl = (assetUrls: any, index: number, s3Assets: any) => {
    if (assetUrls && assetUrls.videos && assetUrls.videos[`video${index}`]) {
        return assetUrls.videos[`video${index}`];
    }
    return s3Assets.videos[`video${index}`];
};

// VideoComponent - use OffthreadVideo for frame-accurate MP4 rendering
// It handles frame sync natively
const VideoComponent: React.FC<{
    src: string;
    style: React.CSSProperties;
}> = ({ src, style }) => {
    return (
        <OffthreadVideo
            src={src}
            style={style}
            volume={0}
            transparent
        />
    );
};

export const FloatingHookVideo: React.FC<Props> = ({
    // Add hookStyle to props destructuring
    hookStyle, // New prop
    channelImage,
    channelName,
    hookText,
    audioUrl,
    audioDurationInSeconds = 3,
    font: defaultFont = 'Roboto', // Renamed to avoid partial conflict
    fontUrl,
    assetUrls = {},
    bucketName = 'rddtfun',
    bucketRegion = 'us-east-1',
    startFrom,
    endAt,
    isSingleAudioBlock = false,
    hookSplitTime = 0,
}) => {
    console.log(`[Component] FloatingHookVideo: font=${defaultFont}, radius=${hookStyle?.borderRadius}, singleAudio=${isSingleAudioBlock}`);
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    // Determine final font: Hook Style font > Font prop > Default
    const font = hookStyle?.font || defaultFont;

    // Create S3 asset paths
    const s3Assets = React.useMemo(() => ({
        robotoFont: getS3AssetUrl('Fonts/Roboto-Bold.ttf'),
        verificationBadge: getS3AssetUrl('HookAssets/Images/badge.png'),
        bubble: getS3AssetUrl('HookAssets/Images/bubble.svg'),
        share: getS3AssetUrl('HookAssets/Images/share.svg'),
        videos: {
            video1: getS3AssetUrl('HookAssets/VideosTransparentHD/1.webm'),
            video2: getS3AssetUrl('HookAssets/VideosTransparentHD/2.webm'),
            video3: getS3AssetUrl('HookAssets/VideosTransparentHD/3.webm'),
            video4: getS3AssetUrl('HookAssets/VideosTransparentHD/4.webm'),
            video5: getS3AssetUrl('HookAssets/VideosTransparentHD/5.webm'),
            video6: getS3AssetUrl('HookAssets/VideosTransparentHD/6.webm'),
        }
    }), []);

    const [handle] = React.useState(() => delayRender('Loading floating hook font: ' + (hookStyle?.font || font)));

    // Unified font loading matching Preview & Subtitles
    React.useEffect(() => {
        const effectiveFont = hookStyle?.font || font || 'Roboto';
        const fontPath = fontFilesMap[effectiveFont] || 'Fonts/Roboto-Bold.ttf';
        const urlToLoad = fontUrl || `${S3_BUCKET_URL}/${fontPath}`;

        console.log(`[FloatingHook] Loading font: ${effectiveFont} from ${urlToLoad}`);

        const loadFontAsync = async () => {
            try {
                const face = new FontFace(effectiveFont, `url(${urlToLoad})`, { weight: '700' });
                const loaded = await face.load();
                (document.fonts as any).add(loaded);
                console.log(`[FloatingHook] SUCCESS: ${effectiveFont} loaded.`);
                continueRender(handle);
            } catch (e) {
                console.error(`[FloatingHook] FAILED loading ${effectiveFont}:`, e);
                continueRender(handle);
            }
        };

        loadFontAsync();
    }, [font, fontUrl, hookStyle?.font, handle]);

    // Get other asset URLs from S3
    const badgeUrl = getAssetUrl(assetUrls, 'badge', s3Assets, 'verificationBadge');

    // Timing calculations
    // End shrink animation 2 frames before sequence ends to prevent transition glitch
    const audioFrames = Math.ceil(audioDurationInSeconds * fps) - 2;

    const defaultGrowthFrames = 12;
    const defaultShrinkingDuration = 4;

    let growthEndFrame = defaultGrowthFrames;
    let startShrinkingFrame = Math.max(growthEndFrame + 1, audioFrames - defaultShrinkingDuration);

    // 1. Handle overlap
    if (startShrinkingFrame <= growthEndFrame) {
        if (audioFrames > 2) {
            growthEndFrame = Math.floor(audioFrames / 2);
            startShrinkingFrame = growthEndFrame + 1;
        } else {
            growthEndFrame = 0;
            startShrinkingFrame = audioFrames;
        }
    }

    // 2. Ensure startShrinkingFrame < audioFrames
    if (startShrinkingFrame >= audioFrames) {
        startShrinkingFrame = Math.max(0, audioFrames - 1);
    }

    // 3. Ensure growthEndFrame < startShrinkingFrame
    if (growthEndFrame >= startShrinkingFrame) {
        growthEndFrame = Math.max(0, startShrinkingFrame - 1);
    }

    // 4. Ensure growthEndFrame >= 1 if possible
    if (growthEndFrame === 0 && startShrinkingFrame > 1) {
        growthEndFrame = 1;
    }

    // Construct input range
    const scaleInputRange = [0, growthEndFrame, startShrinkingFrame, audioFrames];
    const uniqueScaleInputRange = [...new Set(scaleInputRange)].sort((a, b) => a - b);

    let scale;
    if (uniqueScaleInputRange.length < 3) {
        scale = 1;
    } else {
        // Adjust output range based on number of points
        // [0.7, 1, 1.05, 0]
        let outputRange = [0.7, 1, 1.05, 0];
        if (uniqueScaleInputRange.length === 3) {
            // If we lost one point (e.g. startShrinkingFrame == audioFrames), adjust
            outputRange = [0.7, 1, 0];
        }

        scale = interpolate(
            frame,
            uniqueScaleInputRange,
            outputRange,
            {
                extrapolateRight: 'clamp',
                easing: (t) => {
                    if (frame <= growthEndFrame) {
                        return Easing.bezier(0.8, 0, 0.2, 1)(t);
                    } else if (frame >= startShrinkingFrame) {
                        return Easing.bezier(0.2, 0, 0.8, 1)(t);
                    }
                    return t;
                }
            }
        );
    }

    // Create floating animation (gentle oscillation on Y axis)
    // This will create a smooth up-and-down floating movement during the growth phase
    const floatAmplitude = 15; // Maximum pixels to move up/down
    const floatCyclesPerSecond = 1; // How many full oscillations per second

    const floatOffset = frame >= growthEndFrame && frame < startShrinkingFrame
        ? floatAmplitude * Math.sin(
            (frame - growthEndFrame) *
            ((2 * Math.PI * floatCyclesPerSecond) / fps)
        )
        : 0;

    // Dynamic rotation that oscillates with vertical movement
    const rotationAmplitude = 0.75; // Maximum degrees to rotate
    const rotation = frame >= growthEndFrame && frame < startShrinkingFrame
        ? rotationAmplitude * Math.sin(
            (frame - growthEndFrame) *
            ((2 * Math.PI * floatCyclesPerSecond) / fps)
        )
        : 0;

    // Dynamic blur only at the end when shrinking
    // Ensure strict monotonicity
    const blurInputRange = [startShrinkingFrame, audioFrames];
    const uniqueBlurInputRange = [...new Set(blurInputRange)].sort((a, b) => a - b);

    const blurAmount = (frame >= startShrinkingFrame && uniqueBlurInputRange.length >= 2)
        ? interpolate(
            frame,
            uniqueBlurInputRange,
            [0, 3],
            {
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.2, 0, 0.8, 1)
            }
        )
        : 0;

    const containerStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: hookStyle?.hookTopPosition ? 'flex-start' : 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        paddingTop: hookStyle?.hookTopPosition ? '288px' : '0', // ~15% from top of 1920px frame
        zIndex: 10, // Ensure hook is above captions
    };

    const cardStyle: React.CSSProperties = {
        width: 800,
        minHeight: 275,
        borderRadius: `${hookStyle?.borderRadius ?? 50}px`,
        backgroundColor: hookStyle?.backgroundColor || '#ffffff',
        transform: `
      translateY(${floatOffset}px)
      rotate(${rotation}deg)
      scale(${scale})
    `,
        filter: `blur(${blurAmount}px)`,
        position: 'relative',
        padding: '10px 15px',
        overflow: 'hidden',
        border: hookStyle ? `1px solid ${hookStyle.titleColor}44` : '1px solid #000000', // Use faint title color for border if styled
        boxShadow: '10px 10px 10px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
    };

    const headerStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '15px',
    };

    const titleContainerStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        marginTop: '10px',
    };

    const channelNameStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
    };

    const gifContainerStyle: React.CSSProperties = {
        display: 'flex',
        gap: '0px',
        alignItems: 'center',
        marginTop: '-5px',
    };

    const gifStyle: React.CSSProperties = {
        height: '60px',
        width: 'auto',
        objectFit: 'contain',
    };

    const profileImageStyle: React.CSSProperties = {
        width: '116px',
        height: '116px',
        borderRadius: '50%',
        backgroundColor: channelImage ? 'transparent' : '#FF4500',
        backgroundImage: channelImage ? `url(${channelImage})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        flexShrink: 0,
        border: hookStyle ? `2px solid ${hookStyle.titleColor}22` : 'none', // Optional ring
    };

    const titleStyle: React.CSSProperties = {
        fontSize: '40px',
        fontWeight: 700,
        color: hookStyle?.titleColor || '#1a1a1a',
        margin: 0,
        fontFamily: `"${hookStyle?.font || font}", sans-serif`,
    };

    const postTitleStyle: React.CSSProperties = {
        fontSize: '45px',
        fontWeight: 700,
        color: hookStyle?.titleColor || '#1a1a1a',
        margin: '3px 0 0 6px',
        fontFamily: `"${hookStyle?.font || font}", sans-serif`,
        width: '95%',
        lineHeight: '0.9',
        flex: '1',
        overflow: 'visible',
    };

    const badgeStyle: React.CSSProperties = {
        height: '40px',
        width: 'auto',
        objectFit: 'contain',
    };

    const heartContainerStyle: React.CSSProperties = {
        position: 'relative',
        marginTop: 'auto',
        paddingTop: '10px',
        bottom: '10px',
        left: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    };

    const iconContainerStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
    };

    const iconGroupStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    };

    const heartIconStyle: React.CSSProperties = {
        height: '40px',
        width: '40px',
        stroke: hookStyle?.titleColor ? `${hookStyle.titleColor}88` : '#888888',
        strokeWidth: '2',
        fill: 'none',
    };

    const bubbleIconStyle: React.CSSProperties = {
        height: '40px',
        width: '40px',
        fill: hookStyle?.titleColor ? `${hookStyle.titleColor}88` : '#888888',
    };

    const shareIconStyle: React.CSSProperties = {
        height: '40px',
        width: '40px',
        fill: 'none',
        stroke: hookStyle?.titleColor ? `${hookStyle.titleColor}88` : '#888888',
        strokeWidth: 1.5,
    };

    const counterStyle: React.CSSProperties = {
        fontSize: '28px',
        fontFamily: hookStyle?.font || font,
        color: hookStyle?.titleColor ? `${hookStyle.titleColor}88` : '#888888',
        fontWeight: '500',
    };

    const shareTextStyle: React.CSSProperties = {
        fontSize: '28px',
        fontFamily: hookStyle?.font || font,
        color: hookStyle?.titleColor ? `${hookStyle.titleColor}88` : '#888888',
        fontWeight: '500',
    };

    const shareContainerStyle: React.CSSProperties = {
        position: 'relative',
        marginTop: 'auto',
        paddingTop: '10px',
        bottom: '10px',
        right: '100px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginLeft: 'auto',
    };

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={headerStyle}>
                    <div style={profileImageStyle} />
                    <div style={titleContainerStyle}>
                        <div style={channelNameStyle}>
                            <h1 style={titleStyle}>{channelName}</h1>
                            <Img src={badgeUrl} style={badgeStyle} alt="Verified" />
                        </div>
                        <div style={gifContainerStyle}>
                            {[1, 2, 3, 4, 5, 6].map(idx => (
                                <VideoComponent
                                    key={idx}
                                    src={getVideoUrl(assetUrls, idx, s3Assets)}
                                    style={gifStyle}
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <h2 style={postTitleStyle}>
                    {hookText}
                </h2>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '10px' }}>
                    <div style={heartContainerStyle}>
                        <div style={iconContainerStyle}>
                            <div style={iconGroupStyle}>
                                <svg
                                    viewBox="0 0 24 24"
                                    style={heartIconStyle}
                                >
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                </svg>
                                <span style={counterStyle}>99+</span>
                            </div>
                            <div style={iconGroupStyle}>
                                <svg viewBox="0 0 67.429 67.429" style={bubbleIconStyle}>
                                    <path d="M33.468 67.184C15.014 67.184 0 52.17 0 33.715S15.014.246 33.468.246c18.455 0 33.469 15.014 33.469 33.469 0 5.621-1.421 11.161-4.116 16.076l4.608 17.2-16.849-4.516c-5.172 3.084-11.069 4.709-17.112 4.709zm0-62.938C17.219 4.246 4 17.466 4 33.715s13.219 29.469 29.468 29.469c5.582 0 11.021-1.574 15.729-4.554l.74-.468 11.835 3.171-3.243-12.1.419-.72c2.609-4.484 3.988-9.602 3.988-14.799 0-16.248-13.219-29.468-29.468-29.468z" />
                                </svg>
                                <span style={counterStyle}>99+</span>
                            </div>
                        </div>
                    </div>
                    <div style={shareContainerStyle}>
                        <div style={iconGroupStyle}>
                            <svg viewBox="0 0 24 24" style={shareIconStyle}>
                                <path d="M20 13v4.5c0 3.0577-4 3-8 3s-8 .0577-8-3V13M12 3v12M12 3l4 4M12 3 8 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span style={shareTextStyle}>Share</span>
                        </div>
                    </div>
                </div>
            </div>
            {audioUrl && <Audio src={audioUrl} startFrom={startFrom} endAt={endAt} />}
        </div>
    );
};
