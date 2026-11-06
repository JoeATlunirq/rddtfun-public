import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import type { AuraChannel } from '@/types/aura';

export default function AuraChannelSettings() {
    const [channels, setChannels] = useState<AuraChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [handle, setHandle] = useState('');
    const [adding, setAdding] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const response = await apiFetch('/api/aura/channels');
                const body = await response.json();
                if (!response.ok) throw new Error(body.error || 'Failed to load Aura channels');
                setChannels(body.channels || []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load Aura channels');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const addChannel = async (e: FormEvent) => {
        e.preventDefault();
        if (!handle.trim()) return;
        setAdding(true);
        setError(null);
        try {
            const response = await apiFetch('/api/aura/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ handle: handle.trim() }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Failed to add channel');
            setChannels(body.channels || []);
            setHandle('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add channel');
        } finally {
            setAdding(false);
        }
    };

    const removeChannel = async (channelId: string) => {
        setRemovingId(channelId);
        setError(null);
        try {
            const response = await apiFetch(`/api/aura/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Failed to remove channel');
            setChannels(body.channels || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove channel');
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#F97316]" />
                    <CardTitle className="text-white">Aura Rank</CardTitle>
                </div>
                <CardDescription className="text-[#B8B9BC]">
                    YouTube channels ranked on the <Link to="/aura" className="text-[#F97316] hover:underline">Aura</Link> page by views gained.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={addChannel} className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        aria-label="YouTube handle"
                        placeholder="@handle, channel ID, or channel URL"
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        disabled={adding}
                        className="bg-[#1A1A1A] border-[#3A3A3A] text-white flex-1"
                    />
                    <Button type="submit" disabled={adding || !handle.trim()} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {adding ? 'Adding...' : 'Add'}
                    </Button>
                </form>
                {error && <p className="text-sm text-red-400">{error}</p>}

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-[#B8B9BC]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading channels...
                    </div>
                ) : channels.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[#3A3A3A] bg-[#1A1A1A] p-4 text-center text-sm text-[#B8B9BC]">
                        No channels yet. Add an @handle to start your rank.
                    </p>
                ) : (
                    <ul className="divide-y divide-[#3A3A3A] rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]">
                        {channels.map(channel => (
                            <li key={channel.channelId} className="flex items-center gap-3 px-3 py-2.5">
                                {channel.thumbnailUrl ? (
                                    <img src={channel.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                                ) : (
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-sm font-semibold text-[#F97316]">
                                        {(channel.title || channel.handle).replace('@', '').charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white">{channel.title}</div>
                                    <div className="truncate text-xs text-[#8A8B8F]">{channel.handle}</div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeChannel(channel.channelId)}
                                    disabled={removingId === channel.channelId}
                                    className="text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400"
                                    aria-label={`Remove ${channel.handle}`}
                                >
                                    {removingId === channel.channelId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-xs text-[#8A8B8F]">{channels.length} / 50 channels · changes save immediately</p>
            </CardContent>
        </Card>
    );
}
