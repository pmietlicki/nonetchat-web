// src/components/ChatWindow.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import IndexedDBService from '../services/IndexedDBService';
import CryptoService from '../services/CryptoService';
import NotificationService from '../services/NotificationService';
import { Send, Paperclip, ArrowLeft, X, Trash2, MoreVertical, Info, Smile } from 'lucide-react';
import VoiceRecorderButton from './VoiceRecorderButton';
import { v4 as uuidv4 } from 'uuid';
import MessageStatusIndicator from './MessageStatusIndicator';
import FilePreview from './FilePreview';

interface ChatWindowProps {
  selectedPeer: User;
  myId: string;
  onBack: () => void;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file';
  encrypted: boolean;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  fileData?: {
    name: string;
    size: number;
    type: string;
    url: string;
  };
  reactions?: { [emoji: string]: string[] };
}

const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const commonEmojis = ['😀', '😂', '😍', '🥰', '😊', '😎', '🤔', '😢', '😡', '👍', '👎', '❤️', '🔥', '💯', '🎉', '👏', '🙏', '💪', '🤝', '✨'];

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPeer, myId, onBack }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const peerService = PeerService.getInstance();
  const dbService = IndexedDBService.getInstance();
  const notificationService = NotificationService.getInstance();

  const fileReceivers = useRef<Map<string, { chunks: ArrayBuffer[]; metadata: any; expectedSize?: number; startTime: number }>>(new Map());
  const activeFileTransfers = useRef<Set<string>>(new Set());
  const [sendingProgress, setSendingProgress] = useState<Map<string, number>>(new Map());
  const [receivingProgress, setReceivingProgress] = useState<Map<string, number>>(new Map());
  const [showCancelOptions, setShowCancelOptions] = useState<boolean>(false);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const [newMessagesCount, setNewMessagesCount] = useState<number>(0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);

  // --- Gestes & long press
  const longPressRef = useRef<number | null>(null);
  const pressPosRef = useRef<{ x: number; y: number } | null>(null);
  const MOVE_CANCEL_THRESHOLD = 10; // px

  // Swipe-to-send (mobile)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [swipeHint, setSwipeHint] = useState<number>(0); // 0..1 pour feedback visuel
  const SWIPE_MIN_PX = 90; // distance horizontale minimale
  const SWIPE_MAX_ANGLE = 20; // degrés de tolérance verticale

  // URLs blob créées localement
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Limites
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const MAX_VOICE_DURATION = 180; // 3 min

  // --- Notes vocales
  const sendVoiceFile = async (voiceFile: File, durationSec: number) => {
    const messageId = uuidv4();
    const nice = `${Math.floor(durationSec/60)}:${String(durationSec%60).padStart(2,'0')}`;
    const displayName = `Note vocale (${nice})`;

    // Message optimiste
    addMessage({
      id: messageId,
      senderId: myId,
      receiverId: selectedPeer.id,
      content: `${displayName} (Envoi en cours...)`,
      timestamp: Date.now(),
      type: 'file',
      encrypted: true,
      status: 'sending',
      fileData: { name: voiceFile.name, size: voiceFile.size, type: voiceFile.type, url: '' },
    });

    try {
      await dbService.saveFileBlob(messageId, voiceFile);
      const onSendProgress = (progress: number) => {
        setSendingProgress(prev => {
          const np = new Map(prev);
          np.set(messageId, progress);
          return np;
        });
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, content: `${displayName} (Envoi: ${progress}%)` } : m
        ));
      };
      await peerService.sendFile(selectedPeer.id, voiceFile, messageId, onSendProgress);
      setSendingProgress(prev => { const np = new Map(prev); np.delete(messageId); return np; });
      dbService.updateMessageStatus(messageId, 'sent');
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, content: displayName, status: 'sent' } : m
      ));
    } catch (e) {
      console.error('[Voice] send error', e);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, content: `${displayName} (Erreur d'envoi)` } : m
      ));
    }
  };

  // --- Réception / transfert de fichiers
  const handleData = useCallback(async (peerId: string, data: any) => {
    if (peerId !== selectedPeer.id) return;

    if (data.type === 'file-start') {
      fileReceivers.current.set(data.messageId, {
        chunks: [],
        metadata: data.payload,
        expectedSize: data.payload.encryptedSize || data.payload.size,
        startTime: Date.now(),
      });

      activeFileTransfers.current.add(data.messageId);

      addMessage({
        id: data.messageId,
        senderId: peerId,
        receiverId: myId,
        content: `${data.payload.name} (En réception...)`,
        timestamp: Date.now(),
        type: 'file',
        encrypted: true,
        status: 'delivered',
        fileData: { ...data.payload, url: '' },
      });
    } else if (data.type === 'file-chunk') {
      // chunks via event dédié
    } else if (data.type === 'file-end') {
      const receiver = fileReceivers.current.get(data.messageId);
      if (receiver) {
        try {
          const totalSize = receiver.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          const expectedEncryptedSize = receiver.metadata.encryptedSize || receiver.expectedSize;
          if (expectedEncryptedSize && totalSize !== expectedEncryptedSize) {
            const sizeDifference = Math.abs(totalSize - expectedEncryptedSize);
            const tolerancePercent = 0.1; // 0,1%
            const tolerance = Math.max(1024, (expectedEncryptedSize * tolerancePercent) / 100);
            if (sizeDifference > tolerance) {
              throw new Error(
                `Taille de fichier incorrecte: reçu ${totalSize} octets, attendu ${expectedEncryptedSize} octets (diff: ${sizeDifference})`
              );
            }
          }

          const encryptedFile = new Blob(receiver.chunks);
          const cryptoService = CryptoService.getInstance();
          const decryptedFile = await cryptoService.decryptFile(encryptedFile);
          if (decryptedFile.size === 0) throw new Error('Le fichier déchiffré est vide');

          await dbService.saveFileBlob(data.messageId, decryptedFile);

          const updatedFileData = {
            name: receiver.metadata.name,
            size: receiver.metadata.size,
            type: receiver.metadata.type,
            url: '',
          };

          await dbService.updateMessageFileData(data.messageId, updatedFileData);

          setMessages(prev =>
            prev.map(m =>
              m.id === data.messageId
                ? { ...m, content: receiver.metadata.name, fileData: updatedFileData, status: 'delivered' }
                : m
            )
          );

          setReceivingProgress(prev => {
            const np = new Map(prev);
            np.delete(data.messageId);
            return np;
          });

          fileReceivers.current.delete(data.messageId);
          activeFileTransfers.current.delete(data.messageId);
        } catch (error) {
          console.error('Erreur lors du déchiffrement du fichier:', error);
          setMessages(prev =>
            prev.map(m =>
              m.id === data.messageId
                ? { ...m, content: `Erreur: Impossible de déchiffrer ${receiver?.metadata?.name ?? 'fichier'}`, status: 'delivered' }
                : m
            )
          );
          setReceivingProgress(prev => {
            const np = new Map(prev);
            np.delete(data.messageId);
            return np;
          });
          fileReceivers.current.delete(data.messageId);
          activeFileTransfers.current.delete(data.messageId);
        }
      }
    }
  }, [selectedPeer.id, myId, dbService]);

  const handleFileChunk = useCallback((peerId: string, messageId: string, chunk: ArrayBuffer) => {
    if (peerId !== selectedPeer.id) return;

    const receiver = fileReceivers.current.get(messageId);
    if (receiver) {
      receiver.chunks.push(chunk);

      if (receiver.expectedSize) {
        const currentSize = receiver.chunks.reduce((total, c) => total + c.byteLength, 0);
        const progress = Math.round((currentSize / receiver.expectedSize) * 100);

        setReceivingProgress(prev => {
          const np = new Map(prev);
          np.set(messageId, progress);
          return np;
        });

        setMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, content: `${receiver.metadata.name} (${progress}%)` } : m))
        );
      }
    }
  }, [selectedPeer.id]);

  const handleMessageDelivered = useCallback((peerId: string, messageId: string) => {
    if (peerId !== selectedPeer.id) return;
    dbService.updateMessageStatus(messageId, 'delivered');
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, status: 'delivered' } : m)));
  }, [selectedPeer.id]);

  const handleMessageRead = useCallback((peerId: string, messageId: string) => {
    if (peerId !== selectedPeer.id) return;
    dbService.updateMessageStatus(messageId, 'read');
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, status: 'read' } : m)));
  }, [selectedPeer.id]);

  // Réactions idempotentes (DB -> UI)
  const handleReactionReceived = useCallback(
    async (peerId: string, messageId: string, emoji: string) => {
      if (peerId !== selectedPeer.id) return;

      try {
        const reactions = await dbService.toggleMessageReaction(messageId, emoji, peerId);
        if (reactions) {
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        }
      } catch (e) {
        console.error('Erreur lors de la MAJ des réactions (réception):', e);
      }
    },
    [selectedPeer.id, dbService]
  );

  // Subscriptions
  useEffect(() => {
    loadMessages();
    markAsRead();

    peerService.on('data', handleData);
    peerService.on('file-chunk', handleFileChunk);
    peerService.on('message-delivered', handleMessageDelivered);
    peerService.on('message-read', handleMessageRead);
    peerService.on('reaction-received', handleReactionReceived);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAtBottom) {
        markAsRead();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (typeof peerService.removeListener === 'function') {
        peerService.removeListener('data', handleData);
        peerService.removeListener('file-chunk', handleFileChunk);
        peerService.removeListener('message-delivered', handleMessageDelivered);
        peerService.removeListener('message-read', handleMessageRead);
        peerService.removeListener('reaction-received', handleReactionReceived);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (longPressRef.current !== null) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }

      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, [selectedPeer.id, handleData, handleFileChunk, handleMessageDelivered, handleMessageRead, isAtBottom, handleReactionReceived, peerService]);

  // Mise à jour live si la fenêtre est ouverte
  useEffect(() => {
    const handleUiMessageReceived = (message: Message) => {
      if (message.senderId === selectedPeer.id) setMessages(prev => [...prev, message]);
    };
    peerService.on('ui-message-received', handleUiMessageReceived);
    return () => { peerService.removeListener('ui-message-received', handleUiMessageReceived); };
  }, [selectedPeer.id, peerService]);

  // Fermer menus/emoji/reactions quand on clique ailleurs
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.relative')) {
        setOpenMenuId(null);
        setShowEmojiPicker(false);
        setShowReactionPicker(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages]);

  // --- Data helpers
  const loadMessages = async () => {
    try {
      const stored = await dbService.getMessages(selectedPeer.id);
      setMessages(stored.map((m: any) => ({ ...m, id: m.id || uuidv4() })));
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const addMessage = async (message: Message) => {
    setMessages(prev => [...prev, message]);

    if (message.senderId !== myId) {
      if (!isAtBottom) {
        setNewMessagesCount(prev => prev + 1);
      } else if (document.visibilityState === 'visible') {
        setTimeout(() => scrollToBottom(), 100);
      }
    } else {
      setTimeout(() => scrollToBottom(), 100);
    }

    try {
      await dbService.saveMessage(
        {
          ...message,
          receiverId: message.senderId === myId ? selectedPeer.id : myId,
          encrypted: true,
        },
        selectedPeer.id
      );
      await dbService.updateConversationParticipant(
        selectedPeer.id,
        selectedPeer.name,
        selectedPeer.avatar,
        selectedPeer.age,
        selectedPeer.gender as 'male' | 'female' | 'other' | undefined,
      );

      if (message.senderId !== myId) {
        notificationService.addMessage(selectedPeer.id, {
          id: message.id,
          conversationId: selectedPeer.id,
          content: message.content,
          timestamp: message.timestamp,
          type: message.type,
          senderName: selectedPeer.name,
        });
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  const markAsRead = async () => {
    try {
      await dbService.markConversationAsRead(selectedPeer.id);

      const unreadMessages = messages.filter(
        m => m.senderId === selectedPeer.id && (m.status === 'delivered' || m.status === 'sent')
      );

      for (const message of unreadMessages) {
        (peerService as any)?.sendMessageReadAck?.(selectedPeer.id, message.id);
        await dbService.updateMessageStatus(message.id, 'read');
      }

      setMessages(prev =>
        prev.map(m =>
          m.senderId === selectedPeer.id && (m.status === 'delivered' || m.status === 'sent')
            ? { ...m, status: 'read' }
            : m
        )
      );

      notificationService.markConversationAsRead(selectedPeer.id);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (window.confirm('Êtes-vous sûr de vouloir supprimer ce message ?')) {
      try {
        await dbService.deleteMessage(messageId);
        setMessages(prev => prev.filter(m => m.id !== messageId));
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    }
  };

  const deleteConversation = async () => {
    if (window.confirm('Êtes-vous sûr de vouloir supprimer toute cette conversation ?')) {
      try {
        await dbService.deleteConversation(selectedPeer.id);
        setMessages([]);
        onBack();
      } catch (error) {
        console.error('Error deleting conversation:', error);
      }
    }
  };

  const toggleMessageMenu = (messageId: string) => {
    setOpenMenuId(openMenuId === messageId ? null : messageId);
  };

  const showMessageInfo = (message: Message) => {
    const info = `ID: ${message.id}\nType: ${message.type}\nEnvoyé: ${new Date(message.timestamp).toLocaleString()}\nStatut: ${message.status || 'Envoyé'}`;
    alert(info);
    setOpenMenuId(null);
  };

  const deleteMessageFromMenu = async (messageId: string) => {
    setOpenMenuId(null);
    await deleteMessage(messageId);
  };

  const insertEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // Réaction (texte ou fichier) – envoi garanti au pair
  const addReaction = async (messageId: string, emoji: string) => {
    // Optimistic UI
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== messageId) return msg;
        const reactions = { ...(msg.reactions || {}) };
        const arr = reactions[emoji] ? [...reactions[emoji]] : [];
        const i = arr.indexOf(myId);
        if (i >= 0) arr.splice(i, 1); else arr.push(myId);
        if (arr.length === 0) delete reactions[emoji]; else reactions[emoji] = arr;
        return { ...msg, reactions };
      })
    );
    setShowReactionPicker(null);

    try {
      const reactions = await dbService.toggleMessageReaction(messageId, emoji, myId);
      if (reactions) setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
      peerService.sendReaction(selectedPeer.id, messageId, emoji);
    } catch (e) {
      console.error('Erreur lors de la MAJ des réactions (émission):', e);
    }
  };

  // --- Envoi message / fichier
  const handleSendMessage = async () => {
    if (selectedPeer.status !== 'online') return;

    if (selectedFile) {
      const messageId = uuidv4();
      addMessage({
        id: messageId,
        senderId: myId,
        receiverId: selectedPeer.id,
        content: `${selectedFile.name} (Envoi en cours...)`,
        timestamp: Date.now(),
        type: 'file',
        encrypted: true,
        status: 'sending',
        fileData: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, url: '' },
      });

      try {
        await dbService.saveFileBlob(messageId, selectedFile);
        const onSendProgress = (progress: number) => {
          setSendingProgress(prev => {
            const np = new Map(prev);
            np.set(messageId, progress);
            return np;
          });
          setMessages(prev =>
            prev.map(m => (m.id === messageId ? { ...m, content: `${selectedFile.name} (Envoi: ${progress}%)` } : m))
          );
        };

        await peerService.sendFile(selectedPeer.id, selectedFile, messageId, onSendProgress);

        setSendingProgress(prev => {
          const np = new Map(prev);
          np.delete(messageId);
          return np;
        });

        dbService.updateMessageStatus(messageId, 'sent');
        setMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, content: selectedFile.name, status: 'sent' } : m))
        );
        setSelectedFile(null);
      } catch (error) {
        console.error("Erreur lors de l'envoi du fichier:", error);
        setMessages(prev =>
          prev.map(m => (m.id === messageId ? { ...m, content: `${selectedFile.name} (Erreur d'envoi)` } : m))
        );
        setSelectedFile(null);
      }
      return;
    }

    if (newMessage.trim()) {
      const messageContent = newMessage;
      const messageId = uuidv4();

      addMessage({
        id: messageId,
        senderId: myId,
        receiverId: selectedPeer.id,
        content: messageContent,
        timestamp: Date.now(),
        type: 'text',
        encrypted: true,
        status: 'sending',
      });
      setNewMessage('');

      await peerService.sendMessage(selectedPeer.id, messageContent, messageId);
      dbService.updateMessageStatus(messageId, 'sent');
      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, status: 'sent' } : m)));
    }
  };

  // --- Clavier
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter pour envoyer, Shift+Enter pour nouvelle ligne dans textarea (si vous migrez plus tard),
    // Ctrl/Cmd+Enter pour envoyer aussi (desktop-friendly).
    const isMac = navigator.platform.toLowerCase().includes('mac');
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedPeer.status === 'online') handleSendMessage();
    } else if ((isMac && e.metaKey && e.key === 'Enter') || (!isMac && e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      if (selectedPeer.status === 'online') handleSendMessage();
    }
  };

  // --- Scroll
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
    setNewMessagesCount(0);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsAtBottom(nearBottom);
    if (nearBottom) {
      setNewMessagesCount(0);
      setShowReactionPicker(null);
      if (document.visibilityState === 'visible') markAsRead();
    }
  };

  const sendAriaLabel =
    selectedPeer.status !== 'online'
      ? 'Utilisateur hors ligne - envoi désactivé'
      : selectedFile
      ? 'Envoyer le fichier'
      : 'Envoyer le message';

  // --- Lien de téléchargement
  const DownloadLink = ({ msg }: { msg: Message }) => {
    const [isLoading, setIsLoading] = useState(false);

    const safeGetBlob = async (id: string) => {
      try {
        return await dbService.getFileBlob(id);
      } catch (e: any) {
        if (String(e?.message || '').includes('Database not initialized')) {
          await IndexedDBService.getInstance().initialize();
          return await dbService.getFileBlob(id);
        }
        throw e;
      }
    };

    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLoading) return;

      setIsLoading(true);
      try {
        const blobFromDb = await safeGetBlob(msg.id);
        if (!blobFromDb) {
          console.warn('[DownloadLink] Blob introuvable pour', msg.id);
          alert('Fichier non trouvé dans la base de données locale.');
          return;
        }

        const filename = msg.fileData?.name || 'download';
        const desiredType = msg.fileData?.type || (blobFromDb as any).type || 'application/octet-stream';
        const blob = (blobFromDb as any).type ? (blobFromDb as Blob) : new Blob([blobFromDb as any], { type: desiredType });
        const url = URL.createObjectURL(blob);

        // IE/Edge Legacy
        // @ts-ignore
        if (typeof navigator !== 'undefined' && navigator.msSaveOrOpenBlob) {
          // @ts-ignore
          navigator.msSaveOrOpenBlob(blob, filename);
          setTimeout(() => URL.revokeObjectURL(url), 0);
          return;
        }

        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
        if (isIOS || isSafari) {
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 3000);
          return;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          try { document.body.removeChild(a); } catch {}
          URL.revokeObjectURL(url);
        }, 1500);
      } catch (error) {
        console.error('Erreur lors du téléchargement du fichier:', error);
        alert('Une erreur est survenue lors du téléchargement.');
      } finally {
        setIsLoading(false);
      }
    };

    const stopBubble = (e: React.SyntheticEvent) => { e.stopPropagation(); };

    return (
      <button
        type="button"
        onPointerDown={stopBubble}
        onMouseDown={stopBubble}
        onTouchStart={stopBubble}
        onClick={handleClick}
        className={`inline-block px-3 py-1 rounded text-xs font-medium transition-colors ${
          msg.senderId === myId ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
        }`}
        title="Télécharger le fichier"
        aria-label="Télécharger le fichier"
        data-testid={`download-${msg.id}`}
      >
        {isLoading ? 'Chargement...' : '📥 Télécharger'}
      </button>
    );
  };

  // --- Long press sur bulles (avec protection des éléments interactifs)
  const onBubblePointerDown = (msgId: string) => (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, textarea, [role="menu"], audio, video')) return; // évite conflit
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressPosRef.current = { x: e.clientX, y: e.clientY };
    if (longPressRef.current !== null) clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
      setShowReactionPicker(msgId);
    }, 300);
  };

  const onBubblePointerMove = (e: React.PointerEvent) => {
    const p = pressPosRef.current;
    if (!p || longPressRef.current === null) return;
    const dx = Math.abs(e.clientX - p.x);
    const dy = Math.abs(e.clientY - p.y);
    if (dx > MOVE_CANCEL_THRESHOLD || dy > MOVE_CANCEL_THRESHOLD) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const onBubblePointerUpOrCancel = () => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    pressPosRef.current = null;
  };

  // --- Swipe-to-send (mobile) sur la zone d’input
  const onSwipeStart = (e: React.PointerEvent) => {
    if (selectedPeer.status !== 'online') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="menu"], input[type="file"]')) return;
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
    setSwipeHint(0);
  };

  const onSwipeMove = (e: React.PointerEvent) => {
    const s = swipeStartRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    if (angle < SWIPE_MAX_ANGLE && dx > 0) {
      const norm = Math.min(1, Math.max(0, dx / (SWIPE_MIN_PX * 1.5)));
      setSwipeHint(norm);
    } else {
      setSwipeHint(0);
    }
  };

  const onSwipeEnd = () => {
    const s = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!s) return;
    if (swipeHint >= 1 && (selectedFile || newMessage.trim())) {
      // swipe validé -> envoi
      void handleSendMessage();
    }
    setSwipeHint(0);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-800 shrink-0" aria-label="Retour">
              <ArrowLeft size={20} />
            </button>
            <img
              src={selectedPeer.avatar || `https://i.pravatar.cc/150?u=${selectedPeer.id}`}
              alt={selectedPeer.name}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">{selectedPeer.name}</h3>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selectedPeer.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`} />
                <p className="text-sm text-gray-500">{selectedPeer.status === 'online' ? 'En ligne' : 'Hors ligne'}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={deleteConversation}
              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors"
              title="Supprimer la conversation"
              aria-label="Supprimer la conversation"
            >
              <Trash2 size={20} />
            </button>
            {(activeFileTransfers.current.size > 0 || sendingProgress.size > 0 || receivingProgress.size > 0) && (
              <button
                onClick={() => setShowCancelOptions(!showCancelOptions)}
                className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors"
                title="Annuler les transferts en cours"
                aria-label="Annuler les transferts en cours"
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Panneau d'annulation des transferts */}
        {showCancelOptions && (activeFileTransfers.current.size > 0 || sendingProgress.size > 0 || receivingProgress.size > 0) && (
          <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <h4 className="text-sm font-medium text-red-900 mb-3">Transferts en cours</h4>
            <div className="space-y-2">
              {Array.from(receivingProgress.entries()).map(([messageId, progress]) => {
                const receiver = fileReceivers.current.get(messageId);
                return receiver ? (
                  <div key={messageId} className="flex items-center justify-between p-2 bg-white rounded border">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">📥 {receiver.metadata.name}</div>
                      <div className="text-xs text-gray-500">Réception: {progress}%</div>
                    </div>
                    <button
                      onClick={() => {
                        setReceivingProgress(prev => {
                          const np = new Map(prev);
                          np.delete(messageId);
                          return np;
                        });
                        fileReceivers.current.delete(messageId);
                        activeFileTransfers.current.delete(messageId);
                        setMessages(prev =>
                          prev.map(m =>
                            m.id === messageId ? { ...m, content: `${receiver.metadata.name} (Annulé par l'utilisateur)` } : m
                          )
                        );
                      }}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Annuler
                    </button>
                  </div>
                ) : null;
              })}

              {Array.from(sendingProgress.entries()).map(([messageId, progress]) => {
                const message = messages.find(m => m.id === messageId);
                return message ? (
                  <div key={messageId} className="flex items-center justify-between p-2 bg-white rounded border">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">📤 {message.content.split(' (Envoi:')[0]}</div>
                      <div className="text-xs text-gray-500">Envoi: {progress}%</div>
                    </div>
                    <button
                      onClick={() => {
                        setSendingProgress(prev => {
                          const np = new Map(prev);
                          np.delete(messageId);
                          return np;
                        });
                        setMessages(prev =>
                          prev.map(m =>
                            m.id === messageId
                              ? { ...m, content: `${message.content.split(' (Envoi:')[0]} (Annulé par l'utilisateur)` }
                              : m
                          )
                        );
                      }}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Annuler
                    </button>
                  </div>
                ) : null;
              })}
            </div>
            <div className="text-xs text-red-600 bg-red-100 p-2 rounded mt-3">
              ⚠️ <strong>Attention:</strong> L'annulation interrompt définitivement le transfert.
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative bg-gray-50" onScroll={handleScroll} style={{ WebkitOverflowScrolling: 'touch' }}>
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.senderId === myId ? 'justify-end' : 'justify-start'} ${
              msg.reactions && Object.keys(msg.reactions).length > 0 ? 'mb-6' : 'mb-4'
            } group`}
          >
            <div
              className={`relative max-w-[80%] md:max-w-md px-4 py-2 rounded-lg ${
                msg.senderId === myId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={onBubblePointerDown(msg.id)}
              onPointerMove={onBubblePointerMove}
              onPointerUp={onBubblePointerUpOrCancel}
              onPointerCancel={onBubblePointerUpOrCancel}
            >
              <div className="absolute top-1 right-1">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={() => toggleMessageMenu(msg.id)}
                  className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all duration-200 ${
                    msg.senderId === myId ? 'text-blue-200 hover:text-white hover:bg-blue-500' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                  }`}
                  title="Options du message"
                  aria-label="Options du message"
                >
                  <MoreVertical size={12} />
                </button>
                {openMenuId === msg.id && (
                  <div
                    className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[140px]"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => showMessageInfo(msg)}
                      className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-t-lg"
                    >
                      <Info size={14} className="mr-2" />
                      Informations
                    </button>
                    <button
                      onClick={() => deleteMessageFromMenu(msg.id)}
                      className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg"
                    >
                      <Trash2 size={14} className="mr-2" />
                      Supprimer
                    </button>
                  </div>
                )}
              </div>

              {showReactionPicker === msg.id && (
                <div
                  className="absolute bottom-0 left-0 transform translate-y-full bg-white rounded-lg shadow-lg border border-gray-200 z-30 px-2 py-1 mt-1"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <div className="flex gap-1">
                    {reactionEmojis.map((emoji, index) => (
                      <button
                        key={index}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={() => addReaction(msg.id, emoji)}
                        className="text-lg hover:scale-110 transition-transform duration-200 p-1 rounded hover:bg-gray-100"
                        style={{ animationDelay: `${index * 30}ms` }}
                        title={`Réagir avec ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msg.type === 'file' ? (
                <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <Paperclip size={16} className="flex-shrink-0" />
                    <span className="font-medium break-all">{msg.content}</span>
                  </div>
                  {msg.fileData?.name ? (
                    <div className="space-y-1">
                      <div className="text-xs opacity-75">
                        Taille: {msg.fileData.size ? (msg.fileData.size / 1024).toFixed(1) + ' KB' : 'Inconnue'}
                      </div>
                      <DownloadLink msg={msg} />
                      <div onPointerDown={(e) => e.stopPropagation()}>
                        {/^audio\//.test(msg.fileData.type)
                          ? <FilePreview msg={msg} resumeAudio enableMediaSession autoPreviewImagesOnVisible />
                          : <FilePreview msg={msg} autoPreviewImagesOnVisible />
                        }
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs opacity-75">
                        {msg.status === 'sending' ? 'Envoi en cours...' : msg.status === 'sent' ? 'Envoyé' : msg.status === 'delivered' ? 'Réception en cours...' : 'En attente'}
                      </div>
                      {sendingProgress.has(msg.id) && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs opacity-75">
                            <span>Envoi</span>
                            <span>{sendingProgress.get(msg.id)}%</span>
                          </div>
                          <div className="w-full bg-white bg-opacity-30 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${msg.senderId === myId ? 'bg-blue-300' : 'bg-gray-400'}`}
                              style={{ width: `${sendingProgress.get(msg.id)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {receivingProgress.has(msg.id) && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs opacity-75">
                            <span>Réception</span>
                            <span>{receivingProgress.get(msg.id)}%</span>
                          </div>
                          <div className="w-full bg-white bg-opacity-30 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${msg.senderId === myId ? 'bg-blue-300' : 'bg-green-400'}`}
                              style={{ width: `${receivingProgress.get(msg.id)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              )}

              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <div
                  className={`absolute -bottom-3 ${msg.senderId === myId ? 'right-2' : 'left-2'} flex gap-1 items-center transform translate-y-1/2 z-20`}
                >
                  {Object.entries(msg.reactions).map(([emoji, userIds]) => (
                    <button
                      key={emoji}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => addReaction(msg.id, emoji)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-none shadow-sm border transition ${
                        userIds.includes(myId)
                          ? 'bg-blue-500 text-white border-blue-600'
                          : 'bg-white/90 text-gray-800 border-gray-200 hover:bg-white'
                      }`}
                      title={`${userIds.length} réaction${userIds.length > 1 ? 's' : ''}`}
                    >
                      <span className="text-sm leading-none">{emoji}</span>
                      {userIds.length > 1 && <span className="text-[10px] font-medium leading-none">{userIds.length}</span>}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-end mt-1">
                <div className="text-xs opacity-75 mr-2">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                {msg.senderId === myId && <MessageStatusIndicator status={msg.status} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />

        {newMessagesCount > 0 && !isAtBottom && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
            <button
              onClick={scrollToBottom}
              className="bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-600 transition-colors flex items-center gap-2 animate-pulse"
              aria-label="Aller aux nouveaux messages"
            >
              <span className="text-sm font-medium">
                {newMessagesCount} nouveau{newMessagesCount > 1 ? 'x' : ''} message{newMessagesCount > 1 ? 's' : ''}
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Input (sticky bottom, safe-area) */}
      <div
        className="p-4 border-t border-gray-200 bg-white sticky bottom-0 z-10 pb-[env(safe-area-inset-bottom)]"
        onPointerDown={onSwipeStart}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
      >
        {selectedFile && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip size={16} className="text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-blue-900 truncate">{selectedFile.name}</div>
                  <div className="text-xs text-blue-600">{(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'Type inconnu'}</div>
                  <div className="text-xs text-blue-500 mt-1">🗜️ Sera compressé et chiffré automatiquement</div>
                </div>
              </div>
              <button onClick={() => setSelectedFile(null)} className="text-blue-600 hover:text-blue-800 text-sm font-medium" aria-label="Retirer le fichier">
                ✕
              </button>
            </div>
          </div>
        )}

         {/* barre de feedback swipe (si tu l’utilises) */}
  {swipeHint > 0 && (
    <div className="h-1.5 w-full bg-gray-200 rounded-full mb-2 overflow-hidden">
      <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(swipeHint * 100)}%` }} />
    </div>
  )}

  {/* >>> CORRECTION: rangée compacte, no overflow, icônes non compressées <<< */}
  <div className="flex items-center w-full overflow-hidden gap-1.5 sm:gap-2">
    {/* Trombone (masqué sous 360px) */}
    <button
      onClick={() => fileInputRef.current?.click()}
      className="shrink-0 p-2 text-gray-500 hover:text-gray-700 max-[360px]:hidden"
      disabled={selectedPeer.status !== 'online'}
      title={selectedPeer.status !== 'online' ? 'Peer hors ligne - envoi de fichiers indisponible' : 'Joindre un fichier'}
      aria-label="Joindre un fichier"
    >
      <Paperclip size={18} />
    </button>
    <input
      type="file"
      ref={fileInputRef}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) {
          if (file.size > MAX_FILE_SIZE) {
            alert(
              `Le fichier est trop volumineux. Taille maximale autorisée: ${Math.round(
                MAX_FILE_SIZE / (1024 * 1024)
              )} MB\n\nNote: Les fichiers sont automatiquement compressés avant l'envoi pour optimiser le transfert.`
            );
            e.target.value = '';
            return;
          }
          setSelectedFile(file);
        }
      }}
      className="hidden"
    />

    {/* >>> l’input doit pouvoir rétrécir : flex-1 + min-w-0 <<< */}
    <div className="flex-1 min-w-0">
      <input
        type="text"
        value={selectedFile ? '' : newMessage}
        onChange={(e) => setNewMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          selectedFile
            ? `Fichier sélectionné: ${selectedFile.name}`
            : selectedPeer.status === 'online'
            ? 'Tapez votre message...'
            : 'Utilisateur hors ligne - envoi de messages désactivé'
        }
        disabled={selectedPeer.status !== 'online' || !!selectedFile}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          selectedPeer.status !== 'online' || selectedFile ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
        }`}
        aria-label="Saisie du message"
        inputMode="text"
        autoComplete="off"
      />
    </div>

    {/* Emoji (masqué sous 360px pour garder ENVOYER visible) */}
    <div className="relative shrink-0 max-[360px]:hidden">
      <button
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className="p-2 text-gray-500 hover:text-gray-700"
        disabled={selectedPeer.status !== 'online' || !!selectedFile}
        title="Ajouter un émoji"
        aria-label="Ajouter un émoji"
      >
        <Smile size={18} />
      </button>
      {showEmojiPicker && (
        <div className="absolute bottom-12 right-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-10 w-64">
          <div className="grid grid-cols-10 gap-1">
            {commonEmojis.map((emoji, index) => (
              <button
                key={index}
                onClick={() => insertEmoji(emoji)}
                className="text-lg hover:bg-gray-100 rounded p-1 transition-colors"
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* Micro */}
    <div className="shrink-0">
      <VoiceRecorderButton
        disabled={selectedPeer.status !== 'online' || !!selectedFile}
        maxDurationMs={MAX_VOICE_DURATION * 1000}
        onRecorded={sendVoiceFile}
      />
    </div>

    {/* >>> BOUTON ENVOYER TOUJOURS VISIBLE (shrink-0) <<< */}
    <button
      onClick={handleSendMessage}
      disabled={selectedPeer.status !== 'online' || (!selectedFile && !newMessage.trim())}
      className={`shrink-0 p-2 rounded-lg ${
        selectedPeer.status === 'online' && (selectedFile || newMessage.trim())
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-gray-300 text-gray-500'
      }`}
      title={sendAriaLabel}
      aria-label={sendAriaLabel}
    >
      <Send size={18} />
    </button>
  </div>

  {selectedPeer.status !== 'online' && (
    <div className="text-center mt-2">
      <p className="text-xs text-red-500">{selectedPeer.name} est hors ligne. L'envoi de messages est désactivé.</p>
    </div>
  )}
</div>
    </div>
  );
};

export default ChatWindow;
