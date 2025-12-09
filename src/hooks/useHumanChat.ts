

import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { supabase } from '../lib/supabase';
import { Message, ChatMode, PeerData, PresenceState, UserProfile, RecentPeer, Friend, FriendRequest, ConnectionMetadata, DirectMessageEvent } from '../types';
import { 
  INITIAL_GREETING, 
  STRANGER_DISCONNECTED_MSG, 
  ICE_SERVERS
} from '../constants';

// Define RealtimeChannel type from supabase instance return type since it's not exported from the module in some versions
type RealtimeChannel = ReturnType<typeof supabase.channel>;

const MATCHMAKING_CHANNEL = 'global-lobby-v1';

export const useHumanChat = (userProfile: UserProfile | null) => {
  // --- MAIN CHAT STATE (Random 1-on-1) ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ChatMode>(ChatMode.IDLE);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerRecording, setPartnerRecording] = useState(false);
  const [partnerProfile, setPartnerProfile] = useState<UserProfile | null>(null);
  const [remoteVanishMode, setRemoteVanishMode] = useState<boolean | null>(null);
  
  // --- GLOBAL STATE ---
  const [onlineUsers, setOnlineUsers] = useState<PresenceState[]>([]);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // --- DIRECT CHAT STATE (Social Hub) ---
  const [incomingDirectMessage, setIncomingDirectMessage] = useState<DirectMessageEvent | null>(null);
  const [incomingReaction, setIncomingReaction] = useState<{ messageId: string, emoji: string, sender: 'stranger' } | null>(null);
  
  // Friend System State
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingFriendRequest, setIncomingFriendRequest] = useState<FriendRequest | null>(null);
  
  // --- REFS ---
  const peerRef = useRef<Peer | null>(null);
  
  // Connection Refs
  const mainConnRef = useRef<DataConnection | null>(null); // For Random/Main Chat
  const directConnsRef = useRef<Map<string, DataConnection>>(new Map()); // For Social Hub Chats (Map<peerId, Connection>)

  const channelRef = useRef<RealtimeChannel | null>(null);
  const myPeerIdRef = useRef<string | null>(null);
  const isMatchmakerRef = useRef(false);
  const isConnectingRef = useRef(false); // New: preventing double connects
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- LOAD FRIENDS ---
  useEffect(() => {
    const loadFriends = () => {
      try {
        const stored = localStorage.getItem('chat_friends');
        if (stored) {
          setFriends(JSON.parse(stored));
        }
      } catch (e) {
        console.warn("Failed to load friends", e);
      }
    };
    loadFriends();
  }, []);

  // --- PERSIST RECENT PEERS ---
  const saveToRecent = useCallback((profile: UserProfile, peerId: string) => {
    const key = 'recent_peers';
    try {
      const existing = localStorage.getItem(key);
      let recents: RecentPeer[] = existing ? JSON.parse(existing) : [];
      
      // Create new entry
      const newPeer: RecentPeer = {
        id: Date.now().toString(),
        peerId,
        profile,
        metAt: Date.now()
      };

      // Filter out duplicates (by username)
      recents = recents.filter(p => p.profile.username !== profile.username);
      // Add new to top
      recents.unshift(newPeer);
      // Keep last 20
      recents = recents.slice(0, 20);
      
      localStorage.setItem(key, JSON.stringify(recents));
    } catch (e) {
      console.warn('Failed to save recent peer', e);
    }
  }, []);

  // --- SAVE FRIEND ---
  const saveFriend = useCallback((profile: UserProfile, peerId: string) => {
    const key = 'chat_friends';
    try {
      const existing = localStorage.getItem(key);
      let friendList: Friend[] = existing ? JSON.parse(existing) : [];
      
      // Check if already exists
      if (friendList.some(f => f.id === peerId)) return;

      const newFriend: Friend = {
        id: peerId, 
        profile,
        addedAt: Date.now()
      };

      friendList.unshift(newFriend);
      localStorage.setItem(key, JSON.stringify(friendList));
      setFriends(friendList);
    } catch (e) {
      console.warn("Failed to save friend", e);
    }
  }, []);

  // --- CLEANUP ---
  const cleanupMain = useCallback(() => {
    // 1. Leave Supabase Channel
    if (channelRef.current) {
      channelRef.current.untrack(); 
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // 2. Close Peer Connection
    if (mainConnRef.current) {
      try { mainConnRef.current.close(); } catch (e) {}
      mainConnRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Reset State
    isMatchmakerRef.current = false;
    isConnectingRef.current = false;
    
    setPartnerTyping(false);
    setPartnerRecording(false);
    setStatus(ChatMode.DISCONNECTED);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
  }, []);

  // --- DATA HANDLING ---
  const handleIncomingData = useCallback((data: PeerData, conn: DataConnection) => {
    const isMain = conn === mainConnRef.current;
    
    // 1. MESSAGES
    if (data.type === 'message') {
      const msgId = data.id || (Date.now().toString() + Math.random().toString());
      
      const newMessage: Message = {
        id: msgId,
        sender: 'stranger',
        timestamp: Date.now(),
        type: data.dataType || 'text',
        reactions: [],
        text: (data.dataType !== 'image' && data.dataType !== 'audio') ? data.payload : undefined,
        fileData: (data.dataType === 'image' || data.dataType === 'audio') ? data.payload : undefined
      };

      if (isMain) {
        setPartnerTyping(false);
        setPartnerRecording(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
        setMessages(prev => [...prev, newMessage]);
        conn.send({ type: 'seen', messageId: msgId });
      } else {
        setIncomingDirectMessage({
          peerId: conn.peer,
          message: newMessage
        });
      }

    // 2. SEEN RECEIPTS
    } else if (data.type === 'seen') {
      if (isMain && data.messageId) {
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId ? { ...msg, status: 'seen' } : msg
        ));
      }

    // 3. REACTIONS
    } else if (data.type === 'reaction') {
       if (data.messageId) {
         setIncomingReaction({ messageId: data.messageId, emoji: data.payload, sender: 'stranger' });
         if (isMain) {
            setMessages(prev => prev.map(msg => {
               if (msg.id === data.messageId) {
                 if (msg.reactions?.some(r => r.sender === 'stranger' && r.emoji === data.payload)) return msg;
                 return { ...msg, reactions: [...(msg.reactions || []), { emoji: data.payload, sender: 'stranger' as const }] };
               }
               return msg;
            }));
         }
       }

    // 4. EDIT MESSAGE
    } else if (data.type === 'edit_message') {
       if (isMain) {
         setMessages(prev => prev.map(msg => {
           if (msg.sender === 'stranger' && msg.type === 'text' && (!data.messageId || msg.id === data.messageId)) {
               return { ...msg, text: data.payload, isEdited: true };
           }
           return msg;
         }));
       }

    // 5. INDICATORS
    } else if (data.type === 'typing' && isMain) {
      setPartnerTyping(data.payload);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (data.payload) typingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 4000);

    } else if (data.type === 'recording' && isMain) {
      setPartnerRecording(data.payload);
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      if (data.payload) recordingTimeoutRef.current = setTimeout(() => setPartnerRecording(false), 4000);

    // 6. PROFILE
    } else if (data.type === 'profile') {
      if (isMain) {
        setPartnerProfile(data.payload);
        saveToRecent(data.payload, conn.peer);
        setMessages(prev => prev.map(msg => {
          if (msg.id === 'init-1') return { ...msg, text: `Connected with ${data.payload.username}. Say hello!` };
          return msg;
        }));
      } else {
        saveToRecent(data.payload, conn.peer);
      }

    // 7. VANISH MODE
    } else if (data.type === 'vanish_mode' && isMain) {
      setRemoteVanishMode(data.payload);

    // 8. FRIEND REQUESTS
    } else if (data.type === 'friend_request') {
      setIncomingFriendRequest({ profile: data.payload, peerId: conn.peer });

    } else if (data.type === 'friend_accept') {
      saveFriend(data.payload, conn.peer);

    // 9. DISCONNECT
    } else if (data.type === 'disconnect') {
      if (isMain) {
        setStatus(ChatMode.DISCONNECTED);
        setMessages(prev => [...prev, STRANGER_DISCONNECTED_MSG]);
        mainConnRef.current?.close();
        mainConnRef.current = null;
      } else {
        directConnsRef.current.delete(conn.peer);
      }
    }
  }, [saveToRecent, saveFriend]);

  // --- CONNECTION SETUP ---
  const setupConnection = useCallback((conn: DataConnection, metadata: ConnectionMetadata) => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (metadata?.type === 'random' || (!metadata && isMatchmakerRef.current)) {
       mainConnRef.current = conn;
       isMatchmakerRef.current = false;
       isConnectingRef.current = false;
       
       if (channelRef.current && myPeerIdRef.current) {
          channelRef.current.track({
             peerId: myPeerIdRef.current,
             status: 'busy',
             timestamp: Date.now(),
             profile: userProfile
          });
       }
    } else {
       directConnsRef.current.set(conn.peer, conn);
    }
    
    (conn as any).on('open', () => {
      if (conn === mainConnRef.current) {
        setStatus(ChatMode.CONNECTED);
        setMessages([INITIAL_GREETING]);
        setError(null);
      }
      if (userProfile) {
        conn.send({ type: 'profile', payload: userProfile });
      }
    });

    (conn as any).on('data', (data: any) => handleIncomingData(data, conn));

    (conn as any).on('close', () => {
      if (conn === mainConnRef.current && status === ChatMode.CONNECTED) {
        setStatus(ChatMode.DISCONNECTED);
        setMessages(prev => [...prev, STRANGER_DISCONNECTED_MSG]);
      } else {
        directConnsRef.current.delete(conn.peer);
      }
    });
    
    (conn as any).on('error', (err: any) => {
      console.error("Connection Error:", err);
      if (conn === mainConnRef.current) {
         // Reset state if start connection failed
         if (status === ChatMode.SEARCHING || status === ChatMode.WAITING) {
           isMatchmakerRef.current = false;
           // Consider retrying or showing error
         }
      }
    });
  }, [handleIncomingData, status, userProfile]);


  // --- INITIALIZE PEER ---
  const initPeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;

    const peer = new Peer({ debug: 1, config: { iceServers: ICE_SERVERS } });
    peerRef.current = peer;

    (peer as any).on('open', (id: string) => {
      myPeerIdRef.current = id;
      setMyPeerId(id);
    });

    (peer as any).on('connection', (conn: DataConnection) => {
      const metadata = conn.metadata as ConnectionMetadata;
      setupConnection(conn, metadata);
    });

    (peer as any).on('error', (err: any) => {
      console.error("Peer Error:", err);
      if (err.type === 'peer-unavailable') {
         if (isMatchmakerRef.current) {
           isMatchmakerRef.current = false;
         }
      }
    });

    return peer;
  }, [setupConnection]);


  // --- CONNECT (RANDOM) ---
  const connect = useCallback(() => {
    // Prevent spam calls
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    cleanupMain();
    setMessages([]);
    setPartnerProfile(null);
    setRemoteVanishMode(null);
    setError(null);
    setIncomingFriendRequest(null);
    isMatchmakerRef.current = false; // Ensure explicit reset
    
    const peer = initPeer();

    if (peer.id) {
       joinLobby(peer.id);
    } else {
       peer.on('open', (id) => joinLobby(id));
    }

  }, [cleanupMain, initPeer]); // joinLobby defined below

  const joinLobby = useCallback((myId: string) => {
    setStatus(ChatMode.SEARCHING);
    setError(null);
    
    // Ensure previous channel is gone
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(MATCHMAKING_CHANNEL, {
      config: { presence: { key: myId } }
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const newState = channel.presenceState();
        const allUsers = Object.values(newState).flat() as unknown as PresenceState[];
        setOnlineUsers(allUsers);

        if (isMatchmakerRef.current || mainConnRef.current?.open) return;

        // Sort by timestamp
        const sortedWaiters = allUsers
          .filter(u => u.status === 'waiting')
          .sort((a, b) => a.timestamp - b.timestamp);

        const oldestWaiter = sortedWaiters[0];

        if (oldestWaiter && oldestWaiter.peerId !== myId) {
           console.log("Found partner. Connecting:", oldestWaiter.peerId);
           isMatchmakerRef.current = true;
           
           try {
             const conn = peerRef.current?.connect(oldestWaiter.peerId, { 
               reliable: true,
               metadata: { type: 'random' } 
             });
             
             if (conn) {
               setupConnection(conn, { type: 'random' });
               
               if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
               connectionTimeoutRef.current = setTimeout(() => {
                 if (isMatchmakerRef.current && (!mainConnRef.current || !mainConnRef.current.open)) {
                   isMatchmakerRef.current = false;
                   mainConnRef.current = null;
                 }
               }, 8000); // 8 seconds timeout
             } else {
               isMatchmakerRef.current = false;
             }
           } catch (e) {
             console.error("Matchmaking connection failed", e);
             isMatchmakerRef.current = false;
           }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            peerId: myId,
            status: 'waiting',
            timestamp: Date.now(),
            profile: userProfile
          });
          setStatus(ChatMode.WAITING);
          isConnectingRef.current = false; // Successfully joined lobby
        }
      });
  }, [setupConnection, userProfile]);


  // --- SEND MESSAGES (MAIN) ---
  const sendMessage = useCallback((text: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2);
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      const payload: PeerData = { type: 'message', payload: text, dataType: 'text', id };
      mainConnRef.current.send(payload);
    }
    setMessages(prev => [...prev, {
      id,
      text,
      type: 'text',
      sender: 'me',
      timestamp: Date.now(),
      reactions: [],
      status: 'sent'
    }]);
  }, [status]);

  const sendImage = useCallback((base64Image: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2);
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      const payload: PeerData = { type: 'message', payload: base64Image, dataType: 'image', id };
      mainConnRef.current.send(payload);
    }
    setMessages(prev => [...prev, {
      id,
      fileData: base64Image,
      type: 'image',
      sender: 'me',
      timestamp: Date.now(),
      reactions: [],
      status: 'sent'
    }]);
  }, [status]);

  const sendAudio = useCallback((base64Audio: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2);
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      const payload: PeerData = { type: 'message', payload: base64Audio, dataType: 'audio', id };
      mainConnRef.current.send(payload);
    }
    setMessages(prev => [...prev, {
      id,
      fileData: base64Audio,
      type: 'audio',
      sender: 'me',
      timestamp: Date.now(),
      reactions: [],
      status: 'sent'
    }]);
  }, [status]);

  const sendReaction = useCallback((messageId: string, emoji: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, reactions: [...(msg.reactions || []), { emoji, sender: 'me' }] };
      }
      return msg;
    }));
    
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'reaction', payload: emoji, messageId });
    }
  }, [status]);

  const editMessage = useCallback((messageId: string, newText: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) return { ...msg, text: newText, isEdited: true };
      return msg;
    }));

    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'edit_message', payload: newText, messageId });
    }
  }, [status]);

  // --- SEND DIRECT MESSAGE ---
  const sendDirectMessage = useCallback((targetPeerId: string, text: string, id?: string) => {
    let conn = directConnsRef.current.get(targetPeerId);

    if (!conn && peerRef.current) {
      try {
        conn = peerRef.current.connect(targetPeerId, { 
          reliable: true,
          metadata: { type: 'direct' }
        });
        if (conn) {
          setupConnection(conn, { type: 'direct' });
        }
      } catch (e) {
        console.error("Failed to connect direct", e);
      }
    }

    if (conn) {
      const payload: PeerData = { 
        type: 'message', 
        payload: text, 
        dataType: 'text',
        id: id || Date.now().toString()
      };
      conn.send(payload);
    }
  }, [setupConnection]);

  // --- SEND DIRECT FRIEND REQUEST ---
  const sendDirectFriendRequest = useCallback((targetPeerId: string) => {
     if (!userProfile) return;
     
     let conn = directConnsRef.current.get(targetPeerId);
     
     const send = (c: DataConnection) => {
        c.send({ type: 'friend_request', payload: userProfile });
     };

     if (conn && conn.open) {
        send(conn);
     } else if (peerRef.current) {
        try {
           conn = peerRef.current.connect(targetPeerId, { 
             reliable: true,
             metadata: { type: 'direct' }
           });
           
           if (conn) {
              setupConnection(conn, { type: 'direct' });
              conn.on('open', () => send(conn!));
           }
        } catch(e) {
           console.error("Failed to send friend request", e);
        }
     }
  }, [userProfile, setupConnection]);

  // --- CALL PEER (Direct) ---
  const callPeer = useCallback((targetPeerId: string, targetProfile?: UserProfile) => {
    const peer = initPeer();
    
    if (targetProfile) {
      saveToRecent(targetProfile, targetPeerId);
    }

    if (!directConnsRef.current.has(targetPeerId)) {
      const conn = peer.connect(targetPeerId, { 
        reliable: true, 
        metadata: { type: 'direct' }
      });
      if (conn) {
        setupConnection(conn, { type: 'direct' });
      }
    }
  }, [initPeer, saveToRecent, setupConnection]);

  // --- OTHERS ---
  const sendTyping = useCallback((isTyping: boolean) => {
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'typing', payload: isTyping });
    }
  }, [status]);

  const sendRecording = useCallback((isRecording: boolean) => {
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'recording', payload: isRecording });
    }
  }, [status]);

  const updateMyProfile = useCallback((newProfile: UserProfile) => {
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'profile_update', payload: newProfile });
    }
    directConnsRef.current.forEach(conn => {
      conn.send({ type: 'profile_update', payload: newProfile });
    });

    if (channelRef.current && myPeerIdRef.current) {
        channelRef.current.track({
          peerId: myPeerIdRef.current,
          status: status === ChatMode.CONNECTED ? 'busy' : 'waiting',
          timestamp: Date.now(),
          profile: newProfile
        });
    }
  }, [status, userProfile]);

  const sendVanishMode = useCallback((isEnabled: boolean) => {
    if (mainConnRef.current && status === ChatMode.CONNECTED) {
      mainConnRef.current.send({ type: 'vanish_mode', payload: isEnabled });
    }
  }, [status]);

  const sendFriendRequest = useCallback(() => {
    if (mainConnRef.current && status === ChatMode.CONNECTED && userProfile) {
      mainConnRef.current.send({ type: 'friend_request', payload: userProfile });
    }
  }, [status, userProfile]);

  const acceptFriendRequest = useCallback(() => {
    if (incomingFriendRequest && userProfile) {
      saveFriend(incomingFriendRequest.profile, incomingFriendRequest.peerId);
      
      const directConn = directConnsRef.current.get(incomingFriendRequest.peerId);
      if (directConn && directConn.open) {
         directConn.send({ type: 'friend_accept', payload: userProfile });
      } else if (mainConnRef.current?.peer === incomingFriendRequest.peerId) {
         mainConnRef.current.send({ type: 'friend_accept', payload: userProfile });
      }
      
      setIncomingFriendRequest(null);
    }
  }, [incomingFriendRequest, userProfile, saveFriend]);

  const disconnect = useCallback(() => {
    if (partnerProfile && mainConnRef.current?.peer) {
      saveToRecent(partnerProfile, mainConnRef.current.peer);
    }
    cleanupMain();
  }, [cleanupMain, partnerProfile, saveToRecent]);

  useEffect(() => {
    return () => {
      cleanupMain();
      directConnsRef.current.forEach(c => c.close());
      directConnsRef.current.clear();
      peerRef.current?.destroy();
    };
  }, []); 

  return { 
    messages,
    setMessages,
    status, 
    partnerTyping,
    partnerRecording,
    partnerProfile,
    remoteVanishMode,
    onlineUsers,
    myPeerId,
    error,
    friends,
    incomingFriendRequest,
    incomingReaction,
    incomingDirectMessage, 
    sendMessage, 
    sendDirectMessage,
    sendDirectFriendRequest,
    sendImage,
    sendAudio,
    sendReaction,
    editMessage,
    sendTyping,
    sendRecording,
    updateMyProfile,
    sendVanishMode,
    sendFriendRequest,
    acceptFriendRequest,
    connect,
    callPeer,
    disconnect 
  };
};