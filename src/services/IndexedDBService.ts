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
  private readonly version = 3; // Version incrémentée pour la migration

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

        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('conversationId', 'conversationId', { unique: false });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('messageId', 'messageId', { unique: false });
        }

        if (!db.objectStoreNames.contains('avatars')) {
          db.createObjectStore('avatars', { keyPath: 'id' });
        }

        // Ajout du store pour les clés de chiffrement
        if (!db.objectStoreNames.contains('cryptoKeys')) {
          db.createObjectStore('cryptoKeys', { keyPath: 'id' });
        }
      };
    });
  }

  async saveCryptoKeys(keys: { publicKey: JsonWebKey, privateKey: JsonWebKey }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(['cryptoKeys'], 'readwrite');
    const store = transaction.objectStore('cryptoKeys');
    await store.put({ id: 'user-keys', ...keys });
  }

  async getCryptoKeys(): Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey } | null> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['cryptoKeys'], 'readonly');
        const store = transaction.objectStore('cryptoKeys');
        const request = store.get('user-keys');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
  }

  async saveMessage(message: StoredMessage, conversationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(['messages', 'conversations'], 'readwrite');
    const messageStore = transaction.objectStore('messages');
    const conversationStore = transaction.objectStore('conversations');

    const getRequest = conversationStore.get(conversationId);

    getRequest.onsuccess = () => {
        const conversation = getRequest.result;

        const updatedConversation: StoredConversation = {
            id: conversationId,
            participantId: message.senderId === 'current_user' ? message.receiverId : message.senderId,
            participantName: conversation?.participantName || 'Unknown User',
            participantAvatar: conversation?.participantAvatar || '',
            lastMessage: message,
            unreadCount: message.senderId === 'current_user' ? 0 : (conversation?.unreadCount || 0) + 1,
            updatedAt: Date.now()
        };

        conversationStore.put(updatedConversation);
        messageStore.put({ ...message, conversationId });
    };

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
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

    const transaction = this.db.transaction(['messages', 'conversations', 'files', 'cryptoKeys'], 'readwrite');
    
    await Promise.all([
      transaction.objectStore('messages').clear(),
      transaction.objectStore('conversations').clear(),
      transaction.objectStore('files').clear(),
      transaction.objectStore('cryptoKeys').clear()
    ]);
  }

  async saveAvatar(id: string, avatar: File): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result as ArrayBuffer;
          const transaction = this.db!.transaction(['avatars'], 'readwrite');
          const store = transaction.objectStore('avatars');
          
          const avatarData = {
            id,
            data: arrayBuffer,
            name: avatar.name,
            type: avatar.type,
            size: avatar.size
          };
          
          const request = store.put(avatarData);
          request.onsuccess = () => {
            console.log('Avatar saved to IndexedDB as ArrayBuffer:', avatar.name, avatar.size, 'bytes');
            resolve();
          };
          request.onerror = () => reject(request.error);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(avatar);
    });
  }

  async getAvatar(id: string): Promise<Blob | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['avatars'], 'readonly');
      const store = transaction.objectStore('avatars');
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.data) {
          const blob = new Blob([result.data], { type: result.type });
          console.log('Avatar loaded from IndexedDB as Blob:', result.name, blob.size, 'bytes');
          resolve(blob);
        } else {
          console.log('No avatar found in IndexedDB for id:', id);
          resolve(null);
        }
      };
      
      request.onerror = () => {
        console.error('Error loading avatar from IndexedDB:', request.error);
        reject(request.error);
      };
    });
  }
}

export default IndexedDBService;
