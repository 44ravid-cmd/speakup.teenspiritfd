import React, { useState } from 'react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Shield, CheckCircle, User as UserIcon, Globe } from 'lucide-react';
import { isRTL } from '../lib/translations';

interface Props {
  user: User;
  onComplete: (profile: any) => void;
}

export default function ProfileSetup({ user, onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [opinion, setOpinion] = useState<'Pro Israel' | 'Pro Palestine' | 'Neutral' | ''>('');
  const [age, setAge] = useState<string>('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opinion || !termsAccepted) return;
    
    setLoading(true);
    try {
      const profileData = {
        uid: user.uid,
        displayName,
        photoURL: user.photoURL,
        opinion,
        isBanned: false,
        isAdmin: user.email === '44ravid@gmail.com',
      };

      const privateData = {
        email: user.email,
        reportsCount: 0,
        createdAt: serverTimestamp(),
        acceptedTermsAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'profiles', user.uid), profileData);
      await setDoc(doc(db, 'users', user.uid), privateData);
      
      onComplete(profileData);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `profiles/users/${user.uid}`);
      setError("Failed to save profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (step === 1) {
    return (
      <div className="min-h-[100dvh] bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 flex items-center justify-center p-4 md:p-6 relative overflow-y-auto transition-colors" dir={isRTL(i18n.language) ? 'rtl' : 'ltr'}>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-accent/5 blur-[120px] rounded-full" />
        
        {/* Language Switcher Overlay */}
        <div className="absolute top-6 end-6 z-50">
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 px-4 py-2 border border-zinc-200 dark:border-zinc-800 rounded-minimal group shadow-sm">
            <Globe className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 group-hover:text-brand-accent transition-colors" />
            <select 
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <option value="en" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">🇺🇸 English</option>
              <option value="ar" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">🇸🇦 العربية</option>
              <option value="he" className="bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">🇮🇱 עברית</option>
            </select>
          </div>
        </div>
        
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="max-w-2xl w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 md:p-10 rounded-minimal space-y-6 md:space-y-8 relative z-10 shadow-xl dark:shadow-zinc-950/50"
      >
          <div className="text-center space-y-2 md:space-y-3">
            <h2 className="text-2xl md:text-3xl font-serif italic text-zinc-900 dark:text-zinc-50">{t('app.terms_agreements')}</h2>
            <p className="text-zinc-400 dark:text-zinc-500 font-medium text-[10px] md:text-xs uppercase tracking-widest">{t('app.protocol_review')}</p>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-minimal p-4 md:p-8 h-64 md:h-80 overflow-y-auto space-y-4 md:space-y-6 text-xs md:text-sm text-zinc-500 dark:text-zinc-400 font-light leading-relaxed custom-scrollbar text-left shadow-inner">
            <section className="space-y-2">
              <h3 className="text-zinc-400 dark:text-zinc-700 font-bold uppercase tracking-widest text-[10px]">{t('app.community_integrity_title')}</h3>
              <p>{t('app.community_integrity_content')}</p>
            </section>
            
            <section className="space-y-2">
              <h3 className="text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest text-[10px]">{t('app.zero_tolerance_title')}</h3>
              <p className="text-rose-500/80">{t('app.zero_tolerance_content')}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-zinc-400 dark:text-zinc-700 font-bold uppercase tracking-widest text-[10px]">{t('app.nsfw_title')}</h3>
              <p>{t('app.nsfw_content')}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-zinc-400 dark:text-zinc-700 font-bold uppercase tracking-widest text-[10px]">{t('app.age_title')}</h3>
              <p>{t('app.age_content')}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-zinc-400 dark:text-zinc-700 font-bold uppercase tracking-widest text-[10px]">{t('app.data_privacy_title')}</h3>
              <p>{t('app.data_privacy_content')}</p>
            </section>
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-4 cursor-pointer group text-left">
              <div className={`mt-1 w-6 h-6 rounded-minimal border transition-all flex items-center justify-center shrink-0 ${
                termsAccepted ? 'bg-brand-accent border-brand-accent shadow-lg shadow-brand-accent/20' : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 group-hover:border-zinc-300 dark:group-hover:border-zinc-600'
              }`}>
                {termsAccepted && <CheckCircle className="w-4 h-4 text-white" />}
              </div>
              <input 
                type="checkbox" 
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="hidden"
              />
              <span className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors">
                {t('app.terms_checkbox')}
              </span>
            </label>

            <button
              onClick={() => setStep(2)}
              disabled={!termsAccepted}
              className="w-full bg-brand-accent text-white font-black py-5 rounded-minimal transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed flex items-center justify-center gap-3 text-sm uppercase tracking-[0.2em] shadow-xl shadow-brand-accent/20 border border-transparent"
            >
              {t('app.continue_setup')}
              <CheckCircle className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 flex items-center justify-center p-4 md:p-6 relative overflow-y-auto transition-colors" dir={isRTL(i18n.language) ? 'rtl' : 'ltr'}>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-accent/5 blur-[120px] rounded-full" />
      
      {/* Language Switcher Overlay */}
      <div className="absolute top-6 end-6 z-50">
        <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 px-4 py-2 border border-zinc-200 dark:border-zinc-800 rounded-minimal group shadow-sm">
          <Globe className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 group-hover:text-brand-accent transition-colors" />
          <select 
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <option value="en" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇺🇸 English</option>
            <option value="ar" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇸🇦 العربية</option>
            <option value="he" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">🇮🇱 עברית</option>
          </select>
        </div>
      </div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-xl w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 md:p-10 rounded-minimal space-y-8 md:space-y-10 relative z-10 shadow-xl dark:shadow-zinc-950/50"
      >
        <div className="text-center space-y-4 md:space-y-6">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-zinc-50 dark:bg-zinc-950 rounded-minimal flex items-center justify-center mx-auto mb-4 md:mb-6 border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-inner">
            <UserIcon className="w-8 h-8 md:w-10 md:h-10 text-zinc-200 dark:text-zinc-800" />
          </div>
          <div className="space-y-1 md:space-y-2">
            <h2 className="text-2xl md:text-3xl font-serif italic text-zinc-900 dark:text-zinc-50 text-center">{t('app.identity_setup')}</h2>
            <p className="text-zinc-400 dark:text-zinc-500 font-medium text-[10px] md:text-xs uppercase tracking-widest">{t('app.configure_presence')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 md:space-y-8">
          <div className="space-y-2 md:space-y-3">
            <label className="text-[9px] md:text-[10px] font-bold text-zinc-400 dark:text-zinc-700 uppercase tracking-widest ml-1 block">{t('app.display_identity')}</label>
            <input 
              type="text" 
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-minimal px-4 md:px-6 py-3 md:py-4 focus:border-brand-accent/50 outline-none transition-all text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-200 dark:placeholder:text-zinc-800 text-sm shadow-sm"
              placeholder={t('app.enter_your_public_name')}
              required
            />
          </div>

          <div className="space-y-2 md:space-y-3">
            <label className="text-[9px] md:text-[10px] font-bold text-zinc-400 dark:text-zinc-700 uppercase tracking-widest ml-1 block">{t('app.stance')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
              {[
                { id: 'Pro Israel', label: t('app.opinions.pro_israel') },
                { id: 'Pro Palestine', label: t('app.opinions.pro_palestine') },
                { id: 'Neutral', label: t('app.opinions.neutral') }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOpinion(opt.id as any)}
                  className={`relative py-4 rounded-minimal border transition-all text-[10px] font-bold uppercase tracking-widest overflow-hidden ${
                    opinion === opt.id 
                      ? 'bg-brand-accent text-white border-brand-accent shadow-lg shadow-brand-accent/20' 
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-500 dark:hover:text-zinc-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-zinc-300 dark:text-zinc-800 font-medium mt-3 ml-1 uppercase tracking-wider">{t('app.stance_matching_hint')}</p>
          </div>

          <button
            type="submit"
            disabled={loading || !opinion}
            className="w-full bg-brand-accent text-white font-black py-5 rounded-minimal transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed flex items-center justify-center gap-3 text-sm uppercase tracking-[0.2em] shadow-xl shadow-brand-accent/20 border border-transparent"
          >
            {loading ? t('app.processing') : t('app.initialize_session')}
            {!loading && <CheckCircle className="w-4 h-4" />}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
