import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import VideoGenerator from './pages/VideoGenerator';
import AudioImportGenerator from './pages/AudioImportGenerator';
import Presets from './pages/Presets';
import VideoLibrary from './pages/VideoLibrary';
import Settings from './pages/Settings';
import Research from './pages/Research';
import Aura from './pages/Aura';
import LongForm from './pages/LongForm';
import Scripts from './pages/Scripts';
import Join from './pages/Join';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Protected route component. Team-only accounts (made from a team invite) only reach
// routes marked teamAllowed; everything else sends them to the Script board.
function ProtectedRoute({ children, teamAllowed = false }: { children: React.ReactNode; teamAllowed?: boolean }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen bg-[#222222] flex items-center justify-center">
                <div className="text-white">Loading...</div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (user.app_metadata?.team_only === true && !teamAllowed) {
        return <Navigate to="/scripts" replace />;
    }

    return <>{children}</>;
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/join" element={<Join />} />
            <Route path="/" element={
                <ProtectedRoute>
                    <Layout><Dashboard /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/generate" element={
                <ProtectedRoute>
                    <Layout><VideoGenerator /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/audio-import" element={
                <ProtectedRoute>
                    <Layout><AudioImportGenerator /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/longform" element={
                <ProtectedRoute>
                    <Layout><LongForm /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/scripts" element={
                <ProtectedRoute teamAllowed>
                    <Layout><Scripts /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/presets" element={
                <ProtectedRoute>
                    <Layout><Presets /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/library" element={
                <ProtectedRoute>
                    <Layout><VideoLibrary /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/research" element={
                <ProtectedRoute>
                    <Layout><Research /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/aura" element={
                <ProtectedRoute>
                    <Layout><Aura /></Layout>
                </ProtectedRoute>
            } />
            <Route path="/settings" element={
                <ProtectedRoute teamAllowed>
                    <Layout><Settings /></Layout>
                </ProtectedRoute>
            } />
        </Routes>
    );
}

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
