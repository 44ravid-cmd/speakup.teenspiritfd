import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, OperationType, handleFirestoreError, onConnectionStateChange } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User as AuthUser } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, serverTimestamp, deleteDoc, updateDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { isRTL } from './lib/translations';
import { Shield, MessageSquare, Video, User as UserIcon, LogOut, AlertTriangle, CheckCircle, Info, Mic, Camera, RefreshCw, Share2, Copy, Globe, Activity, Moon, Sun } from 'lucide-react';
import ProfileSetup from './components/ProfileSetup';
import DebateRoom from './components/DebateRoom';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [userPrivate, setUserPrivate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showInviteToast, setShowInviteToast] = useState(false);
  const [relayActive, setRelayActive] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const { t, i18n } = useTranslation();

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    return onConnectionStateChange(online => {
      setIsOffline(!online);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setRoomId(room);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      // Listen to profile and private data
      const unsubProfile = onSnapshot(doc(db, 'profiles', user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : null;
        if (data && !data.isAdmin && user.email === '44ravid@gmail.com') {
          updateDoc(doc(db, 'profiles', user.uid), { isAdmin: true }).catch(console.error);
        }
        setProfile(data);
        setLoading(false);
      }, (err) => {
        console.error("Profile snapshot error:", err);
        setLoading(false);
      });

      const unsubPrivate = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        setUserPrivate(snap.exists() ? snap.data() : null);
      }, (err) => {
        console.error("Private data snapshot error:", err);
      });

      return () => {
        unsubProfile();
        unsubPrivate();
      };
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError("Failed to sign in. Please try again.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleInvite = () => {
    const id = Math.random().toString(36).substring(2, 9);
    const url = `${window.location.origin}${window.location.pathname}?room=${id}`;
    navigator.clipboard.writeText(url);
    setShowInviteToast(true);
    setTimeout(() => setShowInviteToast(false), 3000);
  };

  const [banInfo, setBanInfo] = useState<{ isBanned: boolean; reason: string; expires: number } | null>(null);

  useEffect(() => {
    if (!user) return;

    const unsubReports = onSnapshot(query(collection(db, 'reports'), where('reportedId', '==', user.uid)), (snapshot) => {
      const reports = snapshot.docs.map(d => d.data());
      const now = Date.now();
      
      // Automated ban logic
      const uniqueReporters = new Set(reports.map(r => r.reporterId)).size;
      const recentReports = reports.filter(r => r.timestamp?.toMillis() > now - 24 * 60 * 60 * 1000);
      const uniqueRecentReporters = new Set(recentReports.map(r => r.reporterId)).size;

      let automatedBan = null;
      if (uniqueReporters >= 10) {
        automatedBan = { 
          isBanned: true, 
          reason: "Permanent/Long-term suspension due to excessive reports (10+).", 
          expires: now + 7 * 24 * 60 * 60 * 1000 
        };
      } else if (uniqueRecentReporters >= 3) {
        automatedBan = { 
          isBanned: true, 
          reason: "Temporary 30-minute suspension due to community reports.", 
          expires: now + 30 * 60 * 1000 
        };
      }

      // Check for manual ban in profile/private data
      if (profile?.isBanned) {
        const expiresAt = userPrivate?.banUntil ? 
          (typeof userPrivate.banUntil === 'string' ? new Date(userPrivate.banUntil).getTime() : userPrivate.banUntil.toMillis()) : 
          Infinity;
          
        if (expiresAt > now) {
          setBanInfo({
            isBanned: true,
            reason: userPrivate?.banReason || "Your account has been suspended by a moderator for violating community standards.",
            expires: expiresAt
          });
          return;
        }
      }

      setBanInfo(automatedBan);
    });

    return () => unsubReports();
  }, [user, profile, userPrivate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center transition-colors">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="text-zinc-200 dark:text-zinc-900 w-12 h-12" />
        </motion.div>
      </div>
    );
  }

  if (banInfo && banInfo.isBanned) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col items-center justify-center p-6 text-center space-y-8 transition-colors">
        <div className="w-24 h-24 rounded-minimal bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 flex items-center justify-center mb-4">
          <AlertTriangle className="w-12 h-12 text-rose-500" />
        </div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-4xl font-black uppercase tracking-tighter italic">Account Suspended</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-lg">{banInfo.reason}</p>
          <div className="bg-white dark:bg-black border border-zinc-100 dark:border-zinc-900 rounded-minimal p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Suspension Expires In</p>
            <p className="text-2xl font-mono text-zinc-900 dark:text-zinc-100">
              {Math.max(0, Math.ceil((banInfo.expires - Date.now()) / 60000))} Minutes
            </p>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 px-8 py-4 rounded-minimal bg-zinc-50 dark:bg-black border border-zinc-100 dark:border-zinc-900 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all font-black uppercase tracking-widest text-xs"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    );
  }

  if (!user) {
    return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col items-center justify-center p-6 relative overflow-hidden transition-colors">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-accent/5 blur-[120px] rounded-full" />
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl w-full text-center space-y-12 relative z-10"
        >
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="flex justify-center mb-8"
            >
              <div className="w-16 h-16 rounded-minimal bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-center transition-colors">
                 <img 
                  src="https://api.dicebear.com/7.x/initials/svg?seed=SpeakUp&backgroundColor=2563eb&fontSize=45&fontWeight=800" 
                  className="w-full h-full object-contain p-3 opacity-20 dark:opacity-40" 
                  alt="SpeakUp Logo"
                  referrerPolicy="no-referrer"
                />
               </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-3 py-1 bg-brand-accent/5 border border-brand-accent/10 text-[10px] font-bold tracking-[0.2em] uppercase text-brand-accent mb-4"
            >
              <Shield className="w-3 h-3 text-brand-accent" />
              Verified Protocol
            </motion.div>
            <h1 className="text-7xl md:text-8xl font-sans font-black tracking-tighter leading-[0.9] text-zinc-900 dark:text-zinc-50">
              Speak <br /> Up.
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-lg max-w-lg mx-auto font-medium leading-relaxed">
              Geopolitical discourse at high resolution.
              <span className="text-zinc-400 dark:text-zinc-500 block mt-2 text-xs uppercase tracking-widest font-mono">Neutral. Precise. Verified.</span>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="bg-white dark:bg-zinc-900 p-8 border border-zinc-200/50 dark:border-zinc-800 space-y-4 shadow-md shadow-zinc-200/20 dark:shadow-zinc-950/50 transition-all">
              <div className="w-8 h-8 bg-zinc-100/50 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200/40 dark:border-zinc-800">
                <Shield className="text-zinc-300 dark:text-zinc-700 w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-900 dark:text-white text-xs uppercase tracking-widest">Integrity</h3>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed font-medium">Misconduct results in immediate, permanent suspension.</p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-8 border border-zinc-200/50 dark:border-zinc-800 space-y-4 shadow-md shadow-zinc-200/20 dark:shadow-zinc-950/50 transition-all">
              <div className="w-8 h-8 bg-zinc-100/50 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200/40 dark:border-zinc-800">
                <Info className="text-zinc-300 dark:text-zinc-700 w-4 h-4" />
              </div>
              <h3 className="font-bold text-zinc-900 dark:text-white text-xs uppercase tracking-widest">Verification</h3>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed font-medium">Presence detection ensures genuine interaction.</p>
            </div>
          </div>

          <div className="pt-8">
            <button 
              onClick={handleLogin}
              className="w-full md:w-auto bg-brand-accent text-white font-bold py-4 px-12 rounded-minimal transition-all hover:brightness-110 active:scale-95 text-xs uppercase tracking-widest shadow-xl shadow-brand-accent/20"
            >
              Initialize Session
            </button>
            <p className="mt-8 text-zinc-800 text-[9px] font-bold uppercase tracking-[0.4em]">
              Professional code of conduct enforced
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return <ProfileSetup user={user} onComplete={(p) => setProfile(p)} />;
  }

  return (
      <div 
        className="h-[100dvh] bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 flex flex-col overflow-hidden font-sans selection:bg-brand-accent/10 transition-colors"
      dir={isRTL(i18n.language) ? 'rtl' : 'ltr'}
    >
      <AnimatePresence>
        {isOffline && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-rose-600 text-white py-2 px-4 flex items-center justify-center gap-3 relative z-[100] text-center"
          >
            <AlertTriangle className="w-4 h-4 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">
              {t('app.connection_lost_retrying')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-50 shrink-0 transition-colors shadow-sm dark:shadow-zinc-950/30">
        <div className="w-full px-4 md:px-12 py-4 md:py-6 flex justify-between items-center">
          <div className="flex items-center gap-4 md:gap-8">
            <h1 className="text-xl md:text-2xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50 uppercase italic">Speak Up.</h1>
          </div>
          <div className="flex items-center gap-4 md:gap-10">
            <div className="flex items-center gap-2 md:gap-6">
              {/* Theme Toggle */}
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-minimal text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-all shadow-sm"
              >
                {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              {/* Language Selector */}
              <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-minimal group shadow-sm dark:shadow-zinc-950/20">
                <Globe className="w-3 h-3 text-zinc-400 group-hover:text-brand-accent transition-colors" />
                <select 
                  value={i18n.language}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  className="bg-transparent border-none outline-none text-[9px] md:text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors px-1"
                >
                  <option value="en" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇺🇸 English</option>
                  <option value="ar" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇸🇦 العربية</option>
                  <option value="he" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇮🇱 עברית</option>
                </select>
              </div>

              <button 
                onClick={handleInvite}
                className="hidden sm:flex items-center gap-2 px-4 py-2 border border-brand-accent/20 text-brand-accent hover:bg-brand-accent hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest rounded-minimal bg-brand-accent/5 shadow-sm"
              >
                <Share2 className="w-3 h-3" />
                <span className="hidden md:inline">{t('app.invite')}</span>
              </button>

              <div className="h-6 w-[1px] bg-zinc-100 dark:bg-zinc-800 mx-2 hidden sm:block" />

              <div className="flex flex-col items-end">
                <span className="text-[10px] md:text-xs font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">{profile.displayName?.split(' ')[0]}</span>
                <select 
                  value={profile.opinion}
                  onChange={async (e) => {
                    const newOpinion = e.target.value;
                    try {
                      await setDoc(doc(db, 'profiles', user.uid), { ...profile, opinion: newOpinion });
                      setProfile({ ...profile, opinion: newOpinion });
                    } catch (err) {
                      handleFirestoreError(err, OperationType.UPDATE, `profiles/${user.uid}`);
                    }
                  }}
                  className={`text-[7px] md:text-[8px] uppercase tracking-[0.2em] bg-transparent border-none outline-none cursor-pointer ${isRTL(i18n.language) ? 'text-left' : 'text-right'} font-black appearance-none transition-colors ${
                    profile.opinion === 'Pro Israel' || profile.opinion === 'Pro Palestine' ? 'text-brand-accent' : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                >
                  <option value="Pro Israel" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">{t('app.opinions.pro_israel')}</option>
                  <option value="Pro Palestine" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">{t('app.opinions.pro_palestine')}</option>
                  <option value="Neutral" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">{t('app.opinions.neutral')}</option>
                </select>
              </div>

              <div className="relative group ml-1 md:ml-2">
                <img src={user.photoURL || ''} className="w-8 h-8 md:w-10 md:h-10 rounded-minimal border border-zinc-300 dark:border-zinc-700 object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 rounded-minimal border border-zinc-300 dark:border-zinc-700 group-hover:border-brand-accent transition-all pointer-events-none" />
              </div>

              <button 
                onClick={handleLogout} 
                className="p-2 md:p-3 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-all font-black uppercase tracking-widest text-xs"
                title={t('app.disconnect')}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col min-h-0 bg-zinc-50 dark:bg-zinc-950 transition-colors">
        <AnimatePresence>
          {showInviteToast && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 15, x: '-50%' }}
              animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, scale: 0.9, y: 10, x: '-50%' }}
              className="fixed bottom-12 left-1/2 z-[100] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-8 py-3 shadow-2xl text-center rounded-minimal"
            >
              <div className="flex items-center gap-4">
                <Copy className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-[10px] font-bold text-zinc-900 dark:text-zinc-100 tracking-widest uppercase">{t('app.invite_initialized')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {roomId && (
          <div className="mx-6 sm:mx-10 mt-6 flex items-center justify-between bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-minimal shadow-md dark:shadow-zinc-950/30">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 rounded-minimal">
                <Shield className="w-5 h-5 text-brand-accent/50" />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">{t('app.relay_node')}</p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5 uppercase tracking-widest">{t('app.private_channel')}</p>
              </div>
            </div>
            <button 
              onClick={() => {
                window.history.replaceState({}, '', window.location.pathname);
                setRoomId(null);
              }}
              className="text-[10px] font-bold text-zinc-400 hover:text-brand-accent transition-all uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-900"
            >
              {t('app.terminate_relay')}
            </button>
          </div>
        )}
        <DebateRoom user={user} profile={profile} roomId={roomId} />
      </main>
    </div>
  );
}
