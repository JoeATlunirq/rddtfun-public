import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Loader2, LogOut, Trash2, UserPlus, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch, readJson } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ASSIGNABLE_ROLES, ROLE_INFO, inviteLink, type TeamMember, type TeamRole, type Workspace } from '@/types/scripts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(path, init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init);
    const body = await readJson(response);
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
}

function RoleSelect({ value, onChange, disabled }: { value: TeamRole; onChange: (role: TeamRole) => void; disabled?: boolean }) {
    return (
        <Select value={value} onValueChange={v => onChange(v as TeamRole)} disabled={disabled}>
            <SelectTrigger className="w-full bg-[#1A1A1A] border-[#3A3A3A] text-white sm:w-40">
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#2A2A2A] border-[#3A3A3A]">
                {ASSIGNABLE_ROLES.map(role => (
                    <SelectItem key={role} value={role} className="text-white">{ROLE_INFO[role].label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/** Settings → Team: the owner's members and roles, plus the teams this account belongs to. */
export default function TeamSettings() {
    const { user } = useAuth();
    const teamOnly = user?.app_metadata?.team_only === true;
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<TeamRole>('scriptwriter');
    const [inviting, setInviting] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [team, spaces] = await Promise.all([
                teamOnly ? Promise.resolve({ members: [] }) : request<{ members: TeamMember[] }>('/api/team/members'),
                request<{ workspaces: Workspace[] }>('/api/team/workspaces'),
            ]);
            setMembers(team.members);
            setWorkspaces(spaces.workspaces.filter(w => w.role !== 'owner'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load team');
        } finally {
            setLoading(false);
        }
    }, [teamOnly]);

    useEffect(() => { load(); }, [load]);

    const run = async (id: string, action: () => Promise<unknown>) => {
        setBusyId(id);
        setError(null);
        try {
            await action();
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Request failed');
        } finally {
            setBusyId(null);
        }
    };

    const invite = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setInviting(true);
        setError(null);
        try {
            const { member } = await request<{ member: TeamMember }>('/api/team/members', {
                method: 'POST',
                body: JSON.stringify({ email, role }),
            });
            setEmail('');
            await load();
            if (member.invite_token) copyLink(member);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to invite');
        } finally {
            setInviting(false);
        }
    };

    const copyLink = async (member: TeamMember) => {
        if (!member.invite_token) return;
        try {
            await navigator.clipboard.writeText(inviteLink(member.invite_token));
            setCopiedId(member.id);
            setTimeout(() => setCopiedId(id => (id === member.id ? null : id)), 2000);
        } catch {
            window.prompt('Copy this invite link', inviteLink(member.invite_token));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-[#B8B9BC]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>
            )}

            {!teamOnly && (
                <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-[#F97316]" />
                            <CardTitle className="text-white">Your team</CardTitle>
                        </div>
                        <CardDescription className="text-[#B8B9BC]">
                            Invite people to work on your Script board. They get a one-time link; people without an
                            account can sign up from it and only see the Script board.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                type="email"
                                placeholder="teammate@example.com"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                disabled={inviting}
                                required
                            />
                            <RoleSelect value={role} onChange={setRole} disabled={inviting} />
                            <Button type="submit" disabled={inviting} className="bg-[#F97316] hover:bg-[#EA580C] text-white">
                                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                Invite
                            </Button>
                        </form>

                        <div className="grid gap-2 text-xs text-[#B8B9BC] sm:grid-cols-2">
                            {(Object.keys(ROLE_INFO) as TeamRole[]).map(r => (
                                <div key={r}>
                                    <span className="font-semibold text-white">{ROLE_INFO[r].label}:</span> {ROLE_INFO[r].description}
                                </div>
                            ))}
                        </div>

                        <div className="divide-y divide-[#3A3A3A] rounded border border-[#3A3A3A]">
                            <div className="flex items-center justify-between gap-3 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="truncate text-white">{user?.email}</div>
                                    <div className="text-xs text-[#B8B9BC]">You</div>
                                </div>
                                <span className="text-sm text-[#B8B9BC]">Owner</span>
                            </div>
                            {members.map(member => (
                                <div key={member.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="truncate text-white">{member.email}</div>
                                        <div className="text-xs text-[#B8B9BC]">
                                            {member.user_id ? 'Joined' : 'Invite pending'}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!member.user_id && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => copyLink(member)}
                                                className="text-[#B8B9BC] hover:bg-[#3A3A3A] hover:text-white"
                                            >
                                                {copiedId === member.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                {copiedId === member.id ? 'Copied' : 'Invite link'}
                                            </Button>
                                        )}
                                        <RoleSelect
                                            value={member.role}
                                            disabled={busyId === member.id}
                                            onChange={next => run(member.id, () => request(`/api/team/members/${member.id}`, {
                                                method: 'PUT',
                                                body: JSON.stringify({ role: next }),
                                            }))}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            disabled={busyId === member.id}
                                            aria-label={`Remove ${member.email}`}
                                            onClick={() => {
                                                if (window.confirm(`Remove ${member.email} from your team?`)) {
                                                    run(member.id, () => request(`/api/team/members/${member.id}`, { method: 'DELETE' }));
                                                }
                                            }}
                                            className="text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                <CardHeader>
                    <CardTitle className="text-white">Teams you're in</CardTitle>
                    <CardDescription className="text-[#B8B9BC]">
                        Workspaces other owners invited you to. Switch between them on the Script board.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {workspaces.length === 0 ? (
                        <p className="text-sm text-[#B8B9BC]">You haven't joined anyone else's team.</p>
                    ) : (
                        <div className="divide-y divide-[#3A3A3A] rounded border border-[#3A3A3A]">
                            {workspaces.map(w => (
                                <div key={w.owner_id} className="flex items-center justify-between gap-3 px-4 py-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-white">{w.owner_email || 'Team workspace'}</div>
                                        <div className="text-xs text-[#B8B9BC]">{ROLE_INFO[w.role].label}</div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={busyId === w.owner_id}
                                        onClick={() => {
                                            if (window.confirm(`Leave ${w.owner_email || 'this'} team?`)) {
                                                run(w.owner_id, () => request(`/api/team/workspaces/${w.owner_id}/leave`, { method: 'POST' }));
                                            }
                                        }}
                                        className="text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400"
                                    >
                                        <LogOut className="h-4 w-4" /> Leave
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
