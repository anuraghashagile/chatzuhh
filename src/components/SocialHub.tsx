
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Users, History, Globe, MessageCircle, X, Wifi, Heart, ArrowLeft, Send, UserPlus, Check, Trash2, Image as ImageIcon, Mic, Square, MapPin, Smile } from 'lucide-react';
import { UserProfile, PresenceState, RecentPeer, Message, ChatMode, SessionType, Friend, DirectMessageEvent, DirectStatusEvent } from '../types';
import { clsx } from 'clsx';
import { MessageBubble } from './MessageBubble';
import { Button } from './Button';

interface SocialHubProps {
  onlineUsers: PresenceState[];
  onCallPeer: (peerId: string, profile?: UserProfile) => void;
  globalMessages: Message[];
  sendGlobalMessage: (text: string) => void;
  myProfile: UserProfile | null;
  myPeerId?: string | null;
  privateMessages: Message[]; // Main chat messages
  sendPrivateMessage: (text: string) => void; // Main chat send
  sendDirectMessage?: (peerId: string, text: string, id?: string) => void; // Direct chat send updated signature
  sendDirectImage?: (peerId: string, base64: string, id?: string) => void;
  sendDirectAudio?: (peerId: string, base64: string, id?: string) => void;
  sendDirectTyping?: (peerId: string, isTyping: boolean) => void;
  sendDirectFriendRequest?: (peerId: string) => void; // New prop for friend requests
  sendReaction?: (messageId: string, emoji: string) => void;
  currentPartner: UserProfile | null;
  chatStatus: ChatMode;
  error?: string | null;
  onEditMessage?: (id: string, text: string) => void;
  sessionType: SessionType;
  incomingReaction?: { messageId: string, emoji: string, sender: 'stranger' } | null;
  incomingDirectMessage?: DirectMessageEvent | null;
  incomingDirectStatus?: DirectStatusEvent | null;
  onCloseDirectChat?: () => void;
  friends?: Friend[]; // Accept friends as prop
  removeFriend?: (peerId: string) => void;
}

