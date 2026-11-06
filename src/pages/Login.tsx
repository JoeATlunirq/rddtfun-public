import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const [params] = useSearchParams();
    // Same-site path to return to (e.g. /join?token=…), never an external URL
    const next = params.get('next');
    const returnTo = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const { signIn } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { error: signInError } = await signIn(email, password);

            if (signInError) {
                setError(signInError.message);
            } else {
                navigate(returnTo);
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-dvh items-center justify-center bg-[#222222] p-4 sm:p-6">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-3 mb-8">
                    <img src="/getbrainrot-logo.png" alt="Get Brainrot" className="h-12 w-12 object-contain" />
                    <img src="/brainrot-wordmark.png" alt="Brainrot" className="h-9 w-auto max-w-[180px] object-contain" />
                </div>

                <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                    <CardHeader>
                        <CardTitle className="text-white text-2xl">Welcome back</CardTitle>
                        <CardDescription className="text-[#B8B9BC]">
                            Sign in to your account to continue
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-2 rounded text-sm">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-white">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    required
                                    disabled={loading}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-white">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    required
                                    disabled={loading}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white"
                                disabled={loading}
                            >
                                {loading ? 'Signing in...' : 'Sign In'}
                            </Button>

                            <div className="text-center text-sm text-[#B8B9BC]">
                                Don't have an account?{' '}
                                <Link to="/signup" className="text-[#F97316] hover:underline">
                                    Sign up
                                </Link>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <p className="text-center text-xs text-[#B8B9BC] mt-6">
                    By continuing, you agree to our Terms of Service and Privacy Policy
                </p>
            </div>
        </div>
    );
}
