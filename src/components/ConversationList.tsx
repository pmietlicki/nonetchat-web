import React, { useState, useEffect, useCallback } from 'react';
import { Search, MessageSquare, Trash2, X } from 'lucide-react';
import IndexedDBService from '../services/IndexedDBService';
import PeerService from '../services/PeerService';
import NotificationService from '../services/NotificationService';
import { t } from '../i18n';

interface ConversationListProps {
  onSelectConversation: (participantId: string) => void;
  selectedConversationId?: string;
}

interface StoredConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar: string;
  participantAge?: number;
  participantGender?: 'male' | 'female' | 'other';
  lastMessage?: {
    content: string;
    timestamp: number;
    type: 'text' | 'file';
    senderId: string;
  };
  unreadCount: number;
  updatedAt: number;
}

const safeAvatar = (participantId: string, avatar?: string) =>
  avatar && avatar.trim() !== '' ? avatar : `https://i.pravatar.cc/150?u=${encodeURIComponent(participantId)}&d=identicon`;

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffInHours < 24) {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } else {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
    }).format(date);
  }
};

const getLastMessagePreview = (conversation: StoredConversation) => {
  if (!conversation.lastMessage) return t('conversationList.last_message_none');
  const message = conversation.lastMessage;
  if (message.type === 'file') return t('conversationList.last_message_file');
  const content = message.content || '';
  return content.length > 80 ? content.substring(0, 80) + '…' : content;
};

const ConversationList: React.FC<ConversationListProps> = ({
  onSelectConversation,
  selectedConversationId,
}) => {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [conversationUnreadCounts, setConversationUnreadCounts] = useState<Map<string, number>>(new Map());

  const dbService = IndexedDBService.getInstance();
  const peerService = PeerService.getInstance();
  const notificationService = NotificationService.getInstance();

  const loadConversations = useCallback(async () => {
    try {
      const stored = await dbService.getAllConversations();
      setConversations(stored);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dbService]);

  // Charger les conversations une fois, et se (dé)abonner aux événements pertinents
  useEffect(() => {
    loadConversations();

    const handleAnyData = () => loadConversations();
    const handleDelivered = () => loadConversations();
    const handleRead = () => loadConversations();

    const handleUnreadChanged = (conversationId: string, count: number) => {
      setConversationUnreadCounts((prev) => {
        const next = new Map(prev);
        if (count > 0) next.set(conversationId, count);
        else next.delete(conversationId);
        return next;
      });
    };

    peerService.on('data', handleAnyData);
    peerService.on('message-delivered', handleDelivered);
    peerService.on('message-read', handleRead);
    notificationService.on('conversation-unread-changed', handleUnreadChanged);

    return () => {
      peerService.removeListener('data', handleAnyData);
      peerService.removeListener('message-delivered', handleDelivered);
      peerService.removeListener('message-read', handleRead);
      notificationService.off('conversation-unread-changed', handleUnreadChanged);
    };
  }, [loadConversations, peerService, notificationService]);

  // Mettre à jour les compteurs non lus à chaque changement de liste
  useEffect(() => {
    const next = new Map<string, number>();
    conversations.forEach((c) => {
      const count = notificationService.getConversationUnreadCount(c.participantId);
      if (count > 0) next.set(c.participantId, count);
    });
    setConversationUnreadCounts(next);
  }, [conversations, notificationService]);

  const filteredConversations = conversations.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const nameHit = c.participantName?.toLowerCase().includes(q);
    const msgHit = c.lastMessage?.content?.toLowerCase().includes(q);
    return !!(nameHit || msgHit);
  });

  const deleteConversation = async (conversation: StoredConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!conversation) return;

    if (window.confirm(t('conversationList.delete_confirm'))) {
      try {
        // On supprime avec la clé de store (id)
        await dbService.deleteConversation(conversation.id);
        setConversations((prev) => prev.filter((x) => x.id !== conversation.id));

        // Si la conversation supprimée était sélectionnée (par participantId), on désélectionne
        if (selectedConversationId && (selectedConversationId === conversation.participantId || selectedConversationId === conversation.id)) {
          onSelectConversation('');
        }
      } catch (error) {
        console.error('Error deleting conversation:', error);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="w-80 bg-white border-r border-gray-200 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-500">{t('conversationList.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('conversationList.title', { count: conversations.length })}</h2>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder={t('conversationList.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 text-gray-500"
              aria-label={t('conversationList.clear_search_aria')}
              title={t('conversationList.clear_search_title')}
              onClick={() => setSearchQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <MessageSquare size={48} className="mx-auto mb-2 text-gray-300" />
            <p>{t('conversationList.no_conversations_title')}</p>
            <p className="text-sm">{t('conversationList.no_conversations_prompt')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredConversations.map((conversation) => {
              const isSelected = selectedConversationId === conversation.participantId;
              const unreadCount = conversationUnreadCounts.get(conversation.participantId) ?? conversation.unreadCount ?? 0;

              return (
                <div
                  key={conversation.id}
                  className={`p-3 transition-colors group ${
                    isSelected
                      ? 'bg-blue-50 border-r-2 border-blue-500'
                      : unreadCount > 0
                      ? 'bg-blue-25 hover:bg-blue-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => onSelectConversation(conversation.participantId)}
                    role="button"
                    aria-pressed={isSelected}
                  >
                    <div className="relative">
                      <img
                        src={safeAvatar(conversation.participantId, conversation.participantAvatar)}
                        alt={conversation.participantName || t('conversationList.user_default_name')}
                        className="w-12 h-12 rounded-full object-cover"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = safeAvatar(conversation.participantId);
                        }}
                      />
                      {unreadCount > 0 && (
                        <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <h4
                            className={`font-medium truncate ${
                              unreadCount > 0 ? 'text-gray-900 font-semibold' : 'text-gray-900'
                            }`}
                            title={conversation.participantName}
                          >
                            {conversation.participantName || t('conversationList.user_default_name')}
                          </h4>
                          {(conversation.participantAge || conversation.participantGender) && (
                            <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
                              <span>•</span>
                              {conversation.participantGender && (
                                <span
                                  className="text-sm"
                                  title={
                                    conversation.participantGender === 'male'
                                      ? t('conversationList.gender.male')
                                      : conversation.participantGender === 'female'
                                      ? t('conversationList.gender.female')
                                      : t('conversationList.gender.other')
                                  }
                                  style={{
                                    color:
                                      conversation.participantGender === 'female'
                                        ? '#ec4899'
                                        : conversation.participantGender === 'male'
                                        ? '#3b82f6'
                                        : '#6b7280',
                                  }}
                                >
                                  {conversation.participantGender === 'male'
                                    ? '♂'
                                    : conversation.participantGender === 'female'
                                    ? '♀'
                                    : '⚧'}
                                </span>
                              )}
                              {conversation.participantAge && <span>{conversation.participantAge} {t('conversationList.age_suffix')}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {conversation.lastMessage && (
                            <span className="text-xs text-gray-500" title={new Date(conversation.lastMessage.timestamp).toLocaleString('fr-FR')}>
                              {formatTime(conversation.lastMessage.timestamp)}
                            </span>
                          )}
                          <button
                            onClick={(e) => deleteConversation(conversation, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded transition-all duration-200"
                            title={t('conversationList.delete_button_title')}
                            aria-label={t('conversationList.delete_button_aria')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className={`truncate ${unreadCount > 0 ? 'text-gray-800 font-medium' : 'text-gray-500'}`}
                          title={conversation.lastMessage?.content}
                        >
                          {getLastMessagePreview(conversation)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationList;
