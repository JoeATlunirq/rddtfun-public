import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FPS = 30;
// Default (portrait short) frame size; landscape long-form uses frameSize('landscape')
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FORMATS = {
    portrait: { width: 1080, height: 1920 },
    landscape: { width: 1920, height: 1080 },
};
export const frameSize = format => FORMATS[format] || FORMATS.portrait;

export const BACKEND_DIR = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(BACKEND_DIR, 'public');
export const CACHE_DIR = process.env.RENDER_CACHE_DIR || path.join(BACKEND_DIR, '.render-cache');

// Public asset bucket used by the previous Remotion compositions (fonts, hook assets)
export const ASSET_BASE_URL = 'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com';
const GOOGLE_FONTS_BASE = 'https://raw.githubusercontent.com/google/fonts/main';

export const FONT_FILES = {
    'Roboto': 'Fonts/Roboto.woff2',
    'Montserrat': 'Fonts/Montserrat.woff2',
    'Fredoka': 'Fonts/Fredoka.woff2',
    'Komika Axis': 'Fonts/Roboto.woff2',
    'Lilita One': 'Fonts/LilitaOne.woff2',
    'Jellee': 'Fonts/Jellee-Roman.ttf',
    'Ubuntu': 'Fonts/Ubuntu.woff2',
    // Heavy static cuts used by the big Reddit story channels (downloaded once into the render cache)
    'Luckiest Guy': `${GOOGLE_FONTS_BASE}/apache/luckiestguy/LuckiestGuy-Regular.ttf`,
    'Poppins Black': `${GOOGLE_FONTS_BASE}/ofl/poppins/Poppins-Black.ttf`,
    'Poppins ExtraBold': `${GOOGLE_FONTS_BASE}/ofl/poppins/Poppins-ExtraBold.ttf`,
    'Ubuntu Bold': `${GOOGLE_FONTS_BASE}/ufl/ubuntu/Ubuntu-Bold.ttf`,
    'Anton': `${GOOGLE_FONTS_BASE}/ofl/anton/Anton-Regular.ttf`,
    'Bangers': `${GOOGLE_FONTS_BASE}/ofl/bangers/Bangers-Regular.ttf`,
    // CapCut caption favourites (closest open-licence matches)
    'Archivo Black': `${GOOGLE_FONTS_BASE}/ofl/archivoblack/ArchivoBlack-Regular.ttf`,
    'Bebas Neue': `${GOOGLE_FONTS_BASE}/ofl/bebasneue/BebasNeue-Regular.ttf`,
    'Titan One': `${GOOGLE_FONTS_BASE}/ofl/titanone/TitanOne-Regular.ttf`,
    'Paytone One': `${GOOGLE_FONTS_BASE}/ofl/paytoneone/PaytoneOne-Regular.ttf`,
    'Russo One': `${GOOGLE_FONTS_BASE}/ofl/russoone/RussoOne-Regular.ttf`,
    // Thumbnail title face: the heavy neutral sans QuokkaReads-style thumbnails use (OFL)
    'Inter ExtraBold': 'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-ExtraBold.woff2',
};
export const DEFAULT_FONT_FILE = 'Fonts/Roboto-Bold.ttf';

// Fonts whose files are already a heavy weight: no faux-bold dilation on top
export const NATIVE_BOLD_FONTS = new Set([
    'Luckiest Guy', 'Poppins Black', 'Poppins ExtraBold', 'Ubuntu Bold', 'Anton', 'Bangers',
    'Archivo Black', 'Bebas Neue', 'Titan One', 'Paytone One', 'Russo One', 'Inter ExtraBold',
]);

export const BADGE_URL = `${ASSET_BASE_URL}/HookAssets/Images/badge.png`;
// Award row on the hook card, in display order (animated and still awards alternate).
// Files live in backend/public/assets/hook-awards and public/hook-awards (built by buildAwards.js).
export const HOOK_AWARDS = [
    { file: '01-shocked-snoo.webm', source: '10' },
    { file: '02-pyramid.webm', source: '8', still: true },
    { file: '03-heart.webm', source: '4' },
    { file: '04-hands.webm', source: '5', still: true },
    { file: '05-popcorn.webm', source: '6' },
    { file: '06-dino.webm', source: '1', still: true },
    { file: '07-seal.webm', source: '9' },
];
export const EMOJI_URLS = HOOK_AWARDS.map(a => `assets/hook-awards/${a.file}`);

// Mirrored + graded look applied to every background clip (from BackgroundVideo.tsx)
export const BACKGROUND_GRADE = 'saturate(1.27) brightness(0.87) contrast(1.14) sepia(0.27)';

// Bump when the prepared-clip pipeline changes so stale cache entries are rebuilt
export const PREPARED_CLIP_VERSION = 1;

// Keyframe interval of prepared clips, in frames. Segment seeking relies on this.
export const PREPARED_GOP = 15;
