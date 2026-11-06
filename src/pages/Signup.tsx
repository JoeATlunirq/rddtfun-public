import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function Signup() {
    const [params] = useSearchParams();
    const inviteToken = params.get('invite') || '';
    const [email, setEmail] = useState(params.get('email') || '');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [signupCode, setSignupCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();
    const { signUp } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (!inviteToken && !signupCode.trim()) {
            setError('Signup code is required');
            return;
        }

        setLoading(true);

        try {
            const { error: signUpError } = await signUp(email, password, signupCode.trim(), inviteToken || undefined);

            if (signUpError) {
                setError(signUpError.message);
            } else {
                setSuccess(true);
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-[#222222] p-4 sm:p-6">
                <div className="w-full max-w-md">
                    <Card className="bg-[#2A2A2A] border-[#3A3A3A]">
                        <CardHeader>
                            <CardTitle className="text-white text-2xl">Account created</CardTitle>
                            <CardDescription className="text-[#B8B9BC]">
                                {inviteToken
                                    ? 'You joined the team. Your account opens straight to the Script board.'
                                    : 'Your invite was accepted and your account is ready.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button
                                onClick={() => navigate(inviteToken ? '/scripts' : '/')}
                                className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white"
                            >
                                {inviteToken ? 'Open Script board' : 'Continue to Dashboard'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

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
                        <CardTitle className="text-white text-2xl">Create an account</CardTitle>
                        <CardDescription className="text-[#B8B9BC]">
                            Get started with Get Brainrot today
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-2 rounded text-sm">
                                    {error}
                                </div>
                            )}

                            {!inviteToken && <div className="space-y-2">
                                <Label htmlFor="signup-code" className="text-white">
                                    Signup Code <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="signup-code"
                                    type="text"
                                    placeholder="Enter your invite code"
                                    value={signupCode}
                                    onChange={(e) => setSignupCode(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    required
                                    disabled={loading}
                                />
                                <p className="text-xs text-[#B8B9BC]">
                                    You need a valid signup code to create an account
                                </p>
                            </div>}

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
                                    disabled={loading || !!inviteToken}
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
                                    minLength={8}
                                    disabled={loading}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirm-password" className="text-white">Confirm Password</Label>
                                <Input
                                    id="confirm-password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="bg-[#1A1A1A] border-[#3A3A3A] text-white"
                                    required
                                    minLength={8}
                                    disabled={loading}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white"
                                disabled={loading}
                            >
                                {loading ? 'Creating account...' : 'Create Account'}
                            </Button>

                            <div className="text-center text-sm text-[#B8B9BC]">
                                Already have an account?{' '}
                                <Link to="/login" className="text-[#F97316] hover:underline">
                                    Sign in
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
