import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    Video,
    Bookmark,
    Library,
    Settings,
    LogOut,
    FileAudio,
    Search,
    Sparkles,
    Menu,
    Clapperboard,
    NotebookPen,
    X
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LongformJobsProvider } from '@/hooks/useLongformJobs';
import JobQueue, { FinishedToasts } from '@/components/JobQueue';

interface LayoutProps {
    children: ReactNode;
}

const allNavigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Generate', href: '/generate', icon: Video },
    { name: 'Audio Import', href: '/audio-import', icon: FileAudio },
    { name: 'Long Form', href: '/longform', icon: Clapperboard },
    { name: 'Scripts', href: '/scripts', icon: NotebookPen, teamAllowed: true },
    { name: 'Presets', href: '/presets', icon: Bookmark },
    { name: 'Library', href: '/library', icon: Library },
    { name: 'Research', href: '/research', icon: Search },
    { name: 'Aura', href: '/aura', icon: Sparkles },
    { name: 'Settings', href: '/settings', icon: Settings, teamAllowed: true },
];

export default function Layout({ children }: LayoutProps) {
    const location = useLocation();
    const { signOut, user } = useAuth();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    // Team-only accounts (made from a team invite) only see the Script board and Settings → Team
    const teamOnly = user?.app_metadata?.team_only === true;
    const navigation = teamOnly ? allNavigation.filter(item => item.teamAllowed) : allNavigation;

    return (
        <LongformJobsProvider>
        <div className="min-h-screen bg-[#222222] flex">
            <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-[#2A2A2A] bg-[#1A1A1A] px-4 lg:hidden">
                <div className="flex min-w-0 items-center gap-3">
                    <img src="/getbrainrot-logo.png" alt="Get Brainrot" className="h-9 w-9 shrink-0 object-contain" />
                    <span className="truncate text-lg font-semibold text-white">
                        {navigation.find(n => n.href === location.pathname)?.name || 'Get Brainrot'}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {!teamOnly && <JobQueue compact />}
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(true)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-[#2A2A2A]"
                        aria-label="Open navigation"
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                </div>
            </div>

            {mobileMenuOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/70"
                        onClick={() => setMobileMenuOpen(false)}
                        aria-label="Close navigation"
                    />
                    <div className="relative flex h-full w-[min(84vw,320px)] flex-col border-r border-[#2A2A2A] bg-[#1A1A1A] shadow-2xl">
                        <div className="flex h-16 items-center justify-between border-b border-[#2A2A2A] px-4">
                            <div className="flex items-center gap-3">
                                <img src="/getbrainrot-logo.png" alt="Get Brainrot" className="h-9 w-9 object-contain" />
                                <img src="/brainrot-wordmark.png" alt="Brainrot" className="h-7 w-auto max-w-[165px] object-contain" />
                            </div>
                            <button
                                type="button"
                                onClick={() => setMobileMenuOpen(false)}
                                className="flex h-11 w-11 items-center justify-center rounded-lg text-white hover:bg-[#2A2A2A]"
                                aria-label="Close navigation"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>
                        <nav className="flex-1 space-y-2 overflow-y-auto p-4">
                            {navigation.map((item) => {
                                const isActive = location.pathname === item.href;
                                return (
                                    <Link
                                        key={item.name}
                                        to={item.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={cn(
                                            'flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors',
                                            isActive
                                                ? 'bg-[#F97316] text-white'
                                                : 'text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white'
                                        )}
                                    >
                                        <item.icon className="h-5 w-5 shrink-0" />
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="border-t border-[#2A2A2A] p-4">
                            <button
                                onClick={() => signOut()}
                                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-4 py-3 text-base font-medium text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400"
                            >
                                <LogOut className="h-5 w-5" />
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sidebar - 25% larger */}
            <div className="hidden w-[280px] shrink-0 bg-[#1A1A1A] border-r border-[#2A2A2A] lg:flex flex-col sticky top-0 h-screen">
                {/* Logo */}
                <div className="h-20 flex items-center px-5 border-b border-[#2A2A2A]">
                    <div className="flex items-center gap-3">
                        <img src="/getbrainrot-logo.png" alt="Get Brainrot" className="h-10 w-10 object-contain" />
                        <img src="/brainrot-wordmark.png" alt="Brainrot" className="h-7 w-auto max-w-[170px] object-contain" />
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-5 space-y-2">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded text-base font-medium transition-colors',
                                    isActive
                                        ? 'bg-[#F97316] text-white'
                                        : 'text-[#B8B9BC] hover:bg-[#2A2A2A] hover:text-white'
                                )}
                            >
                                <item.icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                {/* Logout Box at the bottom */}
                <div className="p-4 border-t border-[#2A2A2A]">
                    <button
                        onClick={() => signOut()}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded text-base font-medium text-[#B8B9BC] hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    >
                        <LogOut className="h-5 w-5" />
                        Logout
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="min-w-0 flex-1 flex flex-col pt-16 lg:pt-0">
                {/* Top Bar */}
                <div className="hidden h-20 bg-[#1A1A1A] border-b border-[#2A2A2A] px-8 lg:flex items-center justify-between">
                    <h2 className="text-white font-medium text-lg">
                        {navigation.find(n => n.href === location.pathname)?.name || 'Get Brainrot'}
                    </h2>
                    {!teamOnly && <JobQueue />}
                </div>

                {/* Page Content */}
                <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 lg:p-6">
                    {children}
                </main>
            </div>
            <FinishedToasts />
        </div>
        </LongformJobsProvider>
    );
}