export const SocialHub: React.FC<SocialHubProps> = ({ 
  onlineUsers, 
  onCallPeer,
  globalMessages,
  sendGlobalMessage,
  myProfile,
  myPeerId,
  privateMessages,
  sendPrivateMessage,
  sendDirectMessage,
  sendDirectImage,
  sendDirectAudio,
  sendDirectTyping,
  sendDirectFriendRequest,
  sendReaction,
  currentPartner,
  chatStatus,
  error,
  onEditMessage,
  sessionType,
  incomingReaction,
  incomingDirectMessage,
  incomingDirectStatus,
  onCloseDirectChat,
  friends: friendsProp = [],
  removeFriend
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'online' | 'recent' | 'global' | 'friends'>('online');
  const [recentPeers, setRecentPeers] = useState<RecentPeer[]>([]);
  const [friends, setFriends] = useState<Friend[]>(friendsProp);
  
  // Notification State
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  // Inputs
  const [globalInput, setGlobalInput] = useState('');
  const [privateInput, setPrivateInput] = useState('');
  const [isRecordingPrivate, setIsRecordingPrivate] = useState(false);
  
  // Active Chat State
  const [activePeer, setActivePeer] = useState<{id: string, profile: UserProfile} | null>(null);
  const [localChatHistory, setLocalChatHistory] = useState<Message[]>([]);
  const [peerTypingStatus, setPeerTypingStatus] = useState<Record<string, boolean>>({});
  
  // User Profile Modal State
  const [viewingProfile, setViewingProfile] = useState<{id: string, profile: UserProfile} | null>(null);
  
  // Confirmation State
  const [confirmRemoveFriend, setConfirmRemoveFriend] = useState<string | null>(null);

  // Refs for scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const privateMessagesEndRef = useRef<HTMLDivElement>(null);
  const privateFileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portal Target for Trigger Button
  const [triggerTarget, setTriggerTarget] = useState<HTMLElement | null>(null);

  // Update trigger target when status changes (input bar mounts/unmounts)
  useEffect(() => {
    const checkAnchor = () => {
       const el = document.getElementById('social-hub-trigger-anchor');
       if (el !== triggerTarget) {
         setTriggerTarget(el);
       }
    };
    checkAnchor();
    const interval = setInterval(checkAnchor, 500);
    return () => clearInterval(interval);
  }, [triggerTarget, chatStatus]);

  // Sync friends prop
  useEffect(() => {
    setFriends(friendsProp);
  }, [friendsProp]);

  // --- PERSISTENCE LOGIC (STRONG STORAGE) ---
  
  // 1. Restore Active Chat on Mount
  useEffect(() => {
    const storedActive = localStorage.getItem('active_social_peer');
    if (storedActive) {
      try {
        const parsed = JSON.parse(storedActive);
        if (parsed && parsed.id && parsed.profile) {
          setActivePeer(parsed);
          setIsOpen(true); // Open the hub if we restored a chat
          // We need to trigger the connection logic as well
          onCallPeer(parsed.id, parsed.profile);
        }
      } catch (e) {
        console.warn("Failed to restore active chat", e);
      }
    }
    
    // Also explicitly reload recent peers and friends
    try {
      const storedRecents = localStorage.getItem('recent_peers');
      if (storedRecents) setRecentPeers(JSON.parse(storedRecents));
      
      const storedFriends = localStorage.getItem('chat_friends');
      if (storedFriends) setFriends(JSON.parse(storedFriends));
    } catch(e) {}
  }, []); // Run once on mount

  // 2. Persist Active Chat when it changes
  useEffect(() => {
    if (activePeer) {
      localStorage.setItem('active_social_peer', JSON.stringify(activePeer));
    } else {
      localStorage.removeItem('active_social_peer');
    }
  }, [activePeer]);

  // --- 1. LOAD DATA ---
  useEffect(() => {
    // Load Recent (Refresh list when tab changes)
    const storedRecents = localStorage.getItem('recent_peers');
    if (storedRecents) {
      try { setRecentPeers(JSON.parse(storedRecents)); } catch (e) {}
    }
  }, [isOpen, activeTab, incomingDirectMessage]);

  // --- 2. LOAD CHAT HISTORY ---
  useEffect(() => {
    if (activePeer) {
      const storageKey = `chat_history_${activePeer.id}`;
      const savedParams = localStorage.getItem(storageKey);
      if (savedParams) {
        try {
          setLocalChatHistory(JSON.parse(savedParams));
        } catch (e) {
          setLocalChatHistory([]);
        }
      } else {
        setLocalChatHistory([]);
      }
      
      // Clear unread for this peer
      setUnreadCounts(prev => {
        const next = { ...prev };
        delete next[activePeer.id];
        return next;
      });
    }
  }, [activePeer]);

  // --- 3. HANDLE INCOMING DIRECT MESSAGES ---
  useEffect(() => {
    if (incomingDirectMessage) {
      const { peerId, message } = incomingDirectMessage;
      
      const storageKey = `chat_history_${peerId}`;
      const existingHistory = localStorage.getItem(storageKey);
      let history: Message[] = existingHistory ? JSON.parse(existingHistory) : [];
      
      if (!history.some(m => m.id === message.id)) {
        history.push(message);
        try {
           localStorage.setItem(storageKey, JSON.stringify(history));
        } catch(e) { console.error("Storage full or error", e); }
        
        if (activePeer && activePeer.id === peerId) {
          setLocalChatHistory(history);
        } else {
          setUnreadCounts(prev => ({
            ...prev,
            [peerId]: (prev[peerId] || 0) + 1
          }));
        }
      }
    }
  }, [incomingDirectMessage, activePeer]);


  // --- 4. SYNC INCOMING REACTIONS ---
  useEffect(() => {
    if (incomingReaction && activePeer) {
      setLocalChatHistory(prev => {
        const updatedHistory = prev.map(msg => {
           if (msg.id === incomingReaction.messageId) {
             const hasReaction = msg.reactions?.some(r => r.emoji === incomingReaction.emoji && r.sender === 'stranger');
             if (hasReaction) return msg;

             return {
               ...msg,
               reactions: [...(msg.reactions || []), { emoji: incomingReaction.emoji, sender: 'stranger' as const }]
             };
           }
           return msg;
        });
        try {
           localStorage.setItem(`chat_history_${activePeer.id}`, JSON.stringify(updatedHistory));
        } catch(e) { console.error("Storage error", e); }
        return updatedHistory;
      });
    }
  }, [incomingReaction, activePeer]);

  // --- 5. HANDLE INCOMING TYPING STATUS ---
  useEffect(() => {
    if (incomingDirectStatus) {
       const { peerId, type, value } = incomingDirectStatus;
       if (type === 'typing') {
          setPeerTypingStatus(prev => ({ ...prev, [peerId]: value }));
       }
    }
  }, [incomingDirectStatus]);


  // --- SCROLLING ---
  useEffect(() => {
    if (activeTab === 'global' && isOpen && !activePeer) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [globalMessages, activeTab, isOpen, activePeer]);

  useEffect(() => {
    if (activePeer && isOpen) {
      privateMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localChatHistory, activePeer, isOpen, peerTypingStatus]);


  // --- HANDLERS ---
  const handleGlobalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (globalInput.trim()) {
      sendGlobalMessage(globalInput);
      setGlobalInput('');
    }
  };

  const addMessageToLocal = (msg: Message, peerId: string) => {
      const storageKey = `chat_history_${peerId}`;
      const existingHistory = localStorage.getItem(storageKey);
      let history: Message[] = existingHistory ? JSON.parse(existingHistory) : [];
      history.push(msg);
      
      try {
         localStorage.setItem(storageKey, JSON.stringify(history));
      } catch(e) {
         console.error("Local storage quota exceeded or error", e);
         // Optional: trimming logic could go here
      }

      if (activePeer && activePeer.id === peerId) {
        setLocalChatHistory(history);
      }
  };

  const handlePrivateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (privateInput.trim() && activePeer) {
      const newMsgId = Date.now().toString() + Math.random().toString(36).substring(2);
      const newMsg: Message = {
        id: newMsgId,
        text: privateInput,
        sender: 'me',
        timestamp: Date.now(),
        type: 'text',
        reactions: [],
        status: 'sent'
      };

      addMessageToLocal(newMsg, activePeer.id);

      if (sendDirectMessage) {
        sendDirectMessage(activePeer.id, privateInput, newMsgId);
      }

      if (sendDirectTyping) sendDirectTyping(activePeer.id, false);
      setPrivateInput('');
    }
  };

  const handlePrivateTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrivateInput(e.target.value);
    if (activePeer && sendDirectTyping) {
       sendDirectTyping(activePeer.id, true);
       if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
       typingTimeoutRef.current = setTimeout(() => {
         if (activePeer) sendDirectTyping(activePeer.id, false);
       }, 1000);
    }
  };

  const handlePrivateImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activePeer && sendDirectImage) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const newMsgId = Date.now().toString() + Math.random().toString(36).substring(2);
        const newMsg: Message = {
            id: newMsgId,
            fileData: base64,
            type: 'image',
            sender: 'me',
            timestamp: Date.now(),
            reactions: [],
            status: 'sent'
        };
        addMessageToLocal(newMsg, activePeer.id);
        sendDirectImage(activePeer.id, base64, newMsgId);
      };
      reader.readAsDataURL(file);
    }
    if (privateFileInputRef.current) privateFileInputRef.current.value = '';
  };

  const startPrivateRecording = async () => {
    if (!activePeer) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
           const base64Audio = reader.result as string;
           const newMsgId = Date.now().toString() + Math.random().toString(36).substring(2);
           const newMsg: Message = {
                id: newMsgId,
                fileData: base64Audio,
                type: 'audio',
                sender: 'me',
                timestamp: Date.now(),
                reactions: [],
                status: 'sent'
            };
            if (activePeer) {
              addMessageToLocal(newMsg, activePeer.id);
              if (sendDirectAudio) sendDirectAudio(activePeer.id, base64Audio, newMsgId);
            }
        };
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecordingPrivate(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopPrivateRecording = () => {
    if (mediaRecorderRef.current && isRecordingPrivate) {
      mediaRecorderRef.current.stop();
      setIsRecordingPrivate(false);
    }
  };

  const handleReactionSend = (messageId: string, emoji: string) => {
    if (activePeer) {
      setLocalChatHistory(prev => {
         const updated = prev.map(msg => {
           if (msg.id === messageId) {
             return {
               ...msg,
               reactions: [...(msg.reactions || []), { emoji, sender: 'me' as const }]
             };
           }
           return msg;
         });
         try {
           localStorage.setItem(`chat_history_${activePeer.id}`, JSON.stringify(updated));
         } catch(e) { console.error("Storage error", e); }
         return updated;
      });
    }
    if (sendReaction) sendReaction(messageId, emoji);
  };

  const openPrivateChat = (peerId: string, profile?: UserProfile) => {
    if (profile) {
      setActivePeer({ id: peerId, profile });
      onCallPeer(peerId, profile);
      setUnreadCounts(prev => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setViewingProfile(null); // Close profile modal if open
    }
  };

  const closePrivateChat = () => {
    setActivePeer(null);
    if (onCloseDirectChat) onCloseDirectChat();
  };

  const handleFriendRequest = (peerId: string) => {
     if (sendDirectFriendRequest) {
        sendDirectFriendRequest(peerId);
        setViewingProfile(null); // Close modal
     }
  };

  const handleRemoveFriend = () => {
    if (activePeer && removeFriend) {
      setConfirmRemoveFriend(activePeer.id);
    }
  };

  const confirmRemove = () => {
    if (confirmRemoveFriend && removeFriend) {
       removeFriend(confirmRemoveFriend);
       setConfirmRemoveFriend(null);
    }
  };

  const isFriend = (peerId: string) => {
    return friends.some(f => f.id === peerId);
  };

  const getTotalUnreadCount = () => Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // --- RENDER CONTENT ---
  
  const TriggerButton = (
    <button 
      onClick={() => setIsOpen(true)}
      className={clsx(
        "z-[60] w-12 h-12 bg-brand-500 hover:bg-brand-600 text-white rounded-full shadow-2xl shadow-brand-500/40 transition-transform hover:scale-105 active:scale-95 flex items-center justify-center border-2 border-slate-50 dark:border-slate-900 relative pointer-events-auto",
        !triggerTarget && "fixed bottom-24 right-5 sm:bottom-10 sm:right-10 w-14 h-14" 
      )}
      aria-label="Open Social Hub"
    >
      <Users size={triggerTarget ? 22 : 26} strokeWidth={2.5} />
      {getTotalUnreadCount() > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] font-bold animate-pulse shadow-sm">
          {getTotalUnreadCount() > 9 ? '9+' : getTotalUnreadCount()}
        </span>
      )}
    </button>
  );

  const DrawerOverlay = (
    <>
       {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-end sm:p-6 bg-black/40 backdrop-blur-sm animate-in fade-in">
          
          <div className="bg-white dark:bg-[#0A0A0F] w-full sm:w-[400px] h-[100dvh] sm:h-[600px] rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border-l sm:border border-slate-200 dark:border-white/10 animate-in slide-in-from-bottom-10 sm:slide-in-from-right-10 duration-300 relative">
            
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-white/5 shrink-0">
              
              {activePeer ? (
                <div className="flex items-center gap-3">
                   <button onClick={closePrivateChat} className="p-2 -ml-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full">
                     <ArrowLeft size={20} className="text-slate-500 dark:text-slate-200" />
                   </button>
                   <div>
                     <h2 className="font-bold text-lg text-slate-900 dark:text-white leading-tight">
                       {activePeer.profile.username}
                     </h2>
                     <div className="flex items-center gap-1.5">
                       {onlineUsers.some(u => u.peerId === activePeer.id) ? (
                          <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"/> Online
                          </span>
                       ) : (
                          <span className="text-xs text-slate-400 font-medium">
                             Offline
                          </span>
                       )}
                     </div>
                   </div>
                </div>
              ) : (
                <h2 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                  Social Hub
                </h2>
              )}
              
              <div className="flex items-center gap-1">
                {activePeer && isFriend(activePeer.id) && (
                   <button 
                     onClick={handleRemoveFriend}
                     className="p-2 text-slate-400 hover:text-red-500 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                     title="Remove Friend"
                   >
                     <Trash2 size={18} />
                   </button>
                )}
                <button onClick={() => setIsOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-black/5 dark:hover:bg-white/5">
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* Remove Friend Confirmation Modal */}
            {confirmRemoveFriend && (
               <div className="absolute inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                  <div className="bg-white dark:bg-[#1a1b26] p-6 rounded-2xl w-full max-w-sm text-center border border-slate-200 dark:border-white/10 shadow-2xl animate-in zoom-in-95">
                     <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Remove Friend?</h3>
                     <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        Are you sure you want to remove this friend? You will need to add them again to connect later.
                     </p>
                     <div className="flex gap-3">
                        <Button variant="secondary" fullWidth onClick={() => setConfirmRemoveFriend(null)}>Cancel</Button>
                        <Button fullWidth onClick={confirmRemove} className="bg-red-500 hover:bg-red-600">Remove</Button>
                     </div>
                  </div>
               </div>
            )}

            {/* Profile Viewer Modal */}
            {viewingProfile && (
               <div className="absolute inset-0 z-[110] bg-white dark:bg-[#0A0A0F] flex flex-col animate-in slide-in-from-bottom duration-300">
                  <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between shrink-0">
                     <h3 className="font-bold text-lg text-slate-900 dark:text-white">Profile</h3>
                     <button onClick={() => setViewingProfile(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/5">
                        <X size={20} className="text-slate-500" />
                     </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-brand-400 to-violet-500 flex items-center justify-center text-white text-4xl font-bold shadow-2xl mb-4">
                         {viewingProfile.profile.username[0].toUpperCase()}
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                         {viewingProfile.profile.username}
                      </h2>
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm mb-6">
                         <span>{viewingProfile.profile.age} years</span>
                         <span>•</span>
                         <span>{viewingProfile.profile.gender}</span>
                      </div>

                      <div className="w-full space-y-4">
                         <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-100 dark:border-white/5">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                               <MapPin size={12}/> Location
                            </h4>
                            <p className="text-slate-900 dark:text-white font-medium">
                               {viewingProfile.profile.location || 'Unknown'}
                            </p>
                         </div>
                         
                         <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-100 dark:border-white/5">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                               <Smile size={12}/> Interests
                            </h4>
                            <div className="flex flex-wrap gap-2">
                               {viewingProfile.profile.interests.length > 0 ? (
                                  viewingProfile.profile.interests.map(int => (
                                     <span key={int} className="px-3 py-1 bg-white dark:bg-white/10 rounded-full text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm border border-slate-200 dark:border-white/5">
                                        {int}
                                     </span>
                                  ))
                               ) : (
                                  <span className="text-slate-400 italic text-sm">No interests listed</span>
                               )}
                            </div>
                         </div>
                      </div>
                  </div>
                  <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 flex flex-col gap-3">
                      <Button fullWidth onClick={() => openPrivateChat(viewingProfile.id, viewingProfile.profile)}>
                         <MessageCircle size={18}/> Message
                      </Button>
                      {!isFriend(viewingProfile.id) && (
                         <Button variant="secondary" fullWidth onClick={() => handleFriendRequest(viewingProfile.id)}>
                            <UserPlus size={18}/> Add Friend
                         </Button>
                      )}
                  </div>
               </div>
            )}

            {/* --- LIST MODE CONTENT --- */}
            {!activePeer && (
              <>
                {/* Tabs */}
                <div className="flex p-1 bg-slate-100 dark:bg-slate-900 mx-4 mt-4 rounded-xl shrink-0 overflow-x-auto">
                   {['online', 'friends', 'recent', 'global'].map((tab) => (
                      <button 
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={clsx(
                          "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 capitalize whitespace-nowrap relative",
                          activeTab === tab ? "bg-white dark:bg-slate-800 text-brand-500 shadow-sm" : "text-slate-500"
                        )}
                      >
                         {tab === 'online' && <Wifi size={14} />}
                         {tab === 'friends' && <Heart size={14} />}
                         {tab === 'recent' && <History size={14} />}
                         {tab === 'global' && <Globe size={14} />}
                         {tab}
                         
                         {tab === 'friends' && friends.some(f => unreadCounts[f.id] > 0) && (
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                         )}
                         {tab === 'recent' && recentPeers.some(p => unreadCounts[p.peerId] > 0) && (
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                         )}
                      </button>
                   ))}
                </div>

                <div className="flex-1 overflow-y-auto p-4 scroll-smooth min-h-0">
                  
                  {/* --- ONLINE TAB --- */}
                  {activeTab === 'online' && (
                    <div className="space-y-3">
                      {onlineUsers.map((user, i) => (
                        <div 
                          key={i} 
                          className={clsx(
                            "flex items-center justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5 transition-all group relative overflow-hidden",
                            (user.peerId === myPeerId)
                              ? "opacity-60 cursor-not-allowed" 
                              : "hover:bg-slate-100 dark:hover:bg-white/10"
                          )}
                        >
                          <div 
                             className="flex flex-1 items-center gap-3 cursor-pointer"
                             onClick={() => {
                                if (user.peerId !== myPeerId && user.profile) {
                                  setViewingProfile({ id: user.peerId, profile: user.profile });
                                }
                             }}
                          >
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-violet-500 flex items-center justify-center text-white font-bold shrink-0 shadow-lg relative">
                                  {user.profile?.username?.[0]?.toUpperCase() || '?'}
                                  {unreadCounts[user.peerId] > 0 && (
                                     <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border border-white dark:border-slate-900" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    {user.profile?.username || 'Anonymous'}
                                    {user.profile?.username === myProfile?.username && <span className="text-[10px] text-brand-500 bg-brand-500/10 px-1.5 rounded-full shrink-0">(You)</span>}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    {user.profile ? `${user.profile.age} • ${user.profile.gender}` : 'Guest'}
                                  </div>
                                </div>
                          </div>
                        </div>
                      ))}
                      {onlineUsers.length === 0 && <div className="text-center text-slate-500 py-10">No users found</div>}
                    </div>
                  )}

                  {/* --- FRIENDS TAB --- */}
                  {activeTab === 'friends' && (
                     <div className="space-y-3">
                       {friends.map((friend) => (
                         <div 
                           key={friend.id} 
                           onClick={() => openPrivateChat(friend.id, friend.profile)}
                           className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors group"
                         >
                           <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center text-white font-bold shrink-0 relative">
                               {friend.profile.username[0].toUpperCase()}
                               {unreadCounts[friend.id] > 0 && (
                                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border border-white dark:border-slate-900" />
                               )}
                             </div>
                             <div className="min-w-0">
                               <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                 {friend.profile.username}
                               </div>
                               <div className="text-xs text-slate-500">
                                  Added {new Date(friend.addedAt).toLocaleDateString()}
                               </div>
                             </div>
                           </div>
                           <div className="p-2 text-rose-400">
                              <Heart size={18} fill="currentColor" />
                           </div>
                         </div>
                       ))}
                       {friends.length === 0 && (
                         <div className="text-center py-10">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                               <UserPlus size={24} />
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">
                              No friends yet.<br/>Connect with strangers to add them!
                            </p>
                         </div>
                       )}
                     </div>
                  )}

                  {/* --- RECENT TAB --- */}
                  {activeTab === 'recent' && (
                    <div className="space-y-3">
                      {recentPeers.map((peer) => (
                        <div 
                          key={peer.id} 
                          onClick={() => openPrivateChat(peer.peerId, peer.profile)}
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 text-lg font-bold shrink-0 relative">
                              {peer.profile.username[0].toUpperCase()}
                              {unreadCounts[peer.peerId] > 0 && (
                                 <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border border-white dark:border-slate-900" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                {peer.profile.username}
                              </div>
                              <div className="text-xs text-slate-500">
                                 {new Date(peer.metAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <div className="p-2 text-slate-400 group-hover:text-brand-500">
                             <MessageCircle size={18} />
                          </div>
                        </div>
                      ))}
                      {recentPeers.length === 0 && <div className="text-center text-slate-500 py-10">No recent history.</div>}
                    </div>
                  )}

                  {/* --- GLOBAL TAB --- */}
                  {activeTab === 'global' && (
                    <div className="h-full flex flex-col relative">
                      <div className="flex-1 space-y-3 mb-4 min-h-0">
                         {globalMessages.map(msg => (
                           <div key={msg.id} className={clsx("flex flex-col", msg.sender === 'me' ? "items-end" : "items-start")}>
                              <div className="px-3 py-2 rounded-xl text-sm max-w-[85%] bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white break-words">
                                 <button 
                                   onClick={() => {
                                      if (msg.sender !== 'me' && msg.senderPeerId && msg.senderProfile) {
                                         setViewingProfile({ id: msg.senderPeerId, profile: msg.senderProfile });
                                      }
                                   }}
                                   className={clsx(
                                     "text-[10px] block font-bold mb-0.5",
                                     msg.sender === 'me' ? "text-brand-500 cursor-default" : "text-brand-500 hover:underline cursor-pointer"
                                   )}
                                 >
                                   {msg.sender === 'me' ? 'You' : msg.senderName}
                                 </button>
                                 {msg.text}
                              </div>
                           </div>
                         ))}
                         <div ref={messagesEndRef} />
                      </div>
                      <form onSubmit={handleGlobalSubmit} className="mt-auto flex gap-2 shrink-0 pb-1">
                         <input 
                           className="flex-1 bg-slate-100 dark:bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none"
                           placeholder="Global message..."
                           value={globalInput}
                           onChange={e => setGlobalInput(e.target.value)}
                         />
                         <button type="submit" className="p-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors">
                           <Send size={18} />
                         </button>
                      </form>
                    </div>
                  )}

                </div>
              </>
            )}

            {/* --- PRIVATE CHAT MODE (IN-DRAWER) --- */}
            {activePeer && (
               <div className="flex-1 flex flex-col p-4 overflow-hidden min-h-0 relative">
                  
                  {peerTypingStatus[activePeer.id] && (
                     <div className="absolute top-0 left-0 right-0 h-6 bg-slate-50 dark:bg-[#0A0A0F] z-10 flex items-center px-4">
                        <span className="text-xs text-brand-500 animate-pulse font-medium">typing...</span>
                     </div>
                  )}

                  <div className="flex-1 space-y-3 mb-4 overflow-y-auto min-h-0 pr-1 pt-6">
                     {localChatHistory.map(msg => (
                       <MessageBubble 
                          key={msg.id}
                          message={msg}
                          senderName={activePeer.profile.username}
                          onReact={(emoji) => handleReactionSend(msg.id, emoji)}
                          onEdit={onEditMessage}
                       />
                     ))}
                     {localChatHistory.length === 0 && (
                       <div className="text-center text-slate-500 text-sm mt-10">
                          Start a conversation with {activePeer.profile.username}.<br/>
                          <span className="text-xs opacity-70">Messages are saved locally.</span>
                       </div>
                     )}
                     <div ref={privateMessagesEndRef} />
                  </div>

                  <form onSubmit={handlePrivateSubmit} className="mt-auto flex gap-2 shrink-0 pb-1 items-end">
                     
                     <input type="file" accept="image/*" className="hidden" ref={privateFileInputRef} onChange={handlePrivateImageUpload} />
                     <button type="button" onClick={() => privateFileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0">
                        <ImageIcon size={20} />
                     </button>
                     
                     {!privateInput.trim() && (
                        isRecordingPrivate ? (
                           <button type="button" onClick={stopPrivateRecording} className="p-2 bg-red-500 text-white rounded-lg animate-pulse shrink-0"><Square size={20} fill="currentColor"/></button>
                        ) : (
                           <button type="button" onClick={startPrivateRecording} className="p-2 text-slate-400 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg shrink-0"><Mic size={20} /></button>
                        )
                     )}

                     <input 
                       className="flex-1 bg-slate-100 dark:bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none"
                       placeholder="Type message..."
                       value={privateInput}
                       onChange={handlePrivateTyping}
                       autoFocus
                     />
                     <button 
                       type="submit" 
                       disabled={!privateInput.trim()}
                       className="p-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50 shrink-0"
                     >
                       <Send size={18} />
                     </button>
                  </form>
               </div>
            )}

          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      {triggerTarget ? createPortal(TriggerButton, triggerTarget) : TriggerButton}
      {createPortal(DrawerOverlay, document.body)}
    </>
  );
};
