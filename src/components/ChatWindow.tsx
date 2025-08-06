import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import IndexedDBService from '../services/IndexedDBService';
import { Send, Paperclip, Download, FileText, Image as ImageIcon, ArrowLeft } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface ChatWindowProps {
  selectedPeer: User;
  myId: string;
  onBack: () => void;
}

interface Message {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file';
  fileData?: {
    name: string;
    size: number;
    type: string;
    url: string;
  };
}

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPeer, myId, onBack }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const peerService = PeerService.getInstance();
  const dbService = IndexedDBService.getInstance();

  const handleData = useCallback((peerId: string, data: any) => {
    if (peerId !== selectedPeer.id) return;

    if (data.type === 'chat-message') {
      addMessage({
        id: uuidv4(),
        senderId: peerId,
        content: data.payload,
        timestamp: Date.now(),
        type: 'text',
      });
    }
    // Gérer la réception de fichiers ici si nécessaire
  }, [selectedPeer.id]);

  useEffect(() => {
    loadMessages();
    markAsRead();

    peerService.on('data', handleData);

    return () => {
      // Check if peerService still exists and has removeListener method
      if (peerService && typeof peerService.removeListener === 'function') {
        peerService.removeListener('data', handleData);
      }
    };
  }, [selectedPeer.id, handleData]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const stored = await dbService.getMessages(selectedPeer.id);
      setMessages(stored.map(m => ({...m, id: m.id || uuidv4() })));
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const addMessage = async (message: Message) => {
    setMessages(prev => [...prev, message]);
    try {
      await dbService.saveMessage({
        ...message,
        receiverId: message.senderId === myId ? selectedPeer.id : myId,
        encrypted: true, // Les messages sont maintenant chiffrés
      }, selectedPeer.id);
      await dbService.updateConversationParticipant(selectedPeer.id, selectedPeer.name, selectedPeer.avatar);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  const markAsRead = async () => {
    try {
      await dbService.markConversationAsRead(selectedPeer.id);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async () => {
    if (newMessage.trim()) {
      peerService.sendMessage(selectedPeer.id, newMessage);
      addMessage({
        id: uuidv4(),
        senderId: myId,
        content: newMessage,
        timestamp: Date.now(),
        type: 'text',
      });
      setNewMessage('');
    }
    // La logique d'envoi de fichier doit être ajoutée ici
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ... (autres fonctions utilitaires comme formatTime, etc.)

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-800">
            <ArrowLeft size={20} />
          </button>
          <img src={selectedPeer.avatar || `https://i.pravatar.cc/150?u=${selectedPeer.id}`} alt={selectedPeer.name} className="w-10 h-10 rounded-full object-cover" />
          <div>
            <h3 className="font-semibold text-gray-900">{selectedPeer.name}</h3>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                selectedPeer.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
              }`}></div>
              <p className="text-sm text-gray-500">
                {selectedPeer.status === 'online' ? 'En ligne' : 'Hors ligne'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderId === myId ? 'justify-end' : 'justify-start'} mb-4`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${msg.senderId === myId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
              <span>{msg.content}</span>
              <div className="text-xs mt-1 opacity-75">{new Date(msg.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        {selectedPeer.status === 'online' ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Tapez votre message..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handleSendMessage} className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700">
              <Send size={20} />
            </button>
          </div>
        ) : (
          <div className="text-center py-3">
            <p className="text-sm text-gray-500">
              {selectedPeer.name} n'est pas en ligne. Vous pouvez consulter l'historique des messages mais ne pouvez pas envoyer de nouveaux messages.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatWindow;
