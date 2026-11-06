import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch, apiUrl, readJson } from '@/lib/api';
import { ROLE_INFO, type TeamRole } from '@/types/scripts';

interface InvitePreview {
    email: string;
    role: TeamRole;
    owner_email: string | null;
}

/** /join?token=… — the link an owner shares from Settings → Team. */
export default function Join() {
    const [params] = useSearchParams();
    const token = params.get('token') || '';
    const { user, loading: authLoading, signOut } = useAuth();
    const navigate = useNavigate();
    const [invite, setInvite] = useState<InvitePreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch(apiUrl(`/api/team-invites/${encodeURIComponent(token)}`))
            .then(async response => {
                const body = await readJson(response);
                if (!response.ok) throw new Error(body.error || 'Invite not found');
                setInvite(body.invite);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [token]);

    const accept = async () => {
        setAccepting(true);
        setError(null);
        try {
            const response = await apiFetch(`/api/team/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
            const body = await readJson(response);
            if (!response.ok) throw new Error(body.error || 'Could not accept invite');
            try { localStorage.setItem('rddtfun_scripts_workspace', body.member.owner_id); } catch { /* private mode */ }
            navigate('/scripts');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not accept invite');
        } finally {
            setAccepting(false);
        }
    };

    const next = `/join?token=${encodeURIComponent(token)}`;
    const wrongAccount = user && invite && user.email?.toLowerCase() !== invite.email;

    return (
        <div className="flex min-h-dvh items-center justify-center bg-[#222222] p-4 sm:p-6">
            <div className="w-full max-w-md">
                <div className="mb-8 flex items-center justify-center gap-3">
                    <img src="/getbrainrot-logo.png" alt="Get Brainrot" className="h-12 w-12 object-contain" />
                    <img src="/brainrot-wordmark.png" alt="Brainrot" className="h-9 w-auto max-w-[180px] object-contain" />
                </div>
                <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <CardHeader>
                        <CardTitle className="text-2xl text-white">Join a team</CardTitle>
                        {invite && (
                            <CardDescription className="text-[#B8B9BC]">
                                {invite.owner_email || 'An owner'} invited <span className="text-white">{invite.email}</span> as{' '}
                                <span className="text-white">{ROLE_INFO[invite.role].label}</span>: {ROLE_INFO[invite.role].description.toLowerCase()}.
                            </CardDescription>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {(loading || authLoading) && <div className="flex items-center gap-2 text-[#B8B9BC]"><Loader2 className="h-4 w-4 animate-spin" /> Checking invite…</div>}
                        {error && <div className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>}
                        {invite && !authLoading && (user ? (
                            wrongAccount ? (
                                <>
                                    <p className="text-sm text-[#B8B9BC]">You're signed in as {user.email}. Sign in as {invite.email} to accept.</p>
                                    <Button onClick={() => signOut()} className="w-full bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]">Sign out</Button>
                                </>
                            ) : (
                                <Button onClick={accept} disabled={accepting} className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    {accepting ? 'Joining…' : 'Accept invite'}
                                </Button>
                            )
                        ) : (
                            <>
                                <Button asChild className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white">
                                    <Link to={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`}>Create an account</Link>
                                </Button>
                                <Button asChild variant="ghost" className="w-full text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white">
                                    <Link to={`/login?next=${encodeURIComponent(next)}`}>I already have an account</Link>
                                </Button>
                            </>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
