import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import IndexedDBService from '../services/IndexedDBService';
import { Send, Paperclip, ArrowLeft } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import MessageStatusIndicator from './MessageStatusIndicator';

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
}

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPeer, myId, onBack }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const peerService = PeerService.getInstance();
  const dbService = IndexedDBService.getInstance();

  const fileReceivers = useRef<Map<string, { chunks: ArrayBuffer[], metadata: any }>>(new Map());

  const handleData = useCallback((peerId: string, data: any) => {
    if (peerId !== selectedPeer.id) return;

    if (data.type === 'chat-message') {
      const messageId = data.messageId || uuidv4();
      addMessage({
        id: messageId,
        senderId: peerId,
        receiverId: myId,
        content: data.payload,
        timestamp: Date.now(),
        type: 'text',
        encrypted: true,
        status: 'delivered',
      });
    } else if (data.type === 'file-start') {
      fileReceivers.current.set(data.messageId, { chunks: [], metadata: data.payload });
      addMessage({
        id: data.messageId,
        senderId: peerId,
        receiverId: myId,
        content: `Réception du fichier: ${data.payload.name}`,
        timestamp: Date.now(),
        type: 'file',
        encrypted: true,
        status: 'delivered',
        fileData: { ...data.payload, url: '' }
      });
    } else if (data.type === 'file-chunk') {
      // This part needs to be handled carefully as raw ArrayBuffers are not sent via this event handler anymore
    } else if (data.type === 'file-end') {
      const receiver = fileReceivers.current.get(data.messageId);
      if (receiver) {
        const file = new Blob(receiver.chunks, { type: receiver.metadata.type });
        const url = URL.createObjectURL(file);
        // Update the message to make the file downloadable
        setMessages(prev => prev.map(m => 
          m.id === data.messageId ? { ...m, content: receiver.metadata.name, fileData: { ...receiver.metadata, url } } : m
        ));
        fileReceivers.current.delete(data.messageId);
      }
    }
  }, [selectedPeer.id, myId]);

  const handleFileChunk = useCallback((peerId: string, chunk: ArrayBuffer) => {
    if (peerId !== selectedPeer.id) return;
    // This assumes we can associate the chunk with an ongoing transfer.
    // The current protocol needs enhancement to link chunks to a fileId.
    // For now, we find the latest active file transfer.
    const lastFileTransferId = Array.from(fileReceivers.current.keys()).pop();
    if (lastFileTransferId) {
        const receiver = fileReceivers.current.get(lastFileTransferId);
        if (receiver) {
            receiver.chunks.push(chunk);
        }
    }
  }, [selectedPeer.id]);

  const handleMessageDelivered = useCallback((peerId: string, messageId: string) => {
    if (peerId !== selectedPeer.id) return;
    
    // Mettre à jour le statut du message en base
    dbService.updateMessageStatus(messageId, 'delivered');
    // Mettre à jour l'état local
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, status: 'delivered' } : m
    ));
  }, [selectedPeer.id]);

  const handleMessageRead = useCallback((peerId: string, messageId: string) => {
    if (peerId !== selectedPeer.id) return;
    
    // Mettre à jour le statut du message en base
    dbService.updateMessageStatus(messageId, 'read');
    // Mettre à jour l'état local
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, status: 'read' } : m
    ));
  }, [selectedPeer.id]);

  useEffect(() => {
    loadMessages();
    markAsRead();

    peerService.on('data', handleData);
    peerService.on('file-chunk', handleFileChunk); // Listen for raw file chunks
    peerService.on('message-delivered', handleMessageDelivered);
    peerService.on('message-read', handleMessageRead);

    return () => {
      // Check if peerService still exists and has removeListener method
      if (peerService && typeof peerService.removeListener === 'function') {
        peerService.removeListener('data', handleData);
        peerService.removeListener('file-chunk', handleFileChunk);
        peerService.removeListener('message-delivered', handleMessageDelivered);
        peerService.removeListener('message-read', handleMessageRead);
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
      
      // Envoyer des accusés de lecture pour tous les messages non lus du peer
      const unreadMessages = messages.filter(m => 
        m.senderId === selectedPeer.id && 
        (m.status === 'delivered' || m.status === 'sent')
      );
      
      for (const message of unreadMessages) {
        peerService.sendMessageReadAck(selectedPeer.id, message.id);
        await dbService.updateMessageStatus(message.id, 'read');
      }
      
      // Mettre à jour l'état local
      setMessages(prev => prev.map(m => 
        m.senderId === selectedPeer.id && (m.status === 'delivered' || m.status === 'sent')
          ? { ...m, status: 'read' }
          : m
      ));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async () => {
    if (selectedFile) {
      const messageId = uuidv4();
      addMessage({
        id: messageId,
        senderId: myId,
        receiverId: selectedPeer.id,
        content: selectedFile.name,
        timestamp: Date.now(),
        type: 'file',
        encrypted: true,
        status: 'sending',
        fileData: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, url: '' }
      });
      const sent = await peerService.sendFile(selectedPeer.id, selectedFile, messageId);
      if (sent) {
        dbService.updateMessageStatus(messageId, 'sent');
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));
      }
      setSelectedFile(null);
    } else if (newMessage.trim()) {
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
      
      const sent = await peerService.sendMessage(peerId, messageContent, messageId);
      if (sent) {
        dbService.updateMessageStatus(messageId, 'sent');
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Empêcher l'envoi si le peer est hors ligne
      if (selectedPeer.status === 'online') {
        handleSendMessage();
      }
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
              <div className="flex items-center justify-end mt-1">
                <div className="text-xs opacity-75 mr-2">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                {msg.senderId === myId && (
                  <MessageStatusIndicator status={msg.status} />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-500 hover:text-gray-700"
            disabled={selectedPeer.status !== 'online'}
            title={selectedPeer.status !== 'online' ? 'Peer hors ligne - envoi de fichiers indisponible' : 'Joindre un fichier'}
          >
            <Paperclip size={20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
            className="hidden"
          />
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={selectedPeer.status === 'online' ? 'Tapez votre message...' : 'Utilisateur hors ligne - envoi de messages désactivé'}
            disabled={selectedPeer.status !== 'online'}
            className={`flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              selectedPeer.status !== 'online' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
            }`}
          />
          <button 
            onClick={handleSendMessage} 
            disabled={selectedPeer.status !== 'online'}
            className={`p-2 rounded-lg ${
              selectedPeer.status === 'online' 
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title={selectedPeer.status !== 'online' ? 'Utilisateur hors ligne - envoi désactivé' : 'Envoyer le message'}
          >
            <Send size={20} />
          </button>
        </div>
        {selectedPeer.status !== 'online' && (
          <div className="text-center mt-2">
            <p className="text-xs text-red-500">
              {selectedPeer.name} est hors ligne. L'envoi de messages est désactivé.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatWindow;
