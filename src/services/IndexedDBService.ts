interface StoredMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file';
  encrypted: boolean;
  fileData?: {
    name: string;
    size: number;
    type: string;
    url: string;
  };
}

interface StoredConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar: string;
  lastMessage?: StoredMessage;
  unreadCount: number;
  updatedAt: number;
}

class IndexedDBService {
  private static instance: IndexedDBService;
  private db: IDBDatabase | null = null;
  private readonly dbName = 'NoNetChatWeb';
  private readonly version = 2;

  public static getInstance(): IndexedDBService {
    if (!IndexedDBService.instance) {
      IndexedDBService.instance = new IndexedDBService();
    }
    return IndexedDBService.instance;
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('conversationId', 'conversationId', { unique: false });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Files store
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('messageId', 'messageId', { unique: false });
        }

        // Avatar store
        if (!db.objectStoreNames.contains('avatars')) {
          db.createObjectStore('avatars', { keyPath: 'id' });
        }
      };
    });
  }

  async saveMessage(message: StoredMessage, conversationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(['messages', 'conversations'], 'readwrite');
    const messageStore = transaction.objectStore('messages');
    const conversationStore = transaction.objectStore('conversations');

    // Save message with conversation reference
    await messageStore.put({ ...message, conversationId });

    // Update or create conversation
    const conversation = await this.getConversation(conversationId);
    const updatedConversation: StoredConversation = {
      id: conversationId,
      participantId: message.senderId === 'current_user' ? message.receiverId : message.senderId,
      participantName: conversation?.participantName || 'Unknown User',
      participantAvatar: conversation?.participantAvatar || '',
      lastMessage: message,
      unreadCount: message.senderId === 'current_user' ? 0 : (conversation?.unreadCount || 0) + 1,
      updatedAt: Date.now()
    };

    await conversationStore.put(updatedConversation);
  }

  async getMessages(conversationId: string, limit = 50): Promise<StoredMessage[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('conversationId');
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        const messages = request.result
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-limit);
        resolve(messages);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getConversation(conversationId: string): Promise<StoredConversation | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conversations'], 'readonly');
      const store = transaction.objectStore('conversations');
      const request = store.get(conversationId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllConversations(): Promise<StoredConversation[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['conversations'], 'readonly');
      const store = transaction.objectStore('conversations');
      const index = store.index('updatedAt');
      const request = index.getAll();

      request.onsuccess = () => {
        const conversations = request.result.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(conversations);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async markConversationAsRead(conversationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const conversation = await this.getConversation(conversationId);
    if (conversation) {
      conversation.unreadCount = 0;
      
      const transaction = this.db.transaction(['conversations'], 'readwrite');
      const store = transaction.objectStore('conversations');
      await store.put(conversation);
    }
  }

  async updateConversationParticipant(conversationId: string, name: string, avatar: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const conversation = await this.getConversation(conversationId);
    if (conversation) {
      conversation.participantName = name;
      conversation.participantAvatar = avatar;
      
      const transaction = this.db.transaction(['conversations'], 'readwrite');
      const store = transaction.objectStore('conversations');
      await store.put(conversation);
    }
  }

  async searchMessages(query: string): Promise<StoredMessage[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const request = store.getAll();

      request.onsuccess = () => {
        const messages = request.result.filter(message => 
          message.content.toLowerCase().includes(query.toLowerCase())
        );
        resolve(messages.sort((a, b) => b.timestamp - a.timestamp));
      };

      request.onerror = () => reject(request.error);
    });
  }

  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(['messages', 'conversations', 'files'], 'readwrite');
    
    await Promise.all([
      transaction.objectStore('messages').clear(),
      transaction.objectStore('conversations').clear(),
      transaction.objectStore('files').clear()
    ]);
  }

  async saveAvatar(id: string, avatar: File): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(['avatars'], 'readwrite');
    const store = transaction.objectStore('avatars');
    await store.put({ id, avatar });
  }

  async getAvatar(id: string): Promise<File | null> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(['avatars'], 'readonly');
    const store = transaction.objectStore('avatars');
    const result = await store.get(id);
    return result ? result.avatar : null;
  }
}

export default IndexedDBService;