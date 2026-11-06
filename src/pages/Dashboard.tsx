import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, TrendingUp, PlayCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/lib/api';

interface DashboardStats {
    totalVideos: number;
    videosThisWeek: number;
    totalDuration: number;
}

interface RecentVideo {
    id: string;
    title: string;
    thumbnail_url: string;
    duration: number;
    created_at?: string;
    createdAt?: string;
}



export default function Dashboard() {
    const { user } = useAuth();
    const [stats, setStats] = useState<DashboardStats>({
        totalVideos: 0,
        videosThisWeek: 0,
        totalDuration: 0,
    });
    const [recentVideos, setRecentVideos] = useState<RecentVideo[]>([]);

    useEffect(() => {
        if (!user?.id) return;

        // Fetch stats
        apiFetch(`/api/stats?userId=${user.id}`)
            .then(res => res.json())
            .then(data => setStats(data))
            .catch(err => console.error('Failed to fetch stats:', err));

        // Fetch recent videos
        apiFetch(`/api/videos?userId=${user.id}`)
            .then(res => res.json())
            .then((data: RecentVideo[]) => {
                // Helper to get date from either field
                const getDate = (v: RecentVideo) => v.created_at || v.createdAt || '';

                // Get only the 5 most recent videos
                const sorted = data.sort((a, b) =>
                    new Date(getDate(b)).getTime() - new Date(getDate(a)).getTime()
                );
                setRecentVideos(sorted.slice(0, 5));
            })
            .catch(err => console.error('Failed to fetch videos:', err));
    }, [user?.id]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="space-y-4">
            {/* Hero Section with Main Action */}
            <div className="flex flex-col gap-4 lg:flex-row">
                <Card className="border-[#3A3A3A] bg-[#2A2A2A] lg:flex-1">
                    <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-3xl font-bold text-white mb-2">
                                    {stats.totalVideos} Videos
                                </h2>
                                <p className="text-[#B8B9BC] mb-6">Ready to create more?</p>
                                <Button asChild className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    <Link to="/generate">
                                        Generate Video
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid w-full grid-cols-2 gap-3 lg:w-72 lg:grid-cols-1 lg:gap-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardContent className="flex min-h-24 items-center py-4 sm:py-5">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#F97316]/10">
                                    <TrendingUp className="h-5 w-5 text-[#F97316]" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-2xl font-bold leading-none text-white">{stats.videosThisWeek}</div>
                                    <p className="mt-1.5 text-sm leading-none text-[#B8B9BC]">Videos this week</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardContent className="flex min-h-24 items-center py-4 sm:py-5">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#F97316]/10">
                                    <PlayCircle className="h-5 w-5 text-[#F97316]" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-2xl font-bold leading-none text-white">{Math.floor(stats.totalDuration / 60)}m</div>
                                    <p className="mt-1.5 text-sm leading-none text-[#B8B9BC]">Total duration</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Left Column - Wider */}
                <div className="space-y-4 lg:col-span-2">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 sm:p-6">
                            <CardTitle className="text-white">Recent Videos</CardTitle>
                            <Button asChild variant="ghost" size="sm" className="text-[#F97316] hover:text-[#EA580C] hover:bg-transparent">
                                <Link to="/library">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {recentVideos.length > 0 ? (
                                <div className="space-y-3">
                                    {recentVideos.map((video) => (
                                        <div key={video.id} className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-[#3A3A3A]/50 sm:p-2">
                                            <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded bg-[#1A1A1A] sm:w-20">
                                                {video.thumbnail_url ? (
                                                    <img
                                                        src={video.thumbnail_url}
                                                        alt={video.title}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Video className="h-5 w-5 text-[#666]" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white font-medium truncate">
                                                    {video.title || 'Untitled Video'}
                                                </p>
                                                <p className="text-xs text-[#B8B9BC]">
                                                    {formatDuration(video.duration || 0)} • {formatTimeAgo(video.created_at || video.createdAt || '')}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-12 text-center text-base leading-relaxed text-[#B8B9BC] sm:py-16">
                                    No videos yet. Start by generating your first video!
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column - Sidebar */}
                <div className="space-y-4">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <CardTitle className="text-white text-base">Quick Links</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button asChild variant="outline" size="sm" className="w-full justify-start border-[#3A3A3A] bg-transparent hover:bg-[#3A3A3A] text-white">
                                <Link to="/presets">
                                    <Video className="mr-2 h-4 w-4" />
                                    Presets
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm" className="w-full justify-start border-[#3A3A3A] bg-transparent hover:bg-[#3A3A3A] text-white">
                                <Link to="/library">
                                    <PlayCircle className="mr-2 h-4 w-4" />
                                    Library
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>

                </div>
            </div>
        </div>
    );
}

