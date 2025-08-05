import React, { useState, useEffect } from 'react';
import { Search, MessageSquare } from 'lucide-react';
import IndexedDBService from '../services/IndexedDBService';
import PeerService from '../services/PeerService';

interface ConversationListProps {
  onSelectConversation: (participantId: string) => void;
  selectedConversationId?: string;
}

interface StoredConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar: string;
  lastMessage?: {
    content: string;
    timestamp: number;
    type: 'text' | 'file';
    senderId: string;
  };
  unreadCount: number;
  updatedAt: number;
}

const ConversationList: React.FC<ConversationListProps> = ({ 
  onSelectConversation, 
  selectedConversationId 
}) => {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  const dbService = IndexedDBService.getInstance();
  const peerService = PeerService.getInstance();

  useEffect(() => {
    loadConversations();

    const handleMessage = () => {
      loadConversations();
    };

    peerService.onData = handleMessage;

    return () => {
      peerService.onData = () => {};
    }
  }, []);

  const loadConversations = async () => {
    try {
      const stored = await dbService.getAllConversations();
      setConversations(stored);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredConversations = conversations.filter(conversation =>
    conversation.participantName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } else {
      return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit'
      }).format(date);
    }
  };

  const getLastMessagePreview = (conversation: StoredConversation) => {
    if (!conversation.lastMessage) return 'Aucun message';
    
    const message = conversation.lastMessage;
    if (message.type === 'file') {
      return '📎 Fichier partagé';
    }
    
    const content = message.content;
    return content.length > 50 ? content.substring(0, 50) + '...' : content;
  };

  const renderConversation = (conversation: StoredConversation) => {
    const isSelected = selectedConversationId === conversation.participantId;
    
    return (
      <div
        key={conversation.id}
        onClick={() => onSelectConversation(conversation.participantId)}
        className={`p-3 cursor-pointer transition-colors ${
          isSelected 
            ? 'bg-blue-50 border-r-2 border-blue-500' 
            : 'hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={conversation.participantAvatar || `https://i.pravatar.cc/150?u=${conversation.participantId}`}
              alt={conversation.participantName}
              className="w-12 h-12 rounded-full object-cover"
            />
            {conversation.unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
              </div>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 truncate">
                {conversation.participantName}
              </h4>
              {conversation.lastMessage && (
                <span className="text-xs text-gray-500">
                  {formatTime(conversation.lastMessage.timestamp)}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="truncate">{getLastMessagePreview(conversation)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="w-80 bg-white border-r border-gray-200 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Conversations ({conversations.length})
        </h2>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <MessageSquare size={48} className="mx-auto mb-2 text-gray-300" />
            <p>Aucune conversation</p>
            <p className="text-sm">Sélectionnez un pair pour commencer</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredConversations.map(renderConversation)}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationList;