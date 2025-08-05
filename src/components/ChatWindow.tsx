import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import WebRTCService from '../services/WebRTCService';
import IndexedDBService from '../services/IndexedDBService';
import { Send, Paperclip, Download, FileText, Image as ImageIcon } from 'lucide-react';

interface ChatWindowProps {
  selectedPeer: User;
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

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPeer }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rtcService = WebRTCService.getInstance();
  const dbService = IndexedDBService.getInstance();
  const currentUserId = rtcService.getClientId() || 'current_user';

  // File reception state
  const [incomingFiles, setIncomingFiles] = useState<Map<string, { chunks: ArrayBuffer[], metadata: any }>>(new Map());

  useEffect(() => {
    loadMessages();
    markAsRead();

    // Handle incoming text messages
    rtcService.onMessage = (senderId, message) => {
      if (senderId !== selectedPeer.id) return;

      if (message.type === 'text') {
        addMessage({
          id: message.id,
          senderId: senderId,
          content: message.content,
          timestamp: message.timestamp,
          type: 'text'
        });
      } else if (message.type === 'file-info' && message.fileInfo) {
        // Prepare to receive a file
        setIncomingFiles(prev => {
          const newMap = new Map(prev);
          newMap.set(message.id, { chunks: [], metadata: message.fileInfo });
          return newMap;
        });
      }
    };

    // Handle incoming file data
    rtcService.onFile = (senderId, file, fileName, fileId) => {
        if (senderId !== selectedPeer.id) return;

        const url = URL.createObjectURL(file);
        const fileMessage: Message = {
            id: fileId,
            senderId: senderId,
            content: `Fichier: ${fileName}`,
            timestamp: Date.now(),
            type: 'file',
            fileData: {
                name: fileName,
                size: file.size,
                type: file.type,
                url: url,
            },
        };
        addMessage(fileMessage);
    };


    return () => {
      // Cleanup listeners
      rtcService.onMessage = () => {};
      rtcService.onFile = () => {};
    };
  }, [selectedPeer.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const stored = await dbService.getMessages(selectedPeer.id);
      const formattedMessages = stored.map(msg => ({
        id: msg.id,
        senderId: msg.senderId,
        content: msg.content,
        timestamp: msg.timestamp,
        type: msg.type,
        fileData: msg.fileData
      }));
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const addMessage = async (message: Message) => {
    setMessages(prev => [...prev, message]);
    
    try {
      await dbService.saveMessage({
        id: message.id,
        senderId: message.senderId,
        receiverId: message.senderId === currentUserId ? selectedPeer.id : currentUserId,
        content: message.content,
        timestamp: message.timestamp,
        type: message.type,
        encrypted: false, // WebRTC data channels are already encrypted
        fileData: message.fileData
      }, selectedPeer.id);

      await dbService.updateConversationParticipant(
        selectedPeer.id,
        selectedPeer.name,
        selectedPeer.avatar
      );
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
    if (selectedFile) {
      await handleSendFile();
    } else if (newMessage.trim()) {
      const sentMessage = rtcService.sendMessage(selectedPeer.id, newMessage);
      if (sentMessage) {
        addMessage({ ...sentMessage, senderId: currentUserId });
      }
      setNewMessage('');
    }
  };

  const handleSendFile = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      // The service now handles sending the file
      rtcService.sendFile(selectedPeer.id, selectedFile);
      
      // Add a local representation of the message
      addMessage({
        id: `local-${Date.now()}`,
        senderId: currentUserId,
        content: `Fichier: ${selectedFile.name}`,
        timestamp: Date.now(),
        type: 'file',
        fileData: {
          name: selectedFile.name,
          size: selectedFile.size,
          type: selectedFile.type,
          url: URL.createObjectURL(selectedFile)
        }
      });

      setSelectedFile(null);
    } catch (error) {
      console.error('Error sending file:', error);
      alert('Erreur lors de l\'envoi du fichier');
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        alert('Fichier trop volumineux (max 50MB)');
        return;
      }
      setSelectedFile(file);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  };

  const formatFileSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon size={16} />;
    return <FileText size={16} />;
  };

  const renderMessage = (message: Message) => {
    const isOwn = message.senderId === currentUserId;
    
    return (
      <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${isOwn ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
          {message.type === 'file' && message.fileData && (
            <div className="mb-2">
              <div className="flex items-center gap-2 p-2 bg-white bg-opacity-20 rounded">
                {getFileIcon(message.fileData.type)}
                <div className="flex-1">
                  <p className="text-sm font-medium">{message.fileData.name}</p>
                  <p className="text-xs opacity-75">{formatFileSize(message.fileData.size)}</p>
                </div>
                <a href={message.fileData.url} download={message.fileData.name} className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded hover:bg-opacity-30 transition-colors flex items-center gap-1">
                  <Download size={12} />
                </a>
              </div>
            </div>
          )}
          
          {message.type === 'text' && <span>{message.content}</span>}
          
          <div className={`text-xs mt-1 ${isOwn ? 'text-blue-100' : 'text-gray-500'}`}>
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <img src={selectedPeer.avatar} alt={selectedPeer.name} className="w-10 h-10 rounded-full object-cover" />
          <div>
            <h3 className="font-semibold text-gray-900">{selectedPeer.name}</h3>
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${selectedPeer.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
              {selectedPeer.status === 'online' ? 'En ligne' : 'Hors ligne'}
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {messages.map(renderMessage)}
        <div ref={messagesEndRef} />
      </div>

      {/* File preview */}
      {selectedFile && (
        <div className="p-4 border-t border-gray-200 bg-yellow-50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">{getFileIcon(selectedFile.type)}</div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
            <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50">
            <Paperclip size={20} />
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Tapez votre message..."
            disabled={isUploading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button onClick={handleSendMessage} disabled={(!newMessage.trim() && !selectedFile) || isUploading} className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
            {isUploading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
