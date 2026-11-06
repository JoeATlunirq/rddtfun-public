import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient, User, Session, SupabaseClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    signUp: (email: string, password: string, signupCode: string, inviteToken?: string) => Promise<{ error: Error | null }>;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    updatePassword: (password: string) => Promise<{ error: Error | null }>;
    enrollMFA: () => Promise<{ data: any; error: Error | null }>;
    verifyMFA: (factorId: string, code: string) => Promise<{ error: Error | null }>;
    unenrollMFA: (factorId: string) => Promise<{ error: Error | null }>;
    supabase: SupabaseClient;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    // inviteToken (from a Settings → Team link) replaces the signup code and makes a team-only account
    const signUp = async (email: string, password: string, signupCode: string, inviteToken?: string) => {
        try {
            const response = await fetch(`${apiBaseUrl}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, signupCode, inviteToken })
            });
            const data = await response.json();

            if (!response.ok) {
                return { error: new Error(data.error || 'Unable to create account') };
            }

            const { error } = await supabase.auth.signInWithPassword({ email, password });
            return { error };
        } catch (error) {
            return { error: error as Error };
        }
    };

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        return { error };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    const updatePassword = async (password: string) => {
        const { error } = await supabase.auth.updateUser({
            password: password
        });
        return { error: error as Error | null };
    };


    const enrollMFA = async () => {
        const { data, error } = await supabase.auth.mfa.enroll({
            factorType: 'totp'
        });
        return { data, error: error as Error | null };
    };

    const verifyMFA = async (factorId: string, code: string) => {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
            factorId,
            code
        });
        return { error: error as Error | null };
    };

    const unenrollMFA = async (factorId: string) => {
        const { error } = await supabase.auth.mfa.unenroll({
            factorId
        });
        return { error: error as Error | null };
    };

    const value = {
        user,
        session,
        loading,
        signUp,
        signIn,
        signOut,
        updatePassword,
        enrollMFA,
        verifyMFA,
        unenrollMFA,
        supabase,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export { supabase };
