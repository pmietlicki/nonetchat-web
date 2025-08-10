import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import IndexedDBService from '../services/IndexedDBService';
import CryptoService from '../services/CryptoService';
import NotificationService from '../services/NotificationService';
import { Send, Paperclip, ArrowLeft, X } from 'lucide-react';
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const peerService = PeerService.getInstance();
  const dbService = IndexedDBService.getInstance();
  const notificationService = NotificationService.getInstance();

  const fileReceivers = useRef<Map<string, { chunks: ArrayBuffer[], metadata: any, expectedSize?: number, startTime: number }>>(new Map());
  const activeFileTransfers = useRef<Set<string>>(new Set());
  const [sendingProgress, setSendingProgress] = useState<Map<string, number>>(new Map());
  const [receivingProgress, setReceivingProgress] = useState<Map<string, number>>(new Map());
  const [showCancelOptions, setShowCancelOptions] = useState<boolean>(false);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const [newMessagesCount, setNewMessagesCount] = useState<number>(0);
  
  // Configuration des transferts de fichiers
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB avec compression

  const handleData = useCallback(async (peerId: string, data: any) => {
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
      fileReceivers.current.set(data.messageId, { 
        chunks: [], 
        metadata: data.payload,
        expectedSize: data.payload.size,
        startTime: Date.now()
      });
      
      // Ajouter ce transfert aux transferts actifs
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
        fileData: { ...data.payload, url: '' }
      });
    } else if (data.type === 'file-chunk') {
      // This part needs to be handled carefully as raw ArrayBuffers are not sent via this event handler anymore
    } else if (data.type === 'file-end') {
      const receiver = fileReceivers.current.get(data.messageId);
      if (receiver) {
        try {
          // Reconstruire le fichier à partir des chunks
          const totalSize = receiver.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          
          // Vérifier l'intégrité du fichier (taille)
          if (receiver.expectedSize && totalSize !== receiver.expectedSize) {
            throw new Error(`Taille de fichier incorrecte: reçu ${totalSize} octets, attendu ${receiver.expectedSize} octets`);
          }
          
          // Reconstruire le fichier chiffré à partir des chunks
          const encryptedFile = new Blob(receiver.chunks);
          
          // Déchiffrer le fichier
          const cryptoService = CryptoService.getInstance();
          const decryptedFile = await cryptoService.decryptFile(encryptedFile);
          
          // Vérifier que le déchiffrement a produit un fichier valide
           if (decryptedFile.size === 0) {
             throw new Error('Le fichier déchiffré est vide');
           }
          
          // Créer l'URL pour le fichier déchiffré
          const url = URL.createObjectURL(new Blob([decryptedFile], { type: receiver.metadata.type }));
          
          // Mettre à jour le message avec le fichier téléchargeable
          setMessages(prev => prev.map(m => 
            m.id === data.messageId ? { 
              ...m, 
              content: receiver.metadata.name, 
              fileData: { 
                name: receiver.metadata.name,
                size: receiver.metadata.size,
                type: receiver.metadata.type,
                url 
              },
              status: 'delivered'
            } : m
          ));
          
          // Nettoyer les progressions
          setReceivingProgress(prev => {
            const newProgress = new Map(prev);
            newProgress.delete(data.messageId);
            return newProgress;
          });
          
          // Nettoyer
          fileReceivers.current.delete(data.messageId);
          activeFileTransfers.current.delete(data.messageId);
        } catch (error) {
          console.error('Erreur lors du déchiffrement du fichier:', error);
          // Afficher un message d'erreur à l'utilisateur
          setMessages(prev => prev.map(m => 
            m.id === data.messageId ? { 
              ...m, 
              content: `Erreur: Impossible de déchiffrer ${receiver.metadata.name}`,
              status: 'delivered'
            } : m
          ));
          
          // Nettoyer les progressions même en cas d'erreur
          setReceivingProgress(prev => {
            const newProgress = new Map(prev);
            newProgress.delete(data.messageId);
            return newProgress;
          });
          
          // Nettoyer même en cas d'erreur
          fileReceivers.current.delete(data.messageId);
          activeFileTransfers.current.delete(data.messageId);
        }
      }
    }
  }, [selectedPeer.id, myId]);

  const handleFileChunk = useCallback((peerId: string, chunk: ArrayBuffer) => {
    if (peerId !== selectedPeer.id) return;
    
    // Associer le chunk au transfert de fichier actif le plus récent
    // Note: Cette approche fonctionne pour un seul transfert à la fois
    // Pour plusieurs transferts simultanés, il faudrait un protocole plus sophistiqué
    const activeTransfers = Array.from(activeFileTransfers.current);
    if (activeTransfers.length > 0) {
      const currentTransferId = activeTransfers[activeTransfers.length - 1];
      const receiver = fileReceivers.current.get(currentTransferId);
      if (receiver) {
        receiver.chunks.push(chunk);
        
        // Calculer et afficher la progression si on connaît la taille attendue
         if (receiver.expectedSize) {
           const currentSize = receiver.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
           const progress = Math.round((currentSize / receiver.expectedSize) * 100);
           
           // Mettre à jour la progression de réception
           setReceivingProgress(prev => {
             const newProgress = new Map(prev);
             newProgress.set(currentTransferId, progress);
             return newProgress;
           });
           
           // Mettre à jour le message avec la progression
           setMessages(prev => prev.map(m => 
             m.id === currentTransferId ? { 
               ...m, 
               content: `${receiver.metadata.name} (${progress}%)` 
             } : m
           ));
         }
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

    // Gérer la visibilité pour le marquage automatique
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAtBottom) {
        markAsRead();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Check if peerService still exists and has removeListener method
      if (peerService && typeof peerService.removeListener === 'function') {
        peerService.removeListener('data', handleData);
        peerService.removeListener('file-chunk', handleFileChunk);
        peerService.removeListener('message-delivered', handleMessageDelivered);
        peerService.removeListener('message-read', handleMessageRead);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedPeer.id, handleData, isAtBottom]);

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
    
    // Gérer les nouveaux messages reçus
    if (message.senderId !== myId) {
      if (!isAtBottom) {
        setNewMessagesCount(prev => prev + 1);
      } else if (document.visibilityState === 'visible') {
        // Auto-scroll si on est en bas et que la fenêtre est visible
        setTimeout(() => scrollToBottom(), 100);
      }
    } else {
      // Pour les messages envoyés, toujours scroller en bas
      setTimeout(() => scrollToBottom(), 100);
    }
    
    try {
      await dbService.saveMessage({
        ...message,
        receiverId: message.senderId === myId ? selectedPeer.id : myId,
        encrypted: true, // Les messages sont maintenant chiffrés
      }, selectedPeer.id);
      await dbService.updateConversationParticipant(selectedPeer.id, selectedPeer.name, selectedPeer.avatar);
      
      // Notifier le service de notifications si c'est un message reçu
      if (message.senderId !== myId) {
        notificationService.addMessage(selectedPeer.id, {
          id: message.id,
          conversationId: selectedPeer.id,
          content: message.content,
          timestamp: message.timestamp,
          type: message.type,
          senderName: selectedPeer.name
        });
      }
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
      
      // Marquer les messages comme lus dans le service de notifications
      notificationService.markConversationAsRead(selectedPeer.id);
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
    setNewMessagesCount(0);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    setIsAtBottom(isNearBottom);
    
    if (isNearBottom) {
      setNewMessagesCount(0);
      // Marquer comme lu si on est en bas et que la fenêtre est visible
      if (document.visibilityState === 'visible') {
        markAsRead();
      }
    }
  };

  const handleSendMessage = async () => {
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
        fileData: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, url: '' }
      });
      
      try {
         // Callback de progression pour l'envoi
         const onSendProgress = (progress: number) => {
           setSendingProgress(prev => {
             const newProgress = new Map(prev);
             newProgress.set(messageId, progress);
             return newProgress;
           });
           
           setMessages(prev => prev.map(m => 
             m.id === messageId ? { 
               ...m, 
               content: `${selectedFile.name} (Envoi: ${progress}%)` 
             } : m
           ));
         };
         
         await peerService.sendFile(selectedPeer.id, selectedFile, messageId, onSendProgress);
         
         // Nettoyer la progression et marquer comme envoyé
         setSendingProgress(prev => {
           const newProgress = new Map(prev);
           newProgress.delete(messageId);
           return newProgress;
         });
         
         dbService.updateMessageStatus(messageId, 'sent');
         setMessages(prev => prev.map(m => m.id === messageId ? { 
           ...m, 
           content: selectedFile.name,
           status: 'sent' 
         } : m));
         setSelectedFile(null);
       } catch (error) {
        console.error('Erreur lors de l\'envoi du fichier:', error);
        
        // Mettre à jour le statut à "erreur"
         setMessages(prev => prev.map(m => 
           m.id === messageId ? { 
             ...m, 
             content: `${selectedFile.name} (Erreur d'envoi)`
           } : m
         ));
        setSelectedFile(null);
      }
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
      
      await peerService.sendMessage(selectedPeer.id, messageContent, messageId);
      dbService.updateMessageStatus(messageId, 'sent');
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));
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
        <div className="flex items-center justify-between">
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
          {/* Bouton d'annulation des transferts actifs */}
          {(activeFileTransfers.current.size > 0 || sendingProgress.size > 0 || receivingProgress.size > 0) && (
            <button 
              onClick={() => setShowCancelOptions(!showCancelOptions)}
              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors"
              title="Annuler les transferts en cours"
            >
              <X size={20} />
            </button>
          )}
        </div>
        
        {/* Panneau d'annulation des transferts */}
        {showCancelOptions && (activeFileTransfers.current.size > 0 || sendingProgress.size > 0 || receivingProgress.size > 0) && (
          <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <h4 className="text-sm font-medium text-red-900 mb-3">Transferts en cours</h4>
            <div className="space-y-2">
              {/* Transferts en réception */}
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
                        // Annuler la réception
                        setReceivingProgress(prev => {
                          const newProgress = new Map(prev);
                          newProgress.delete(messageId);
                          return newProgress;
                        });
                        fileReceivers.current.delete(messageId);
                        activeFileTransfers.current.delete(messageId);
                        setMessages(prev => prev.map(m => 
                          m.id === messageId ? { 
                            ...m, 
                            content: `${receiver.metadata.name} (Annulé par l'utilisateur)`
                          } : m
                        ));
                      }}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Annuler
                    </button>
                  </div>
                ) : null;
              })}
              
              {/* Transferts en envoi */}
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
                        // Annuler l'envoi
                        setSendingProgress(prev => {
                          const newProgress = new Map(prev);
                          newProgress.delete(messageId);
                          return newProgress;
                        });
                        setMessages(prev => prev.map(m => 
                          m.id === messageId ? { 
                            ...m, 
                            content: `${message.content.split(' (Envoi:')[0]} (Annulé par l'utilisateur)`
                          } : m
                        ));
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative bg-gray-50" onScroll={handleScroll}>
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderId === myId ? 'justify-end' : 'justify-start'} mb-4`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${msg.senderId === myId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
              {msg.type === 'file' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Paperclip size={16} className="flex-shrink-0" />
                    <span className="font-medium">{msg.content}</span>
                  </div>
                  {msg.fileData?.url ? (
                    <div className="space-y-1">
                      <div className="text-xs opacity-75">
                        Taille: {msg.fileData.size ? (msg.fileData.size / 1024).toFixed(1) + ' KB' : 'Inconnue'}
                      </div>
                      <a 
                        href={msg.fileData.url} 
                        download={msg.fileData.name}
                        className={`inline-block px-3 py-1 rounded text-xs font-medium transition-colors ${
                          msg.senderId === myId 
                            ? 'bg-blue-500 hover:bg-blue-400 text-white' 
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                        }`}
                      >
                        📥 Télécharger
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs opacity-75">
                        {msg.status === 'sending' ? 'Envoi en cours...' : 
                         msg.status === 'sent' ? 'Envoyé' :
                         msg.status === 'delivered' ? 'Réception en cours...' : 'En attente'}
                      </div>
                      
                      {/* Barre de progression pour l'envoi */}
                      {sendingProgress.has(msg.id) && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs opacity-75">
                            <span>Envoi</span>
                            <span>{sendingProgress.get(msg.id)}%</span>
                          </div>
                          <div className="w-full bg-white bg-opacity-30 rounded-full h-1.5">
                            <div 
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                msg.senderId === myId ? 'bg-blue-300' : 'bg-gray-400'
                              }`}
                              style={{ width: `${sendingProgress.get(msg.id)}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      
                      {/* Barre de progression pour la réception */}
                      {receivingProgress.has(msg.id) && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs opacity-75">
                            <span>Réception</span>
                            <span>{receivingProgress.get(msg.id)}%</span>
                          </div>
                          <div className="w-full bg-white bg-opacity-30 rounded-full h-1.5">
                            <div 
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                msg.senderId === myId ? 'bg-blue-300' : 'bg-green-400'
                              }`}
                              style={{ width: `${receivingProgress.get(msg.id)}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <span>{msg.content}</span>
              )}
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
        
        {/* Indicateur de nouveaux messages */}
        {newMessagesCount > 0 && !isAtBottom && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
            <button
              onClick={scrollToBottom}
              className="bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-600 transition-colors flex items-center gap-2 animate-pulse"
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

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        {/* Fichier sélectionné */}
        {selectedFile && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Paperclip size={16} className="text-blue-600" />
                <div>
                  <div className="text-sm font-medium text-blue-900">{selectedFile.name}</div>
                  <div className="text-xs text-blue-600">
                    {(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'Type inconnu'}
                  </div>
                  <div className="text-xs text-blue-500 mt-1">
                    🗜️ Sera compressé et chiffré automatiquement
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        
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
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                // Vérifier la taille du fichier
                if (file.size > MAX_FILE_SIZE) {
                   alert(`Le fichier est trop volumineux. Taille maximale autorisée: ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB\n\nNote: Les fichiers sont automatiquement compressés avant l'envoi pour optimiser le transfert.`);
                   e.target.value = ''; // Réinitialiser l'input
                   return;
                 }
                
                setSelectedFile(file);
              }
            }}
            className="hidden"
          />
          <input
            type="text"
            value={selectedFile ? '' : newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={selectedFile ? `Fichier sélectionné: ${selectedFile.name}` : 
                        selectedPeer.status === 'online' ? 'Tapez votre message...' : 'Utilisateur hors ligne - envoi de messages désactivé'}
            disabled={selectedPeer.status !== 'online' || !!selectedFile}
            className={`flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              selectedPeer.status !== 'online' || selectedFile ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
            }`}
          />
          <button 
            onClick={handleSendMessage} 
            disabled={selectedPeer.status !== 'online' || (!selectedFile && !newMessage.trim())}
            className={`p-2 rounded-lg ${
              selectedPeer.status === 'online' && (selectedFile || newMessage.trim())
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title={selectedPeer.status !== 'online' ? 'Utilisateur hors ligne - envoi désactivé' : 
                   selectedFile ? 'Envoyer le fichier' : 'Envoyer le message'}
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
