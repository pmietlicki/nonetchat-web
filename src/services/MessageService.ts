import { Message, Conversation, FileData } from '../types';
import CryptoService from './CryptoService';

class MessageService {
  private static instance: MessageService;
  private conversations: Map<string, Conversation> = new Map();
  private listeners: Set<(conversationId: string) => void> = new Set();
  private cryptoService: CryptoService;

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  constructor() {
    this.cryptoService = CryptoService.getInstance();
    this.loadConversations();
  }

  private loadConversations(): void {
    const stored = localStorage.getItem('conversations');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        Object.entries(data).forEach(([id, conv]: [string, any]) => {
          this.conversations.set(id, {
            ...conv,
            messages: conv.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            })),
            lastMessage: conv.lastMessage ? {
              ...conv.lastMessage,
              timestamp: new Date(conv.lastMessage.timestamp)
            } : undefined
          });
        });
      } catch (error) {
        console.error('Error loading conversations:', error);
      }
    }
  }

  private saveConversations(): void {
    const data = Object.fromEntries(this.conversations);
    localStorage.setItem('conversations', JSON.stringify(data));
  }

  async sendMessage(receiverId: string, content: string, type: 'text' | 'file' | 'image' = 'text', fileData?: FileData): Promise<Message> {
    const encryptedContent = await this.cryptoService.encryptMessage(content);
    
    const message: Message = {
      id: Date.now().toString(),
      senderId: 'current_user',
      receiverId,
      content: encryptedContent,
      timestamp: new Date(),
      type,
      encrypted: true,
      fileData,
      status: 'sending'
    };

    // Simuler l'envoi
    setTimeout(() => {
      message.status = 'sent';
      this.notifyListeners(receiverId);
    }, 1000);

    setTimeout(() => {
      message.status = 'delivered';
      this.notifyListeners(receiverId);
    }, 2000);

    this.addMessageToConversation(receiverId, message);
    return message;
  }

  private addMessageToConversation(participantId: string, message: Message): void {
    let conversation = this.conversations.get(participantId);
    
    if (!conversation) {
      conversation = {
        id: participantId,
        participantId,
        messages: [],
        unreadCount: 0
      };
      this.conversations.set(participantId, conversation);
    }

    conversation.messages.push(message);
    conversation.lastMessage = message;
    
    if (message.senderId !== 'current_user') {
      conversation.unreadCount++;
    }

    this.saveConversations();
    this.notifyListeners(participantId);
  }

  async simulateIncomingMessage(senderId: string): Promise<void> {
    const responses = [
      "Salut ! Comment ça va ?",
      "C'est parti pour le projet !",
      "Je suis en train de travailler sur ça",
      "Excellente idée !",
      "On se retrouve dans 10 minutes ?",
      "J'ai reçu ton fichier, merci !",
      "Parfait, c'est exactement ce qu'il fallait"
    ];

    const content = responses[Math.floor(Math.random() * responses.length)];
    const encryptedContent = await this.cryptoService.encryptMessage(content);

    const message: Message = {
      id: Date.now().toString(),
      senderId,
      receiverId: 'current_user',
      content: encryptedContent,
      timestamp: new Date(),
      type: 'text',
      encrypted: true,
      status: 'delivered'
    };

    this.addMessageToConversation(senderId, message);
  }

  async getDecryptedMessage(message: Message): Promise<string> {
    if (message.encrypted) {
      return await this.cryptoService.decryptMessage(message.content);
    }
    return message.content;
  }

  getConversation(participantId: string): Conversation | undefined {
    return this.conversations.get(participantId);
  }

  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values()).sort((a, b) => {
      const aTime = a.lastMessage?.timestamp || new Date(0);
      const bTime = b.lastMessage?.timestamp || new Date(0);
      return bTime.getTime() - aTime.getTime();
    });
  }

  markAsRead(participantId: string): void {
    const conversation = this.conversations.get(participantId);
    if (conversation) {
      conversation.unreadCount = 0;
      this.saveConversations();
      this.notifyListeners(participantId);
    }
  }

  addListener(listener: (conversationId: string) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (conversationId: string) => void): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(conversationId: string): void {
    this.listeners.forEach(listener => listener(conversationId));
  }

  async sendFile(receiverId: string, file: File): Promise<Message> {
    const encryptedFile = await this.cryptoService.encryptFile(file);
    const url = URL.createObjectURL(encryptedFile);
    
    const fileData: FileData = {
      name: file.name,
      size: file.size,
      type: file.type,
      url,
      thumbnail: file.type.startsWith('image/') ? url : undefined
    };

    return this.sendMessage(receiverId, `Fichier envoyé: ${file.name}`, 'file', fileData);
  }

  searchMessages(query: string): Message[] {
    const results: Message[] = [];
    
    this.conversations.forEach(conversation => {
      conversation.messages.forEach(message => {
        if (message.content.toLowerCase().includes(query.toLowerCase())) {
          results.push(message);
        }
      });
    });

    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}

export default MessageService;