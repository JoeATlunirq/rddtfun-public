import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, Download, Calendar, Clock, Loader2, Play, Trash2, MonitorPlay, Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface VideoItem {
    id: string;
    title?: string;
    hook?: string;
    video_url: string;
    thumbnail_url?: string;
    duration?: number;
    createdAt?: string;
    userId?: string;
}

// Long-form jobs save <job>-long.mp4 (16:9) and <job>-short.mp4 (its 9:16 promo short)
const isLong = (v: VideoItem) => /-long\.mp4$/.test(v.video_url || '');
const isPromo = (v: VideoItem) => /-short\.mp4$/.test(v.video_url || '');
type Filter = 'all' | 'long' | 'short';

export default function VideoLibrary() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('all');

    useEffect(() => {
        loadVideos();
    }, [user?.id]);

    const loadVideos = async () => {
        if (!user?.id) return;

        try {
            const response = await apiFetch(`/api/videos?userId=${user.id}`);
            const data = await response.json();
            // Sort by date (newest first) - show all videos
            setVideos(data.sort((a: VideoItem, b: VideoItem) =>
                new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            ));
        } catch (err) {
            console.error('Failed to load videos:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'Unknown date';
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleDownload = (videoUrl: string, title?: string) => {
        const link = document.createElement('a');
        link.href = videoUrl;
        link.download = title ? `${title}.mp4` : 'video.mp4';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDelete = async (videoId: string, title?: string) => {
        if (!user?.id) return;

        const confirmed = window.confirm(`Are you sure you want to delete "${title || 'this video'}"? This action cannot be undone.`);
        if (!confirmed) return;

        setDeletingId(videoId);
        try {
            const response = await apiFetch(`/api/videos/${videoId}?userId=${user.id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete video');
            }

            // Remove from local state
            setVideos(videos.filter(v => v.id !== videoId));
            toast({
                title: 'Video deleted',
                description: 'The video has been removed from your library.'
            });
        } catch (err) {
            console.error('Failed to delete video:', err);
            toast({
                title: 'Delete failed',
                description: err instanceof Error ? err.message : 'Failed to delete video',
                variant: 'destructive'
            });
        } finally {
            setDeletingId(null);
        }
    };


    const longVideos = videos.filter(isLong);
    const shortVideos = videos.filter(v => !isLong(v));

    const renderCard = (video: VideoItem) => {
        const long = isLong(video);
        return (
            <div
                key={video.id}
                className="group overflow-hidden rounded-xl border border-[#3A3A3A] bg-[#1A1A1A] transition-colors hover:border-[#F97316]/50"
            >
                <div className={cn('relative overflow-hidden bg-black', long ? 'aspect-video' : 'aspect-[9/16]')}>
                    {video.thumbnail_url ? (
                        <img
                            src={video.thumbnail_url}
                            alt={video.title || 'Video thumbnail'}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        // #t=1 shows a real frame instead of the black first frame
                        <video
                            src={`${video.video_url}#t=1`}
                            className="h-full w-full object-cover"
                            muted
                            preload="metadata"
                        />
                    )}
                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-100 transition-opacity sm:bg-black/40 sm:opacity-0 sm:group-hover:opacity-100">
                        <a
                            href={video.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F97316] transition-colors hover:bg-[#EA580C]"
                        >
                            <Play className="ml-1 h-5 w-5 text-white" />
                        </a>
                    </div>
                    <div className="absolute left-2 top-2 flex gap-1">
                        {long && <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">Long · 16:9</span>}
                        {isPromo(video) && <span className="rounded bg-[#F97316] px-1.5 py-0.5 text-[10px] font-medium text-white">Promo</span>}
                    </div>
                    {/* Duration badge */}
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                        <Clock className="h-3 w-3" />
                        {formatDuration(video.duration)}
                    </div>
                </div>

                <div className="p-3">
                    <p className={cn('mb-1 font-medium text-white', long ? 'line-clamp-2 text-sm leading-snug' : 'truncate text-sm')} title={video.title || video.hook}>
                        {video.title || video.hook || `Video ${video.id.slice(0, 8)}`}
                    </p>
                    <div className="mb-3 flex items-center gap-1 text-xs text-[#B8B9BC]">
                        <Calendar className="h-3 w-3" />
                        {formatDate(video.createdAt)}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(video.video_url, video.title || video.hook)}
                            className="flex-1 border-[#3A3A3A] text-xs text-white hover:bg-[#3A3A3A]"
                        >
                            <Download className="mr-1 h-3 w-3" />
                            Download
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(video.id, video.title || video.hook)}
                            disabled={deletingId === video.id}
                            className="border-[#3A3A3A] text-xs text-red-400 hover:border-red-500/50 hover:bg-red-500/20"
                        >
                            {deletingId === video.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white">Video Library</h2>
                <p className="text-[#B8B9BC] mt-1">Browse and manage your generated videos</p>
            </div>

            <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Video className="w-5 h-5 text-[#F97316]" />
                        <CardTitle className="text-white">All Videos</CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardDescription className="text-[#B8B9BC]">
                            {loading ? 'Loading...' : `${videos.length} video${videos.length !== 1 ? 's' : ''} in your library`}
                        </CardDescription>
                        {longVideos.length > 0 && (
                            <div className="flex rounded-lg bg-[#1A1A1A] p-0.5 text-xs">
                                {([['all', 'All'], ['long', 'Long videos'], ['short', 'Shorts']] as const).map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setFilter(key)}
                                        className={cn('rounded-md px-2.5 py-1 transition-colors', filter === key ? 'bg-[#3A3A3A] text-white' : 'text-[#777] hover:text-white')}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#F97316] animate-spin mb-4" />
                            <p className="text-[#B8B9BC]">Loading videos...</p>
                        </div>
                    ) : videos.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-8 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A]">
                            <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center mb-4">
                                <Video className="w-6 h-6 text-[#F97316]" />
                            </div>
                            <h4 className="text-lg font-medium text-white mb-2">No Videos Yet</h4>
                            <p className="text-sm text-[#B8B9BC] text-center">
                                Videos you generate will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {longVideos.length > 0 && filter !== 'short' && (
                                <section className="space-y-3">
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                                        <MonitorPlay className="h-4 w-4 text-[#F97316]" /> Long videos
                                        <span className="text-xs font-normal text-[#777]">{longVideos.length}</span>
                                    </h3>
                                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                        {longVideos.map(video => renderCard(video))}
                                    </div>
                                </section>
                            )}
                            {shortVideos.length > 0 && filter !== 'long' && (
                                <section className="space-y-3">
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                                        <Smartphone className="h-4 w-4 text-[#F97316]" /> Shorts
                                        <span className="text-xs font-normal text-[#777]">{shortVideos.length}</span>
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                                        {shortVideos.map(video => renderCard(video))}
                                    </div>
                                </section>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
