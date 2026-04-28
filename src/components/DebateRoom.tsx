import React, { useState, useEffect, useRef } from 'react';
import { auth, db, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, serverTimestamp, OperationType, handleFirestoreError, Timestamp } from '../lib/firebase';
import { User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { Video, Mic, MicOff, Camera, CameraOff, SkipForward, AlertCircle, MessageSquare, Send, Shield, Settings, RefreshCw, Flag, CheckCircle, Volume2, Gavel, Ban, Clock, ShieldAlert, Activity, Signal, Copy, Users } from 'lucide-react';
import { verifyClaim, generateTopicSuggestion } from '../lib/gemini';

interface Props {
  user: User;
  profile: any;
  roomId?: string | null;
}

export default function DebateRoom({ user, profile, roomId }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'searching' | 'connected'>('idle');
  const [recentMatches, setRecentMatches] = useState<string[]>([]);
  const [remoteProfile, setRemoteProfile] = useState<any>(null);
  const [debateId, setDebateId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [matchAnyOpinion, setMatchAnyOpinion] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [showModerateModal, setShowModerateModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState<number>(1); // Hours
  const [showFaceAlert, setShowFaceAlert] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [debateSummary, setDebateSummary] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [suggestingTopic, setSuggestingTopic] = useState(false);
  const [suggestedTopic, setSuggestedTopic] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState('');
  const [selectedAudio, setSelectedAudio] = useState('');
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [potentialMatches, setPotentialMatches] = useState(0);
  const [estimatedWait, setEstimatedWait] = useState<string | null>(null);
  const [webrtcStatus, setWebrtcStatus] = useState<string>('Idle');
  const [bitrate, setBitrate] = useState<number | null>(null);
  const [packetLoss, setPacketLoss] = useState<number | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const unsubSignalsRef = useRef<(() => void) | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const unsubQueueRef = useRef<(() => void) | null>(null);
  const unsubDebatesRef = useRef<(() => void) | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAcquiringRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const debateListenerUnsub = useRef<(() => void) | null>(null);

  // Monitor active debate session state
  useEffect(() => {
    if (!debateId || status !== 'connected') return;

    console.log("Listening for debate session updates:", debateId);
    debateListenerUnsub.current = onSnapshot(doc(db, 'debates', debateId), (snap) => {
      const data = snap.data();
      if (!snap.exists() || data?.status === 'ended') {
        console.log("Debate session terminated by peer or system");
        handleSkip();
        return;
      }

      if (data?.suggestedTopic) {
        setSuggestedTopic(data.suggestedTopic);
        // Clear local view after 45s automatically
        const topicToRemove = data.suggestedTopic;
        setTimeout(() => {
          setSuggestedTopic(current => current === topicToRemove ? null : current);
        }, 45000);
      } else {
        setSuggestedTopic(null);
      }
    });

    return () => {
      if (debateListenerUnsub.current) {
        debateListenerUnsub.current();
        debateListenerUnsub.current = null;
      }
    };
  }, [debateId, status]);

  // Voice detection logic
  useEffect(() => {
    if (!localStreamRef.current || isMuted || status !== 'connected') {
      setIsSpeaking(false);
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    const analyzer = audioContext.createAnalyser();
    analyzerRef.current = analyzer;
    const source = audioContext.createMediaStreamSource(localStreamRef.current);
    source.connect(analyzer);
    analyzer.fftSize = 512;

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animationId: number;
    const checkVoice = () => {
      if (!analyzerRef.current) return;
      analyzerRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setIsSpeaking(average > 15); // Threshold for voice detection
      animationId = requestAnimationFrame(checkVoice);
    };

    checkVoice();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
    };
  }, [localStreamRef.current, isMuted, status]);

  // Global lobby stats listener
  useEffect(() => {
    const queueRef = collection(db, 'queue');
    const q = roomId ? query(queueRef, where('roomId', '==', roomId)) : query(queueRef);
    
    const unsub = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const activeCount = snapshot.docs.filter(d => {
        const lastSeen = d.data().timestamp?.toDate()?.getTime() || 0;
        return Math.abs(now - lastSeen) < 300000;
      }).length;
      if (status !== 'searching') {
        setQueueCount(activeCount);
      }
    });

    return () => unsub();
  }, [roomId, status]);

  const [connectionState, setConnectionState] = useState<string>('initializing');
  const [webrtcError, setWebrtcError] = useState<string | null>(null);
  const [latency, setLatency] = useState(12);
  const [stuckConnecting, setStuckConnecting] = useState(false);

  const qualityStats = React.useMemo(() => {
    if (status !== 'connected') return { color: 'transparent', status: 'idle', glow: false };
    
    // Critical threshold
    if ((packetLoss ?? 0) > 10 || latency > 400 || (bitrate !== null && bitrate < 100)) {
      return { color: 'border-rose-500', status: 'critical', glow: true, shadow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]' };
    }
    
    // Warning threshold
    if ((packetLoss ?? 0) > 2 || latency > 200 || (bitrate !== null && bitrate < 350)) {
      return { color: 'border-amber-500', status: 'warning', glow: true, shadow: 'shadow-[0_0_12px_rgba(245,158,11,0.2)]' };
    }
    
    // Optimal
    return { color: 'border-emerald-500/30', status: 'optimal', glow: false, shadow: '' };
  }, [packetLoss, latency, bitrate, status]);

  const [showMatchIntro, setShowMatchIntro] = useState(false);

  useEffect(() => {
    if (connectionState === 'connected' && remoteProfile) {
      setShowMatchIntro(true);
      const timer = setTimeout(() => setShowMatchIntro(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [connectionState, remoteProfile]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (connectionState === 'connecting' || connectionState === 'initializing') {
      timer = setTimeout(() => {
        if (connectionState === 'connecting' || connectionState === 'initializing') {
          setStuckConnecting(true);
        }
      }, 15000);
    } else {
      setStuckConnecting(false);
    }
    return () => clearTimeout(timer);
  }, [connectionState]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(prev => {
        const isSpike = Math.random() > 0.92;
        const spike = isSpike ? Math.floor(Math.random() * 80) + 40 : 0;
        const jitter = Math.floor(Math.random() * 6) - 3;
        let next = prev + jitter + spike;
        if (!isSpike && next > 25) next -= Math.floor(Math.random() * 10);
        return Math.max(9, Math.min(350, next));
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(d => {
      const videoDevices = d.filter(device => device.kind === 'videoinput');
      const audioDevices = d.filter(device => device.kind === 'audioinput');
      setDevices(d);
      if (videoDevices.length) setSelectedVideo(videoDevices[0].deviceId);
      if (audioDevices.length) setSelectedAudio(audioDevices[0].deviceId);
    });
  }, []);

  // Handle Mute/Camera Toggles
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !isCameraOff;
      });
    }
  }, [isCameraOff]);

  const handleBan = async () => {
    if (!remoteProfile || !profile.isAdmin || !banReason) return;
    try {
      const expiresAt = new Date();
      if (banDuration === -1) {
        expiresAt.setFullYear(expiresAt.getFullYear() + 100);
      } else {
        expiresAt.setHours(expiresAt.getHours() + (banDuration || 1));
      }

      const banData = {
        adminId: user.uid,
        bannedId: remoteProfile.uid,
        reason: banReason,
        durationHours: banDuration,
        timestamp: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt)
      };

      await addDoc(collection(db, 'bans'), banData);
      
      await updateDoc(doc(db, 'profiles', remoteProfile.uid), {
        isBanned: true
      });

      await updateDoc(doc(db, 'users', remoteProfile.uid), {
        banUntil: Timestamp.fromDate(expiresAt),
        banReason: banReason
      });

      setShowModerateModal(false);
      setBanReason('');
      handleSkip();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bans');
    }
  };

  const handleSuggestTopic = async () => {
    if (!remoteProfile || suggestingTopic || !debateId) return;
    setSuggestingTopic(true);
    try {
      const result = await generateTopicSuggestion(profile.opinion, remoteProfile.opinion);
      await updateDoc(doc(db, 'debates', debateId), {
        suggestedTopic: result,
        topicSuggestedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Topic suggestion error:", error);
    }
    setSuggestingTopic(false);
  };

  const startLocalStream = async (force = false, retries = 3) => {
    if (isAcquiringRef.current) {
      console.log("Stream acquisition already in progress, waiting...");
      while (isAcquiringRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return localStreamRef.current;
    }

    isAcquiringRef.current = true;
    setCameraError(null);
    try {
      if (localStreamRef.current) {
        const currentVideoId = localStreamRef.current.getVideoTracks()[0]?.getSettings().deviceId;
        const currentAudioId = localStreamRef.current.getAudioTracks()[0]?.getSettings().deviceId;
        
        const videoMatches = !selectedVideo || currentVideoId === selectedVideo;
        const audioMatches = !selectedAudio || currentAudioId === selectedAudio;

        if (!force && videoMatches && audioMatches && localStreamRef.current.active) {
          console.log("Reusing active local stream");
          isAcquiringRef.current = false;
          return localStreamRef.current;
        }

        console.log("Stopping stale stream tracks...");
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        localStreamRef.current.getTracks().forEach(track => track.stop());
        // Longer delay to allow OS/Drivers to release hardware
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      console.log("Requesting fresh media stream (Full)...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            deviceId: selectedVideo ? { ideal: selectedVideo } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
          },
          audio: { 
            deviceId: selectedAudio ? { ideal: selectedAudio } : undefined,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
        return finalizeStream(stream);
      } catch (e: any) {
        // Fallback: If full stream fails or device not found, try audio only or more relaxed constraints
        if (e.name === 'NotReadableError' || e.name === 'TrackStartError' || e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
          console.warn("Full or constrained acquisition failed, trying fallback...", e.name);
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true
          }).catch(() => null);
          
          if (!audioStream) throw e; // Both failed

          setIsCameraOff(true); 
          setCameraError(t('app.audio_only_fallback'));
          return finalizeStream(audioStream);
        }
        throw e;
      }
    } catch (error: any) {
      console.error(`Camera access error (${error.name}):`, error.message);
      
      if (retries > 0 && (error.name === 'NotReadableError' || error.name === 'TrackStartError')) {
        console.warn(`Device locked, retrying in 1s... (${retries} left)`);
        isAcquiringRef.current = false;
        await new Promise(resolve => setTimeout(resolve, 1000));
        return startLocalStream(force, retries - 1);
      }
      
      const errorType = error.name;
      switch (errorType) {
        case 'NotAllowedError':
          setCameraError(t('app.camera_error_denied'));
          break;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          setCameraError(t('app.camera_error_not_found'));
          break;
        case 'NotReadableError':
        case 'TrackStartError':
          setCameraError(t('app.camera_error_in_use'));
          break;
        case 'OverconstrainedError':
          setCameraError(t('app.camera_error_overconstrained'));
          break;
        case 'SecurityError':
          setCameraError(t('app.camera_error_security'));
          break;
        default:
          setCameraError(t('app.camera_access_failed'));
      }
      
      return null;
    } finally {
      isAcquiringRef.current = false;
    }
  };

  const finalizeStream = (stream: MediaStream) => {
    stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    stream.getVideoTracks().forEach(track => track.enabled = !isCameraOff);
    
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  };

  const handleRefreshCamera = async () => {
    const stream = await startLocalStream(true);
    if (!stream) return;
    
    if (peerConnection.current && status === 'connected') {
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      
      const videoSender = peerConnection.current.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender && videoTrack) {
        videoSender.replaceTrack(videoTrack);
      }
      
      const audioSender = peerConnection.current.getSenders().find(s => s.track?.kind === 'audio');
      if (audioSender && audioTrack) {
        audioSender.replaceTrack(audioTrack);
      }
    }
  };

  const searchingRef = useRef(false);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (status === 'searching' && !roomId && !matchAnyOpinion) {
      timeout = setTimeout(() => {
        setMatchAnyOpinion(true);
        // Restart search with new criteria
        handleSearch();
      }, 5000); // 5 seconds fallback
    }
    return () => clearTimeout(timeout);
  }, [status, roomId, matchAnyOpinion]);

  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    if (status === 'connected' && remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        console.log("Updating remote video srcObject", remoteStream.id);
        remoteVideoRef.current.srcObject = remoteStream;
      }
      
      const playPromise = remoteVideoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (e.name === 'AbortError') {
            console.log("Playback interrupted by new load, safe to ignore.");
          } else {
            console.warn("Autoplay blocked:", e);
            setAudioBlocked(true);
          }
        });
      }
    }
  }, [status, remoteStream]);

  const handleSearch = async () => {
    // START MEDIA FIRST to ensure user gesture context is preserved for iOS Safari
    const preStream = await startLocalStream();
    
    if (!auth.currentUser) {
      setTimeout(handleSearch, 500);
      return;
    }

    searchingRef.current = true;
    setStatus('searching');
    
    // Cleanup any existing search state...
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (unsubQueueRef.current) unsubQueueRef.current();
    if (unsubDebatesRef.current) unsubDebatesRef.current();

    const queueRef = collection(db, 'queue');
    const debatesRef = collection(db, 'debates');

    // 1. Join queue immediately with searching flag
    const updateQueue = async (hasMedia = false) => {
      if (!auth.currentUser || !searchingRef.current) return;
      try {
        await setDoc(doc(db, 'queue', user.uid), {
          uid: user.uid,
          opinion: profile.opinion,
          timestamp: serverTimestamp(),
          ...(roomId && { roomId }),
          searching: true,
          mediaReady: hasMedia || !!localStreamRef.current || !!preStream
        });
      } catch (error) {
        if (searchingRef.current) {
          handleFirestoreError(error, OperationType.WRITE, `queue/${user.uid}`);
        }
      }
    };

    await updateQueue();
    heartbeatRef.current = setInterval(() => updateQueue(), 2000);

    // 2. Start media in parallel
    startLocalStream().then(stream => {
      if (stream && searchingRef.current) updateQueue(true);
    });

    const cleanup = async () => {
      searchingRef.current = false;
      isTransitioningRef.current = false;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (unsubQueueRef.current) {
        unsubQueueRef.current();
        unsubQueueRef.current = null;
      }
      if (unsubDebatesRef.current) {
        unsubDebatesRef.current();
        unsubDebatesRef.current = null;
      }
      try {
        if (auth.currentUser) {
          await deleteDoc(doc(db, 'queue', user.uid));
        }
      } catch (e) {}
    };

    const onlineThreshold = 300000; // 5 minute buffer for clock skew and safety

    // 2. Listen for debates where I am a participant
    // Remove complex filters and time checks to avoid index requirements and clock-skew failures
    const debatesQ = query(
      debatesRef, 
      where('participants', 'array-contains', user.uid), 
      where('status', '==', 'active')
    );
    unsubDebatesRef.current = onSnapshot(debatesQ, (snapshot) => {
      if (!searchingRef.current || isTransitioningRef.current) return;

      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          
          // Local safety check: skip ancient sessions
          const startTime = data.startTime?.toDate()?.getTime() || Date.now();
          if (Date.now() - startTime > onlineThreshold) return;

          isTransitioningRef.current = true;
          const otherUid = data.participants?.find((id: string) => id !== user.uid);
          
          console.log("Matched into existing debate session", change.doc.id);
          setDebateId(change.doc.id);
          fetchRemoteProfile(otherUid);
          setupWebRTC(change.doc.id, false);
          setStatus('connected');
          cleanup();
        }
      });
    }, (error) => {
      if (searchingRef.current) handleFirestoreError(error, OperationType.LIST, 'debates');
    });

    const getQueueQuery = () => {
      // DUMBEST Possible Query: Avoids all index and clock-skew issues
      if (roomId) {
        return query(queueRef, where('roomId', '==', roomId));
      }
      return query(queueRef);
    };

    unsubQueueRef.current = onSnapshot(getQueueQuery(), async (snapshot) => {
      const now = Date.now();
      
      // Update queue stats for UI feedback
      const activeDocs = snapshot.docs.filter(d => {
        const lastSeen = d.data().timestamp?.toDate()?.getTime() || 0;
        return Math.abs(now - lastSeen) < 300000;
      });
      
      const activeCount = activeDocs.length;
      setQueueCount(activeCount);

      // Potential matches count (those with opposing opinion)
      const matches = activeDocs.filter(d => {
        if (d.id === user.uid) return false;
        if (matchAnyOpinion) return true;
        return d.data().opinion !== profile.opinion;
      }).length;
      setPotentialMatches(matches);
      
      if (matches === 0) {
        setEstimatedWait("> 2m");
      } else if (matches < 3) {
        setEstimatedWait("< 30s");
      } else {
        setEstimatedWait("< 10s");
      }

      if (!searchingRef.current || isTransitioningRef.current || snapshot.empty) return;

      // Filter locally for absolute reliability
      const validMatches = snapshot.docs.filter(d => {
        const data = d.data();
        const isSelf = d.id === user.uid;
        
        // Local freshness check
        const lastSeen = data.timestamp?.toDate()?.getTime() || 0;
        const isRecent = Math.abs(now - lastSeen) < 300000;
        
        // Skip people we just talked to
        const isRecentMatch = recentMatches.includes(d.id);

        if (isSelf || !isRecent || isRecentMatch) return false;
        
        if (roomId) return data.roomId === roomId;
        if (matchAnyOpinion) return true; // Open spectrum
        
        return data.opinion !== profile.opinion; // Targeted match
      });

      if (validMatches.length === 0) return;

      // Select oldest waiting person for fairness
      const match = validMatches[0];
      const matchData = match.data();
      
      console.log("Matched in queue, electing role...");
      
      if (user.uid < matchData.uid) {
        isTransitioningRef.current = true;
        try {
          console.log("Elected as caller, creating debate session...");
          const newDebateRef = await addDoc(debatesRef, {
            participants: [user.uid, matchData.uid],
            status: 'active',
            startTime: serverTimestamp(),
            aiVerifications: [],
            ...(roomId && { roomId })
          });
          
          setDebateId(newDebateRef.id);
          setRemoteProfile(matchData);
          fetchRemoteProfile(matchData.uid);
          setupWebRTC(newDebateRef.id, true);
          setStatus('connected');
          cleanup();
        } catch (error) {
          isTransitioningRef.current = false;
          if (searchingRef.current) {
            handleFirestoreError(error, OperationType.WRITE, 'debates/queue');
          }
        }
      }
    }, (error) => {
      if (searchingRef.current) handleFirestoreError(error, OperationType.LIST, 'queue');
    });
  };

  useEffect(() => {
    return () => {
      searchingRef.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (unsubQueueRef.current) unsubQueueRef.current();
      if (unsubDebatesRef.current) unsubDebatesRef.current();
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      
      if (user?.uid && auth.currentUser) {
        deleteDoc(doc(db, 'queue', user.uid)).catch(() => {});
      }
      // Global cleanup for listeners and WebRTC
      if (unsubSignalsRef.current) {
        unsubSignalsRef.current();
        unsubSignalsRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      if (peerConnection.current) {
        peerConnection.current.ontrack = null;
        peerConnection.current.onicecandidate = null;
        peerConnection.current.oniceconnectionstatechange = null;
        peerConnection.current.onsignalingstatechange = null;
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [user?.uid]);

  const fetchRemoteProfile = async (uid: string) => {
    try {
      const p = await getDoc(doc(db, 'profiles', uid));
      if (p.exists()) setRemoteProfile(p.data());
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `profiles/${uid}`);
    }
  };

  const setupWebRTC = async (id: string, isCaller: boolean) => {
    console.log("Setting up WebRTC session:", id, "Role:", isCaller ? "Caller" : "Receiver");
    if (unsubSignalsRef.current) {
      unsubSignalsRef.current();
      unsubSignalsRef.current = null;
    }

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }
    connectionTimeoutRef.current = setTimeout(() => {
      if (peerConnection.current && 
          peerConnection.current.connectionState !== 'connected' && 
          peerConnection.current.connectionState !== 'closed') {
        console.warn("WebRTC Connection Timeout - Peer unreachable");
        setConnectionState('failed');
        setWebrtcError(t('app.webrtc_error_timeout'));
      }
    }, 25000); // 25s timeout for handshake

    const stream = localStreamRef.current || await startLocalStream();
    if (!stream) {
      console.error("Failed to acquire local stream for WebRTC");
      return;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.rixos.com' },
        { urls: 'stun:stun.schlund.de' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ],
      bundlePolicy: 'max-compat',
      iceCandidatePoolSize: 10
    });
    peerConnection.current = pc;

    const remoteMediaStream = new MediaStream();
    setRemoteStream(remoteMediaStream);

    pc.ontrack = (event) => {
      console.log("Remote track received:", event.track.kind, event.track.id);
      setWebrtcStatus(`Receiving ${event.track.kind} feed`);
      
      const track = event.track;
      if (!remoteMediaStream.getTracks().find(t => t.id === track.id)) {
        remoteMediaStream.addTrack(track);
      }

      // Update state with a NEW stream object to force React to update video srcObject
      setRemoteStream(new MediaStream(remoteMediaStream.getTracks()));

      track.onunmute = () => {
        console.log(`Remote ${track.kind} track unmuted`);
        if (track.kind === 'audio') setRemoteAudioEnabled(true);
        if (track.kind === 'video') setRemoteVideoEnabled(true);
        setRemoteStream(new MediaStream(remoteMediaStream.getTracks()));
      };

      track.onmute = () => {
        console.log(`Remote ${track.kind} track muted`);
        if (track.kind === 'audio') setRemoteAudioEnabled(false);
        if (track.kind === 'video') setRemoteVideoEnabled(false);
      };
    };

    // Explicitly add tracks to peer connection
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    const signalsRef = collection(db, 'debates', id, 'signals');
    const signalQueue: any[] = [];
    const iceCandidateQueue: RTCIceCandidateInit[] = [];
    let isProcessingSignals = false;

    const processSignalQueue = async () => {
      if (!pc || isProcessingSignals || signalQueue.length === 0) return;
      isProcessingSignals = true;

      while (signalQueue.length > 0) {
        const data = signalQueue.shift();
        if (!pc || pc.signalingState === 'closed') break;

        try {
          const signal = JSON.parse(data.data);
          console.log(`Processing signal: ${data.type} from ${data.senderId}`);

          if (data.type === 'offer') {
            if (pc.signalingState !== 'stable') {
              console.warn("Received offer in non-stable state, attempting to resync");
              // If we are a caller and get an offer, we might have a collision. 
              // Simple resolution: caller keeps its offer if priority is higher, but here we just try to set it.
            }
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await addDoc(signalsRef, {
              type: 'answer',
              data: JSON.stringify(answer),
              senderId: user.uid,
              timestamp: serverTimestamp()
            });

            // Process queued candidates now that we have a remote description
            while (iceCandidateQueue.length > 0) {
              const candidate = iceCandidateQueue.shift();
              if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
          } else if (data.type === 'answer') {
            if (pc.signalingState !== 'have-local-offer') {
               console.warn("Received answer in unexpected state:", pc.signalingState);
               return; 
            }
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            // Process queued candidates now that we have a remote description
            while (iceCandidateQueue.length > 0) {
              const candidate = iceCandidateQueue.shift();
              if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
          } else if (data.type === 'candidate') {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(signal));
            } else {
              console.log("Queueing ICE candidate - remote description not yet set");
              iceCandidateQueue.push(signal);
            }
          }
        } catch (err) {
          console.error("WebRTC Protocol Fault:", err);
          setWebrtcError(t('app.webrtc_error_signaling'));
        }
      }
      isProcessingSignals = false;
    };

    // Process signals in local priority order (Offers must precede Candidates)
    const unsubscribeSignals = onSnapshot(signalsRef, (snapshot) => {
      const typePriority: Record<string, number> = { 'offer': 0, 'answer': 1, 'candidate': 2 };
      
      const docs = snapshot.docChanges()
        .filter(change => change.type === 'added')
        .map(change => change.doc.data())
        .sort((a, b) => {
          const tA = (a.timestamp as any)?.toMillis() || Date.now();
          const tB = (b.timestamp as any)?.toMillis() || Date.now();
          
          if (tA !== tB) return tA - tB;
          // Sub-timestamp priority: Offer > Answer > Candidate
          return (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9);
        });

      docs.forEach(data => {
        if (data.senderId !== user.uid) {
          signalQueue.push(data);
        }
      });
      processSignalQueue();
    });

    unsubSignalsRef.current = unsubscribeSignals;

    pc.onsignalingstatechange = () => {
      console.log("WebRTC Signaling State:", pc.signalingState);
      const states: Record<string, string> = {
        'stable': 'Handshake Stable',
        'have-local-offer': 'Transmitting Protocols',
        'have-remote-offer': 'Synchronizing Remote Protocols',
        'have-local-pranswer': 'Finalizing Handshake',
        'have-remote-pranswer': 'Confirming Handshake'
      };
      setWebrtcStatus(states[pc.signalingState] || pc.signalingState);
    };

    pc.onicegatheringstatechange = () => {
      console.log("ICE Gathering State:", pc.iceGatheringState);
      if (pc.iceGatheringState === 'gathering') {
        setWebrtcStatus('Discovering optimized route');
      }
    };

    pc.onicecandidateerror = (event) => {
      console.warn("ICE Candidate Error:", event.url, event.errorCode, event.errorText);
      if (event.errorCode >= 700 && event.errorCode <= 799) {
        setWebrtcStatus('STUN/TURN relay restricted');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("WebRTC Peer Connection State:", pc.connectionState);
      const states: Record<string, string> = {
        'new': 'Initializing Session',
        'connecting': 'Securing DTLS Handshake',
        'connected': 'Secure Link Active',
        'disconnected': 'Peer Link Interrupted',
        'failed': 'Connection Fault',
        'closed': 'Session Terminated'
      };
      setWebrtcStatus(states[pc.connectionState] || pc.connectionState);
    };

    // Stats polling for real latency tracking and quality
    let lastBytes = 0;
    let lastTime = 0;

    statsIntervalRef.current = setInterval(async () => {
      if (!pc || (pc.iceConnectionState !== 'connected' && pc.connectionState !== 'connected')) return;
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
            setLatency(Math.round(report.currentRoundTripTime * 1000));
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const now = Date.now();
            const bytes = report.bytesReceived;
            if (lastTime > 0) {
              const delta = (bytes - lastBytes) * 8 / (now - lastTime); // kbps
              setBitrate(Math.round(delta));
            }
            lastBytes = bytes;
            lastTime = now;
            
            if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
              const loss = (report.packetsLost / (report.packetsLost + report.packetsReceived)) * 100;
              setPacketLoss(loss);
            }
          }
        });
      } catch (e) {}
    }, 2000);

    pc.oniceconnectionstatechange = () => {
      console.log("ICE Connectivity Status:", pc.iceConnectionState);
      setConnectionState(pc.iceConnectionState);
      
      const iceStates: Record<string, string> = {
        'new': 'Initializing network path',
        'checking': 'Analyzing peer network',
        'connected': 'Network path secured',
        'completed': 'Optimized route found',
        'failed': 'Network relay failure',
        'disconnected': 'Path interrupted'
      };
      setWebrtcStatus(iceStates[pc.iceConnectionState] || pc.iceConnectionState);

      if (pc.iceConnectionState === 'connected') {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      } else if (pc.iceConnectionState === 'failed') {
        console.warn("ICE Connection Failed - Peer unreachable via STUN. Attempting restart...");
        setWebrtcError(t('app.webrtc_error_ice'));
        pc.restartIce();
      }
    };

    // Remove redudant onconnectionstatechange previously at line 904
    // pc.onconnectionstatechange is already handled above with more detail.

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(signalsRef, {
          type: 'candidate',
          data: JSON.stringify(event.candidate),
          senderId: user.uid,
          timestamp: serverTimestamp()
        }).catch(err => console.error("Signal relay failure:", err));
      }
    };

    let isNegotiating = false;
    pc.onnegotiationneeded = async () => {
      if (!isCaller || isNegotiating) return;
      isNegotiating = true;
      try {
        if (pc.signalingState !== 'stable') return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await addDoc(signalsRef, {
          type: 'offer',
          data: JSON.stringify(offer),
          senderId: user.uid,
          timestamp: serverTimestamp()
        });
      } catch (err) {
        console.error("Negotiation failed:", err);
      } finally {
        isNegotiating = false;
      }
    };
  };

  const handleSkip = async () => {
    if (remoteProfile?.uid) {
      setRecentMatches(prev => [...prev, remoteProfile.uid].slice(-5));
    }
    searchingRef.current = false;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (unsubQueueRef.current) {
      unsubQueueRef.current();
      unsubQueueRef.current = null;
    }
    if (unsubDebatesRef.current) {
      unsubDebatesRef.current();
      unsubDebatesRef.current = null;
    }
    
    try {
      if (auth.currentUser) {
        await deleteDoc(doc(db, 'queue', user.uid));
      }
    } catch (e) {}

    if (debateId) {
      try {
        const debateRef = doc(db, 'debates', debateId);
        await updateDoc(debateRef, { status: 'ended' });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `debates/${debateId}`);
      }
      setDebateId(null);
    }
    
    setRemoteProfile(null);
    setRemoteStream(null);
    setVerifying(false);
    setStatus('idle');
    
    if (peerConnection.current) {
      peerConnection.current.ontrack = null;
      peerConnection.current.onicecandidate = null;
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (unsubSignalsRef.current) {
      unsubSignalsRef.current();
      unsubSignalsRef.current = null;
    }
    setDebateId(null);
    setRemoteProfile(null);
    setRemoteStream(null);
    setStatus('idle');
    setMatchAnyOpinion(false); // Reset fallback on skip
  };

  const handleVerify = async (text: string) => {
    setVerifying(true);
    try {
      const result = await verifyClaim(text);
      if (debateId) {
        const debateRef = doc(db, 'debates', debateId);
        const debateDoc = await getDoc(debateRef);
        const verifications = debateDoc.data()?.aiVerifications || [];
        
        await updateDoc(debateRef, {
          aiVerifications: [...verifications, { claim: text, verification: result, timestamp: new Date().toISOString() }]
        });
      }
    } catch (error) {
      if (debateId) {
        handleFirestoreError(error, OperationType.UPDATE, `debates/${debateId}`);
      } else {
        console.error("Verification error:", error);
      }
    }
    setVerifying(false);
  };

  const handleReport = async () => {
    if (!remoteProfile || reportReason.length < 20) return;
    try {
      let debateContext = null;
      if (debateId) {
        const debateRef = doc(db, 'debates', debateId);
        const debateDoc = await getDoc(debateRef);
        if (debateDoc.exists()) {
          const data = debateDoc.data();
          debateContext = {
            debateId: debateId,
            suggestedTopic: suggestedTopic,
            claims: (data.aiVerifications || []).slice(-10), // Capture last 10 claims for context
            participants: data.participants,
            startTime: data.startTime,
            roomId: data.roomId || 'global'
          };
        }
      }

      await addDoc(collection(db, 'reports'), {
        reporterId: user.uid,
        reportedId: remoteProfile.uid,
        reason: reportReason,
        timestamp: serverTimestamp(),
        debateId: debateId,
        debateContext: debateContext,
        reporterSnapshot: {
          displayName: profile.displayName,
          opinion: profile.opinion
        },
        reportedSnapshot: {
          displayName: remoteProfile.displayName,
          opinion: remoteProfile.opinion
        }
      });
      setShowReportModal(false);
      setReportReason('');
      handleSkip();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'reports');
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col lg:grid lg:grid-cols-12 gap-2 lg:gap-6 p-1 md:p-8 bg-zinc-100 dark:bg-zinc-950">
      <div className="flex-[5] lg:col-span-8 flex flex-col gap-2 lg:gap-6 min-h-0">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 lg:gap-4 relative min-h-0">
          {/* Topic Insight Overlay - Simplified for mobile */}
          {status === 'connected' && (
            <div className="absolute top-2 start-1/2 -translate-x-1/2 z-40">
              <button 
                onClick={handleSuggestTopic}
                disabled={suggestingTopic}
                className="px-4 py-2 flex items-center gap-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 rounded-full shadow-lg"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${suggestingTopic ? 'animate-spin' : ''}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{t('app.suggest_topic')}</span>
              </button>
            </div>
          )}

          <AnimatePresence>
            {suggestedTopic && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute top-12 left-1/2 -translate-x-1/2 z-[60] w-full max-w-sm px-4"
              >
                <div className="bg-white dark:bg-zinc-900 p-6 border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/30 dark:shadow-zinc-950/80 rounded-minimal relative overflow-hidden">
                  <div className="absolute top-0 end-0 w-16 h-16 bg-brand-accent/5 blur-xl rounded-full translate-x-1/2 -translate-y-1/2" />
                  <p className="text-[9px] font-bold text-brand-accent/60 uppercase tracking-[0.3em] mb-3">{t('app.contextual_prompt')}</p>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 leading-relaxed italic">"{suggestedTopic}"</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* User Side */}
          <div className={`video-container group bg-white dark:bg-zinc-900 shadow-sm relative transition-all duration-700 border-2 ${qualityStats.color} ${qualityStats.shadow}`}>
            {cameraError && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-zinc-900 p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 flex items-center justify-center rounded-minimal shadow-sm">
                  <AlertCircle className="w-6 h-6 text-rose-500" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-zinc-900 uppercase tracking-widest">{t('app.camera_error')}</p>
                  <p className="text-[10px] text-zinc-400 max-w-[280px] leading-relaxed italic">{cameraError}</p>
                </div>
                <button 
                  onClick={() => {
                    setCameraError(null);
                    handleRefreshCamera();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-accent/5 border border-brand-accent/20 text-[9px] font-black uppercase tracking-widest text-brand-accent hover:bg-brand-accent hover:text-white transition-all rounded-minimal mt-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  {t('app.retry_access')}
                </button>
              </div>
            )}
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover mirror opacity-90" />
            
            {isCameraOff && (
              <div className="absolute inset-0 bg-white/50 dark:bg-zinc-900/50 flex flex-col items-center justify-center">
                <CameraOff className="w-10 h-10 text-zinc-200 dark:text-zinc-800" />
                <p className="text-meta mt-4 text-zinc-300 dark:text-zinc-700">{t('app.visual_feed_suspended')}</p>
              </div>
            )}

            <div className="absolute bottom-2 md:bottom-6 start-2 md:start-6 flex items-center gap-2 md:gap-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md p-2 md:p-3 border border-zinc-200 dark:border-zinc-800 rounded-minimal shadow-lg dark:shadow-zinc-950/50">
              <div className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-ping shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-zinc-900 uppercase tracking-wider">{user.displayName?.split(' ')[0]}</span>
                <span className="text-[9px] text-zinc-400 uppercase tracking-widest">{latency}ms</span>
              </div>
            </div>
            
            {isMuted && (
              <div className="absolute top-6 end-6 p-2 bg-rose-950/30 border border-rose-900/50 rounded-minimal">
                <MicOff className="w-3.5 h-3.5 text-rose-500" />
              </div>
            )}
          </div>

          {/* Remote Feed Unit */}
          <div className={`video-container group bg-white dark:bg-zinc-900 shadow-sm transition-all duration-700 border-2 ${qualityStats.color} ${qualityStats.shadow}`}>
            {status === 'connected' ? (
              <>
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover opacity-90" />
                
                <div className="absolute top-6 left-6 z-30 flex items-center gap-3">
                  <div className="px-3 py-1.5 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-md dark:shadow-zinc-950/50 rounded-minimal flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-brand-accent animate-pulse shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                    <span className="text-[8px] font-black text-brand-accent uppercase tracking-[0.2em]">{t('app.encrypted_node')}</span>
                  </div>

                  {latency > 0 && (
                    <div className="px-3 py-1.5 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-md dark:shadow-zinc-950/50 rounded-minimal flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <Signal className={`w-3 h-3 ${latency < 100 ? 'text-emerald-500' : latency < 300 ? 'text-brand-accent' : 'text-rose-500'}`} />
                        <span className={`text-[10px] font-mono font-bold ${latency > 250 ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {latency}ms
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                
                {connectionState !== 'connected' && connectionState !== 'failed' && connectionState !== 'disconnected' && (
                  <div className="absolute inset-0 z-20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                      <div className="w-12 h-12 border-2 border-brand-accent/10 rounded-full animate-ping absolute inset-0" />
                      <div className="w-12 h-12 border-2 border-t-brand-accent border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-[10px] font-black text-brand-accent uppercase tracking-[0.3em] animate-pulse">
                        {webrtcStatus && webrtcStatus !== 'Idle' ? webrtcStatus : t('app.connecting_to_peer')}
                      </p>
                      {stuckConnecting && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
                          <p className="text-[9px] text-zinc-400 uppercase tracking-widest mb-4 italic">Handshake taking longer than expected...</p>
                          <button 
                            onClick={handleSkip}
                            className="px-4 py-2 bg-brand-accent/5 border border-brand-accent/20 text-[9px] font-black uppercase tracking-widest text-brand-accent hover:bg-brand-accent hover:text-white transition-all rounded-minimal"
                          >
                            Restart Connection
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <AnimatePresence>
                  {showMatchIntro && connectionState === 'connected' && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      className="absolute inset-0 z-30 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md flex items-center justify-center p-12 pointer-events-none"
                    >
                      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
                        <motion.div 
                          initial={{ y: 20 }}
                          animate={{ y: 0 }}
                          className="w-16 h-16 bg-brand-accent/20 border border-brand-accent/40 rounded-full flex items-center justify-center shadow-lg shadow-brand-accent/20"
                        >
                          <Shield className="w-8 h-8 text-brand-accent" />
                        </motion.div>
                        <div className="space-y-2">
                          <p className="text-[10px] text-brand-accent font-black uppercase tracking-[0.3em]">{t('app.initialize_session')}</p>
                          <h2 className="text-3xl font-black text-zinc-900 italic tracking-tighter uppercase">{remoteProfile?.displayName}</h2>
                          <div className="inline-block px-4 py-2 bg-brand-accent text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-minimal mt-4 shadow-lg shadow-brand-accent/20">
                            {t(`app.opinions.${remoteProfile?.opinion?.toLowerCase().replace(' ', '_')}`)}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(connectionState === 'failed' || connectionState === 'disconnected') && (
                  <div className="absolute inset-0 z-40 bg-zinc-100/90 dark:bg-zinc-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
                    <div className="w-14 h-14 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 flex items-center justify-center rounded-minimal mb-6 shadow-sm">
                      <AlertCircle className="w-7 h-7 text-rose-500" />
                    </div>
                    <div className="space-y-2 mb-8">
                      <p className="text-sm font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-widest">{t('app.webrtc_error_title')}</p>
                      <p className="text-[10px] text-zinc-400 max-w-[280px] leading-relaxed italic">
                        {webrtcError || (connectionState === 'failed' ? t('app.webrtc_error_ice') : t('app.webrtc_error_disconnected'))}
                      </p>
                    </div>
                    <div className="bg-white dark:bg-zinc-900/80 p-6 border border-zinc-200 dark:border-zinc-800 rounded-minimal w-full max-w-sm space-y-4 shadow-sm">
                      <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em]">{t('app.webrtc_troubleshoot')}</p>
                      <ul className="text-[10px] text-zinc-400 space-y-3 text-start">
                        <li className="flex gap-3">
                          <CheckCircle className="w-3 h-3 text-brand-accent shrink-0 mt-0.5" />
                          <span>{t('app.webrtc_action_refresh')}</span>
                        </li>
                        <li className="flex gap-3">
                          <CheckCircle className="w-3 h-3 text-brand-accent shrink-0 mt-0.5" />
                          <span>{t('app.webrtc_action_vpn')}</span>
                        </li>
                        <li className="flex gap-3">
                          <CheckCircle className="w-3 h-3 text-brand-accent shrink-0 mt-0.5" />
                          <span>{t('app.webrtc_action_internet')}</span>
                        </li>
                      </ul>
                    </div>
                    <button 
                      onClick={handleSkip}
                      className="mt-8 px-6 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-brand-accent hover:border-brand-accent transition-all rounded-minimal shadow-sm"
                    >
                      {t('app.disconnect')}
                    </button>
                  </div>
                )}

                <div className="absolute bottom-2 md:bottom-6 start-2 md:start-6 flex items-center gap-2 md:gap-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md p-2 md:p-4 border border-zinc-200 dark:border-zinc-800 rounded-minimal shadow-2xl group-hover:border-brand-accent/30 transition-all">
                  <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-brand-accent shadow-[0_0_8px_rgba(37,99,235,0.4)]' : 'bg-zinc-100 dark:bg-zinc-800 animate-pulse'}`} />
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-wider">{remoteProfile?.displayName}</span>
                    <span className="text-[10px] font-bold text-brand-accent/80 uppercase tracking-[0.15em]">
                      {t(`app.opinions.${remoteProfile?.opinion?.toLowerCase().replace(' ', '_')}`)}
                    </span>
                  </div>
                </div>

                {!remoteAudioEnabled && (
                  <div className="absolute top-6 start-6 flex items-center gap-2 bg-brand-accent/10 p-2 border border-brand-accent/20 rounded-minimal">
                    <MicOff className="w-3.5 h-3.5 text-brand-accent" />
                    <span className="text-[9px] font-bold text-brand-accent uppercase tracking-widest">{t('app.muted')}</span>
                  </div>
                )}

                {audioBlocked && (
                  <button 
                    onClick={() => {
                      remoteVideoRef.current?.play();
                      setAudioBlocked(false);
                    }}
                    className="absolute inset-0 z-50 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-sm flex flex-col items-center justify-center gap-4 group"
                  >
                    <div className="w-16 h-16 bg-brand-accent text-white rounded-full flex items-center justify-center animate-bounce shadow-xl group-hover:scale-110 transition-transform">
                      <Volume2 className="w-8 h-8" />
                    </div>
                    <span className="text-xs font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-widest bg-white dark:bg-zinc-900 px-4 py-2 rounded-full border border-zinc-200 dark:border-zinc-800 shadow-sm">
                      Click to Enable Audio
                    </span>
                  </button>
                )}

                {profile.isAdmin && remoteProfile && (
                  <button 
                    onClick={() => setShowModerateModal(true)}
                    className="absolute top-6 right-20 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-brand-accent hover:text-white transition-all text-zinc-400 dark:text-zinc-500 rounded-minimal shadow-sm"
                    title={t('app.moderate')}
                  >
                    <Gavel className="w-4 h-4" />
                  </button>
                )}

                <button 
                  onClick={() => setShowReportModal(true)}
                  className="absolute top-6 right-6 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-rose-500 hover:text-white transition-all text-zinc-400 dark:text-zinc-500 rounded-minimal shadow-sm"
                >
                  <Flag className="w-4 h-4" />
                </button>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-100/50 dark:bg-zinc-950/50">
                {status === 'searching' ? (
                  <div className="flex flex-col items-center gap-6 md:gap-12 text-center">
                    <div className="relative flex items-center justify-center">
                      <motion.div 
                        animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                        className="absolute w-16 h-16 border border-brand-accent/20 rounded-full"
                      />
                      <motion.div 
                        animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
                        className="absolute w-16 h-16 border border-brand-accent/20 rounded-full"
                      />
                      
                      <div className="relative w-16 h-16 border-2 border-zinc-200 dark:border-zinc-800 rounded-full flex items-center justify-center overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-0 origin-center"
                          style={{ 
                            background: 'conic-gradient(from 0deg, transparent 70%, rgba(37,99,235,0.2) 100%)' 
                          }}
                        />
                        
                        <motion.div
                          animate={{ 
                            opacity: [0, 1, 0],
                            x: [10, -5, 15],
                            y: [-10, 10, -5]
                          }}
                          transition={{ duration: 4, repeat: Infinity }}
                          className="absolute w-1 h-1 bg-brand-accent rounded-full shadow-[0_0_5px_rgba(37,99,235,1)]"
                        />
                        
                        <Users className="w-5 h-5 text-zinc-300 dark:text-zinc-700 relative z-10" />
                      </div>
                    </div>
                    <div>
                      <p className="text-meta text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest">{t('app.looking_for_match')}</p>
                      <motion.p 
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="text-[9px] text-zinc-300 dark:text-zinc-700 uppercase tracking-[0.2em] mt-3 italic"
                      >
                        {t('app.handshaking')}
                      </motion.p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 md:gap-8">
                    <div className="w-16 h-16 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center rounded-minimal shadow-sm">
                      <Video className="w-8 h-8 text-zinc-200 dark:text-zinc-800" />
                    </div>
                    <button 
                      onClick={handleSearch}
                      className="btn-primary"
                    >
                      {t('app.find_discussion')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Global Controls */}
        <div className="bg-white dark:bg-zinc-900/60 p-4 md:p-6 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 md:gap-4 rounded-minimal shadow-sm transition-colors shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex gap-2">
              <button 
                onClick={() => setIsMuted(!isMuted)}
                className={`p-4 border transition-all rounded-minimal relative ${
                  isMuted 
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20 text-rose-500' 
                    : isSpeaking 
                      ? 'bg-brand-accent border-brand-accent text-white shadow-lg shadow-brand-accent/20 animate-pulse'
                      : 'bg-brand-accent/5 dark:bg-brand-accent/10 border-brand-accent/20 dark:border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white'
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                {isSpeaking && !isMuted && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-brand-accent rounded-full border-2 border-zinc-200/50 dark:border-zinc-950" />
                )}
              </button>
              <button 
                onClick={() => setIsCameraOff(!isCameraOff)}
                className={`p-4 border transition-all rounded-minimal ${
                  isCameraOff 
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20 text-rose-500' 
                    : 'bg-brand-accent/5 dark:bg-brand-accent/10 border-brand-accent/20 dark:border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white'
                }`}
              >
                {isCameraOff ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
              </button>
            </div>

            <div className="h-8 w-[1px] bg-zinc-100 dark:bg-zinc-800 mx-1 md:mx-2" />

            <button 
              onClick={handleRefreshCamera}
              className="p-4 bg-brand-accent/5 dark:bg-brand-accent/10 border border-brand-accent/20 dark:border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white transition-all rounded-minimal"
            >
              <RefreshCw className="w-5 h-5" />
            </button>

            <div className="relative">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-3 md:p-4 border transition-all rounded-minimal ${
                  showSettings 
                    ? 'bg-brand-accent text-white border-brand-accent shadow-sm' 
                    : 'bg-brand-accent/5 dark:bg-brand-accent/10 border-brand-accent/20 dark:border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              <AnimatePresence>
                {showSettings && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full mb-6 left-0 w-72 bg-zinc-50 dark:bg-black border border-zinc-200/50 dark:border-zinc-900 p-8 shadow-2xl z-50 space-y-8 rounded-minimal transition-colors"
                  >
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-meta">{t('app.camera_source')}</label>
                        <select 
                          value={selectedVideo} 
                          onChange={(e) => {
                            setSelectedVideo(e.target.value);
                            handleRefreshCamera();
                          }}
                          className="w-full bg-zinc-50 dark:bg-black border border-zinc-100 dark:border-zinc-900 px-4 py-3 text-xs font-bold text-zinc-400 dark:text-zinc-500 outline-none appearance-none rounded-minimal"
                        >
                          {devices.filter(d => d.kind === 'videoinput').map(d => (
                            <option key={d.deviceId} value={d.deviceId} className="bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-50">{d.label || 'Standard Feed'}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-3">
                        <label className="text-meta">{t('app.audio_source')}</label>
                        <select 
                          value={selectedAudio} 
                          onChange={(e) => {
                            setSelectedAudio(e.target.value);
                            handleRefreshCamera();
                          }}
                          className="w-full bg-zinc-50 dark:bg-black border border-zinc-100 dark:border-zinc-900 px-4 py-3 text-xs font-bold text-zinc-400 dark:text-zinc-500 outline-none appearance-none rounded-minimal"
                        >
                          {devices.filter(d => d.kind === 'audioinput').map(d => (
                            <option key={d.deviceId} value={d.deviceId} className="bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-50">{d.label || 'Standard Mic'}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {status !== 'idle' && (
              <button 
                onClick={handleSkip}
                className="btn-minimal border-rose-100 dark:border-rose-500/20 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:border-rose-200 dark:hover:border-rose-500/30 transition-all px-6 py-2 text-[10px] uppercase font-black"
              >
                {t('app.terminate_session')}
              </button>
            )}
            {status === 'idle' && (
              <button 
                onClick={handleSearch}
                className="btn-primary"
              >
                {t('app.find_discussion')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-[4] lg:col-span-4 flex flex-col gap-4 lg:gap-6 min-h-0 transition-colors">
        <div className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 rounded-minimal shadow-lg dark:shadow-zinc-950/50 overflow-hidden">
          <div className="p-3 md:p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-100/50 dark:bg-zinc-900/50 rounded-t-minimal">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-zinc-300 dark:text-zinc-700" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">{t('app.analyst_link')}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-bold text-zinc-300 dark:text-zinc-700 uppercase tracking-widest">{t('app.active')}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-brand-accent shadow-sm" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-white dark:bg-zinc-900">
            <AnimatePresence mode="popLayout">
              {debateId && (
                <AIClaimsList debateId={debateId} isVerifying={verifying} />
              )}
            </AnimatePresence>
          </div>

          <div className="p-3 md:p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
            <div className="relative">
              <input 
                type="text" 
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleVerify(inputMessage)}
                placeholder={t('app.log_claim')}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-5 py-4 text-xs font-bold focus:border-brand-accent/50 outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 pr-12 rounded-minimal shadow-md dark:shadow-zinc-950/20"
              />
              <button 
                onClick={() => {
                  handleVerify(inputMessage);
                  setInputMessage('');
                }}
                disabled={verifying || !inputMessage}
                className="absolute right-2 top-2 bottom-2 px-3 text-zinc-400 hover:text-brand-accent transition-all disabled:opacity-30"
              >
                {verifying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-zinc-100/90 dark:bg-zinc-950/90 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 max-w-md w-full p-10 space-y-8 rounded-minimal shadow-2xl"
            >
              <div className="text-center space-y-3">
                <Shield className="w-8 h-8 text-zinc-100 dark:text-zinc-800 mx-auto" />
                <h3 className="text-xl font-bold uppercase tracking-tighter text-zinc-900 dark:text-zinc-50">{t('app.report')}</h3>
                <p className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase tracking-widest leading-loose">{t('app.protocol_review')}</p>
              </div>

              <div className="space-y-6">
                <textarea 
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder={t('app.report_placeholder')}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-6 py-5 text-xs font-bold focus:border-brand-accent/50 outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-200 dark:placeholder:text-zinc-800 min-h-[120px] resize-none rounded-minimal shadow-sm"
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => {
                      setShowReportModal(false);
                      setReportReason('');
                    }}
                    className="btn-minimal px-4 py-2 border border-zinc-100 dark:border-zinc-900 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all rounded-minimal"
                  >
                    {t('app.cancel')}
                  </button>
                  <button 
                    onClick={handleReport}
                    disabled={reportReason.length < 20}
                    className="bg-brand-accent text-white text-[10px] font-bold uppercase tracking-widest py-3 hover:brightness-110 disabled:opacity-20 rounded-minimal shadow-lg shadow-brand-accent/10"
                  >
                    {t('app.submit_report')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModerateModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-zinc-100/95 dark:bg-zinc-950/95 backdrop-blur-xl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 max-w-lg w-full p-12 space-y-10 rounded-minimal shadow-2xl"
            >
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-brand-accent/10 border border-brand-accent/20 rounded-minimal flex items-center justify-center">
                  <Gavel className="w-8 h-8 text-brand-accent" />
                </div>
                <div className="text-left">
                  <h3 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-zinc-50">{t('app.ban_user')}</h3>
                  <p className="text-zinc-400 dark:text-zinc-600 text-[10px] font-bold uppercase tracking-widest mt-1">Admin Moderation Protocol Active</p>
                </div>
              </div>

              <div className="space-y-8">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-widest pl-1">
                    <Clock className="w-3 h-3 text-brand-accent" />
                    {t('app.ban_duration')}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { val: 0.5, label: t('app.ban_durations.30m') },
                      { val: 1, label: t('app.ban_durations.1h') },
                      { val: 24, label: t('app.ban_durations.24h') },
                      { val: -1, label: t('app.ban_durations.perm') }
                    ].map(d => (
                      <button 
                        key={d.val}
                        onClick={() => setBanDuration(d.val)}
                        className={`py-4 rounded-minimal border text-[10px] font-black uppercase tracking-widest transition-all ${
                          banDuration === d.val 
                            ? 'bg-brand-accent text-white border-brand-accent shadow-lg shadow-brand-accent/20' 
                            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-widest pl-1">
                    <ShieldAlert className="w-3 h-3 text-rose-500" />
                    {t('app.ban_reason')}
                  </label>
                  <textarea 
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    placeholder="Enter policy violation context..."
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-6 py-5 text-xs font-bold focus:border-brand-accent/50 outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-200 dark:placeholder:text-zinc-800 min-h-[100px] resize-none rounded-minimal shadow-sm"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-6 pt-4">
                  <button 
                    onClick={() => {
                      setShowModerateModal(false);
                      setBanReason('');
                    }}
                    className="btn-minimal py-5 border border-zinc-100 dark:border-zinc-900 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-minimal"
                  >
                    {t('app.cancel')}
                  </button>
                  <button 
                    onClick={handleBan}
                    disabled={!banReason}
                    className="w-full bg-rose-600 text-white font-black py-5 rounded-minimal transition-all hover:bg-rose-500 active:scale-[0.98] disabled:opacity-20 disabled:grayscale uppercase tracking-[0.3em] text-[10px] shadow-xl shadow-rose-900/20 flex items-center justify-center gap-3"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    {t('app.execute_ban')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSummaryModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-zinc-100/95 dark:bg-zinc-950/95 backdrop-blur-xl">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 max-w-2xl w-full p-12 space-y-12 max-h-[90vh] overflow-y-auto custom-scrollbar rounded-minimal shadow-2xl"
            >
              <div className="text-center space-y-4">
                <CheckCircle className="w-10 h-10 text-brand-accent mx-auto" />
                <h3 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50 uppercase italic">{t('app.protocol_concluded')}</h3>
                <p className="text-zinc-400 dark:text-zinc-500 text-xs uppercase tracking-[0.2em]">{t('app.archived_insights')} {debateSummary?.opponent}.</p>
              </div>

              <div className="space-y-10">
                <div className="space-y-6">
                  <h4 className="text-meta flex items-center gap-3">
                    <Shield className="w-3 h-3 text-brand-accent/50" />
                    {t('app.fact_check_repo')}
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    {debateSummary?.verifications.map((v: any, i: number) => (
                      <div key={i} className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4 rounded-minimal shadow-sm">
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">"{v.claim}"</p>
                        <div className="flex gap-4 items-start border-t border-zinc-200 dark:border-zinc-800 pt-4">
                          <div className="mt-1.5 w-1 h-1 bg-zinc-200 dark:bg-zinc-700 shrink-0" />
                          <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed font-medium">{v.verification}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-zinc-100 dark:border-zinc-900 text-center space-y-8">
                  <p className="text-xs font-bold text-zinc-300 dark:text-zinc-700 uppercase tracking-widest">{t('app.perspective_integration')}</p>
                  <div className="flex flex-wrap justify-center gap-4">
                    {[
                      { id: 'integrated_shift', label: t('app.integrated_shift') },
                      { id: 'partial_nuance', label: t('app.partial_nuance') },
                      { id: 'no_delta', label: t('app.no_delta') }
                    ].map((opt) => (
                      <button 
                        key={opt.id}
                        onClick={() => setShowSummaryModal(false)}
                        className="btn-minimal px-8 py-3 border border-zinc-100 dark:border-zinc-900 text-zinc-400 dark:text-zinc-500 hover:text-brand-accent hover:border-brand-accent rounded-minimal transition-all"
                      >
                       {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AIClaimsListProps {
  debateId: string;
  isVerifying: boolean;
}

function AIClaimsList({ debateId, isVerifying }: AIClaimsListProps) {
  const { t } = useTranslation();
  const [verifications, setVerifications] = useState<any[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!debateId) return;
    
    setVerifications([]);
    
    const unsubscribe = onSnapshot(doc(db, 'debates', debateId), async (docSnapshot) => {
      if (!auth.currentUser) return;
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        setVerifications(data.aiVerifications || []);
      }
    }, (error) => {
      if (auth.currentUser) {
        handleFirestoreError(error, OperationType.GET, `debates/${debateId}`);
      }
    });
    
    return () => unsubscribe();
  }, [debateId]);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const formatTimestamp = (ts: string) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <div className="flex flex-col-reverse gap-6">
        {verifications.map((v, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="group space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0 mt-1 rounded-minimal shadow-sm">
                  <MessageSquare className="w-3 h-3 text-brand-accent/50" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-50 tracking-tight leading-relaxed">"{v.claim}"</p>
                  {v.timestamp && (
                    <div className="flex items-center gap-1.5 text-[8px] font-bold text-zinc-300 dark:text-zinc-700 uppercase tracking-widest">
                      <Clock className="w-2 h-2" />
                      {formatTimestamp(v.timestamp)}
                    </div>
                  )}
                </div>
              </div>
              <button 
                onClick={() => handleCopy(v.claim, i)}
                className="p-2 text-zinc-300 dark:text-zinc-700 hover:text-brand-accent transition-all opacity-0 group-hover:opacity-100"
                title="Copy claim"
              >
                {copiedIndex === i ? <CheckCircle className="w-3 h-3 text-brand-success" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            
            <div className="bg-zinc-100/50 dark:bg-zinc-950/30 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 rounded-minimal shadow-md dark:shadow-zinc-950/20 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-brand-accent/20" />
              <div className="flex items-center gap-3">
                <div className="w-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                <span className="text-[8px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-[0.3em]">{t('app.ai_analysis')}</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-regular">{v.verification}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {isVerifying && (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 flex items-center gap-4 rounded-minimal shadow-sm mt-4"
        >
          <RefreshCw className="w-4 h-4 text-brand-accent animate-spin" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-50">{t('app.extracting_data')}</p>
            <p className="text-[9px] font-bold text-zinc-300 dark:text-zinc-700 uppercase tracking-widest mt-1">{t('app.cross_referencing')}</p>
          </div>
        </motion.div>
      )}

      {verifications.length === 0 && !isVerifying && (
        <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-20 opacity-30">
          <Shield className="w-8 h-8 text-white dark:text-zinc-800 drop-shadow-sm" />
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-300 dark:text-zinc-700">{t('app.system_standby')}</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-zinc-400">{t('app.no_claims')}</p>
          </div>
        </div>
      )}
    </>
  );
}
