import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import { Send, ArrowLeft, Smile } from 'lucide-react';
import { t } from '../i18n';

interface PublicChatWindowProps {
  roomId: string | null;
  roomName: string;
  myId: string;
  messages: any[];
  onBack: () => void;
  peers: Map<string, User>;
  userProfile: Partial<User>;
  myAvatarUrl?: string | null;
}

// Formatte "H/F/Autre · 34 ans · 1.2 km" (ou "350 m"/"LAN")
const formatMeta = (u?: Partial<User>): string | null => {
  if (!u) return null;
  const parts: string[] = [];
  if (u.gender) parts.push(u.gender === 'male' ? t('publicChatWindow.gender_male_short') : u.gender === 'female' ? t('publicChatWindow.gender_female_short') : t('publicChatWindow.gender_other'));
  if (typeof u.age === 'number') parts.push(`${u.age} ${t('publicChatWindow.age_suffix')}`);
  let dist: string | null = null;
  if ((u as any).distanceLabel) {
    dist = (u as any).distanceLabel as string;
  } else if (typeof (u as any).distanceKm === 'number') {
    const km = (u as any).distanceKm as number;
    dist = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }
  if (dist) parts.push(dist);
  return parts.length ? parts.join(t('publicChatWindow.meta_separator')) : null;
};

// Émojis communs pour le sélecteur
const commonEmojis = ['😀', '😂', '😍', '🥰', '😊', '😎', '🤔', '😢', '😡', '👍', '👎', '❤️', '🔥', '💯', '🎉', '👏', '🙏', '💪', '🤝', '✨'];

const PublicChatWindow: React.FC<PublicChatWindowProps> = ({ roomId, roomName, myId, messages, onBack, peers, userProfile, myAvatarUrl }) => {
  const [newMessage, setNewMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const peerService = PeerService.getInstance();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setNewMessage('');
  }, [roomId]);

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      peerService.broadcastToPublicRoom(newMessage);
      setNewMessage('');
    }
  };

  const insertEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // Fermer le sélecteur d'émojis quand on clique ailleurs
  useEffect(() => {
    const onDocDown = (event: MouseEvent | TouchEvent) => {
      const targetNode = event.target as Node;
      if (emojiWrapRef.current?.contains(targetNode)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
    };
  }, []);

  return (
       <div className="flex-1 flex flex-col min-h-0" data-room-id={roomId ?? 'public'}>
      <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded hover:bg-gray-100"
            title={t('publicChatWindow.back')}
            aria-label={t('publicChatWindow.back')}
          >
            <ArrowLeft size={20} />
          </button>
          <h3 className="font-semibold text-gray-900 truncate">{roomName}</h3>
        </div>
      </div>

     <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, index) => {
          const isMe = msg.origin === myId;
          const sender = isMe ? userProfile : peers.get(msg.origin);
          const displayName = sender?.name || t('publicChatWindow.default_user_name');
          const meta = formatMeta(sender);
          const key = msg.id ?? index;
          const avatar = isMe && myAvatarUrl
            ? myAvatarUrl
            : sender?.avatar ||
            `https://i.pravatar.cc/80?u=${encodeURIComponent(msg.origin || 'public')}`;

          return (
            <div key={key} className={`flex items-start gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              <img
                src={avatar}
                alt=""
                className="w-9 h-9 rounded-full object-cover mt-1 shrink-0"
              />
              <div className={`max-w-[80%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-gray-900">{displayName}</span>
                  {meta && <span className="text-[11px] text-gray-500">{meta}</span>}
                </div>
                <div
                  className={`mt-1 rounded-2xl px-3 py-2 ${
                    isMe ? 'bg-blue-600 text-white' : 'bg-white text-gray-900 border'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
                <span className="mt-0.5 text-[11px] text-gray-400">
                  {new Date(msg.ts ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
       <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 bg-white sticky bottom-0 z-10">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={t('publicChatWindow.placeholder')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          {/* Sélecteur d'émojis */}
          <div ref={emojiWrapRef} className="relative shrink-0">
            <button
              onClick={() => setShowEmojiPicker(v => !v)}
              className="p-2 text-gray-500 hover:text-gray-700"
              title={t('chat.input.add_emoji')}
              aria-label={t('chat.input.add_emoji')}
              aria-expanded={showEmojiPicker}
            >
              <Smile size={18} />
            </button>
            {showEmojiPicker && (
              <div
                className="absolute bottom-12 right-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50 w-64 max-h-60 overflow-y-auto"
                role="dialog"
              >
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
          
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim()}
            className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PublicChatWindow;