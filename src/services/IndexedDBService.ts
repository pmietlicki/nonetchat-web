// indexedDBService.ts — version consolidée (compat ascendante + nouveaux besoins avatar/profil/KV)

interface StoredMessage {
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
  // Clé de partition
  conversationId?: string;
}

interface StoredConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar: string;
  participantAge?: number;
  participantGender?: 'male' | 'female' | 'other';
  lastMessage?: StoredMessage;
  unreadCount: number;
  updatedAt: number;
}

// --- Nouveaux types (avatars/profil/KV) ---

// Enregistrement interne de la store "avatars"
type AvatarStoreRecord = {
  id: string;           // clé primaire (pour le nouveau pipeline: hash SHA-256 hex ; legacy: un id arbitraire)
  data: ArrayBuffer;    // octets encodés (miniature/visuel compressé)
  name?: string;        // legacy (nom fichier)
  type: string;         // MIME, ex. image/webp
  size: number;         // taille en octets
  hash?: string;        // duplicata éventuel (legacy) du hash
  width?: number;
  height?: number;
};

// API haut-niveau pour le pipeline avatar
export type AvatarRecord = {
  hash: string;     // SHA-256 hex des octets finaux encodés
  blob: Blob;       // miniature/visuel compressé
  mime: string;
  width: number;
  height: number;
};

// Enregistrement de profil local minimal
export type Gender = 'male' | 'female' | 'other' | undefined;
export type UserProfileRecord = {
  id: string;                 // identifiant stable local (clientId)
  displayName?: string;
  age?: number;
  gender?: Gender;
  avatarHash?: string;        // référence vers avatars.id (hash)
  avatarMime?: string;
  avatarW?: number;
  avatarH?: number;
  avatarVersion?: number;     // bump pour invalider les caches distants
};

// Paires de clés JWK pour CryptoService
type CryptoKeyPairRecord = { publicKey: JsonWebKey; privateKey: JsonWebKey };

class IndexedDBService {
  private static instance: IndexedDBService;
  private db: IDBDatabase | null = null;

  private readonly dbName = 'NoNetChatWeb';
  // v5 (legacy) : ajout statut sur messages
  // v6 : nouvelles stores 'user' et 'kv'
  // v7 : avatars: nouveaux index (hash), width/height/type, compat pipeline par hash
  // v8 : ajout du store fileBlobs pour le stockage des fichiers reçus
  private readonly version = 8;

  public static getInstance(): IndexedDBService {
    if (!IndexedDBService.instance) {
      IndexedDBService.instance = new IndexedDBService();
    }
    return IndexedDBService.instance;
  }

  // -------------------- INIT / UPGRADE --------------------

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
        const oldVersion = event.oldVersion || 0;

        // messages
        let messageStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('messages')) {
          messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('conversationId', 'conversationId', { unique: false });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
        } else {
          messageStore = (request.transaction as IDBTransaction).objectStore('messages');
          if (!messageStore.indexNames.contains('conversationId')) {
            messageStore.createIndex('conversationId', 'conversationId', { unique: false });
          }
          if (!messageStore.indexNames.contains('timestamp')) {
            messageStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        }

        // conversations
        let conversationStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('conversations')) {
          conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        } else {
          conversationStore = (request.transaction as IDBTransaction).objectStore('conversations');
          if (!conversationStore.indexNames.contains('updatedAt')) {
            conversationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        }

        // files (inchangé)
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('messageId', 'messageId', { unique: false });
        }

        // NOUVEAU: store pour les blobs de fichiers
        if (!db.objectStoreNames.contains('fileBlobs')) {
          db.createObjectStore('fileBlobs', { keyPath: 'id' }); // id = messageId
        }

        // avatars (compat + nouveaux index)
        let avatarsStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('avatars')) {
          avatarsStore = db.createObjectStore('avatars', { keyPath: 'id' });
          // index pour retrouver via hash (id==hash pour le nouveau pipeline, mais on garde un index dédié)
          avatarsStore.createIndex('by_hash', 'hash', { unique: false });
        } else {
          avatarsStore = (request.transaction as IDBTransaction).objectStore('avatars');
          if (!avatarsStore.indexNames.contains('by_hash')) {
            avatarsStore.createIndex('by_hash', 'hash', { unique: false });
          }
        }

        // cryptoKeys
        if (!db.objectStoreNames.contains('cryptoKeys')) {
          db.createObjectStore('cryptoKeys', { keyPath: 'id' }); // id = 'user-keys'
        }

        // blockList
        if (!db.objectStoreNames.contains('blockList')) {
          db.createObjectStore('blockList', { keyPath: 'peerId' });
        }

        // user (profil local minimal)
        if (!db.objectStoreNames.contains('user')) {
          const userStore = db.createObjectStore('user', { keyPath: 'id' });
          userStore.createIndex('by_id', 'id', { unique: true });
        }

        // kv (clé/valeur divers)
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }

        // Migration legacy < 5 : ajouter status aux messages
        if (oldVersion < 5) {
          const tx = request.transaction!;
          const store = tx.objectStore('messages');
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => {
            (getAllRequest.result as StoredMessage[]).forEach((message) => {
              if (!message.status) {
                message.status = 'delivered';
                store.put(message);
              }
            });
          };
        }
      };
    });
  }

  // -------------------- UTIL --------------------

  private ensureDb(): IDBDatabase {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  // -------------------- BLOCK LIST --------------------

  async addToBlockList(peerId: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['blockList'], 'readwrite');
      tx.objectStore('blockList').put({ peerId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeFromBlockList(peerId: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['blockList'], 'readwrite');
      tx.objectStore('blockList').delete(peerId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBlockList(): Promise<string[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['blockList'], 'readonly');
      const req = tx.objectStore('blockList').getAll();
      req.onsuccess = () => resolve((req.result as Array<{ peerId: string }>).map((i) => i.peerId));
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- CRYPTO KEYS --------------------

  async saveCryptoKeys(keys: CryptoKeyPairRecord): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cryptoKeys'], 'readwrite');
      tx.objectStore('cryptoKeys').put({ id: 'user-keys', ...keys });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCryptoKeys(): Promise<CryptoKeyPairRecord | null> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['cryptoKeys'], 'readonly');
      const req = tx.objectStore('cryptoKeys').get('user-keys');
      req.onsuccess = () => resolve((req.result as CryptoKeyPairRecord) || null);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- MESSAGES & CONVERSATIONS --------------------

  async saveMessage(message: StoredMessage, conversationId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages', 'conversations'], 'readwrite');
      const messageStore = tx.objectStore('messages');
      const conversationStore = tx.objectStore('conversations');

      const getRequest = conversationStore.get(conversationId);
      getRequest.onsuccess = () => {
        const conversation = getRequest.result as StoredConversation | undefined;
        const updatedConversation: StoredConversation = {
          id: conversationId,
          participantId: message.senderId === 'current_user' ? message.receiverId : message.senderId,
          participantName: conversation?.participantName || 'Unknown User',
          participantAvatar: conversation?.participantAvatar || '',
          participantAge: conversation?.participantAge,
          participantGender: conversation?.participantGender,
          lastMessage: { ...message, conversationId },
          unreadCount: message.senderId === 'current_user' ? (conversation?.unreadCount || 0) : (conversation?.unreadCount || 0) + 1,
          updatedAt: Date.now(),
        };

        conversationStore.put(updatedConversation);
        messageStore.put({ ...message, conversationId });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMessages(conversationId: string, limit = 50): Promise<StoredMessage[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('conversationId');
      const req = index.getAll(conversationId);

      req.onsuccess = () => {
        const messages = (req.result as StoredMessage[])
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-limit);
        resolve(messages);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getConversation(conversationId: string): Promise<StoredConversation | null> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations'], 'readonly');
      const req = tx.objectStore('conversations').get(conversationId);
      req.onsuccess = () => resolve((req.result as StoredConversation) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllConversations(): Promise<StoredConversation[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations'], 'readonly');
      const store = tx.objectStore('conversations');
      const index = store.index('updatedAt');
      const req = index.getAll();
      req.onsuccess = () => {
        const conversations = (req.result as StoredConversation[]).sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(conversations);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async markConversationAsRead(conversationId: string): Promise<void> {
    const db = this.ensureDb();
    const conv = await this.getConversation(conversationId);
    if (!conv) return;
    conv.unreadCount = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['conversations'], 'readwrite');
      tx.objectStore('conversations').put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateMessageStatus(messageId: string, status: 'sending' | 'sent' | 'delivered' | 'read'): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(messageId);
      getReq.onsuccess = () => {
        const msg = getReq.result as StoredMessage | undefined;
        if (msg) {
          msg.status = status;
          const putReq = store.put(msg);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve(); // silencieux si introuvable
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readwrite');
      tx.objectStore('messages').delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages', 'conversations'], 'readwrite');
      const messagesStore = tx.objectStore('messages');
      const conversationsStore = tx.objectStore('conversations');

      const index = messagesStore.index('conversationId');
      const cursorReq = index.openCursor(IDBKeyRange.only(conversationId));
      cursorReq.onsuccess = (ev) => {
        const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          const delReq = conversationsStore.delete(conversationId);
          delReq.onsuccess = () => resolve(undefined);
          delReq.onerror = () => reject(delReq.error);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  async updateConversationParticipant(
    conversationId: string,
    name: string,
    avatar: string,
    age?: number,
    gender?: 'male' | 'female' | 'other',
  ): Promise<void> {
    const db = this.ensureDb();
    const conv = await this.getConversation(conversationId);
    if (!conv) return;
    conv.participantName = name;
    conv.participantAvatar = avatar;
    conv.participantAge = age;
    conv.participantGender = gender;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['conversations'], 'readwrite');
      tx.objectStore('conversations').put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async searchMessages(query: string): Promise<StoredMessage[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readonly');
      const req = tx.objectStore('messages').getAll();
      req.onsuccess = () => {
        const q = query.toLowerCase();
        const res = (req.result as StoredMessage[])
          .filter((m) => (m.content || '').toLowerCase().includes(q))
          .sort((a, b) => b.timestamp - a.timestamp);
        resolve(res);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- CLEAR ALL --------------------

  async clearAllData(): Promise<void> {
    const db = this.ensureDb();
    const stores = ['messages', 'conversations', 'files', 'fileBlobs', 'cryptoKeys', 'avatars', 'blockList', 'user', 'kv'] as const;
    await Promise.all(
      stores.map(
        (name) =>
          new Promise<void>((resolve) => {
            const tx = db.transaction([name], 'readwrite');
            tx.objectStore(name).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve(); // ne bloque pas si store absent/erreur
          }),
      ),
    );
  }

  // -------------------- AVATARS (legacy id) --------------------

  async saveAvatar(id: string, avatar: File): Promise<void> {
    const db = this.ensureDb();
    const arrayBuffer = await avatar.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['avatars'], 'readwrite');
      const store = tx.objectStore('avatars');
      const rec: AvatarStoreRecord = {
        id,
        data: arrayBuffer,
        name: avatar.name,
        type: avatar.type,
        size: avatar.size,
      };
      const req = store.put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAvatar(id: string): Promise<Blob | null> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['avatars'], 'readonly');
      const req = tx.objectStore('avatars').get(id);
      req.onsuccess = () => {
        const r = req.result as AvatarStoreRecord | undefined;
        if (r && r.data) resolve(new Blob([r.data], { type: r.type }));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAvatar(id: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['avatars'], 'readwrite');
      const req = tx.objectStore('avatars').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- AVATARS (nouveau pipeline par hash) --------------------

  /** Sauvegarde un avatar par hash (id = hash) */
  async saveAvatarByHash(rec: AvatarRecord): Promise<void> {
    const db = this.ensureDb();
    const buffer = await rec.blob.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['avatars'], 'readwrite');
      const store = tx.objectStore('avatars');
      const toSave: AvatarStoreRecord = {
        id: rec.hash,     // clé primaire = hash
        hash: rec.hash,   // index by_hash
        data: buffer,
        type: rec.mime,
        size: buffer.byteLength,
        width: rec.width,
        height: rec.height,
      };
      const req = store.put(toSave);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Récupère un avatar (miniature) par hash, sous forme de Blob */
  async getAvatarBlobByHash(hash: string): Promise<Blob | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['avatars'], 'readonly');
      const store = tx.objectStore('avatars');
      // accès direct par id = hash (prioritaire)
      const req = store.get(hash);
      req.onsuccess = () => {
        const r = req.result as AvatarStoreRecord | undefined;
        if (r?.data) resolve(new Blob([r.data], { type: r.type || 'image/webp' }));
        else {
          // fallback via index by_hash (compat)
          const idx = store.index('by_hash');
          const q = idx.get(hash);
          q.onsuccess = () => {
            const rr = q.result as AvatarStoreRecord | undefined;
            resolve(rr?.data ? new Blob([rr.data], { type: rr.type || 'image/webp' }) : undefined);
          };
          q.onerror = () => reject(q.error);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAvatarByHash(hash: string): Promise<void> {
    await this.deleteAvatar(hash); // id = hash
  }

  // -------------------- PROFIL LOCAL (store 'user') --------------------

  async saveUserProfile(profile: UserProfileRecord): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['user'], 'readwrite');
      tx.objectStore('user').put(profile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getUserProfile(id: string): Promise<UserProfileRecord | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['user'], 'readonly');
      const req = tx.objectStore('user').get(id);
      req.onsuccess = () => resolve(req.result as UserProfileRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- KV GÉNÉRIQUE (store 'kv') --------------------

  async setKV<T = any>(key: string, value: T): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['kv'], 'readwrite');
      tx.objectStore('kv').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getKV<T = any>(key: string): Promise<T | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['kv'], 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result?.value as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- FICHIERS (complément message) --------------------

  // -------------------- FILE BLOBS --------------------

  async saveFileBlob(id: string, blob: Blob): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['fileBlobs'], 'readwrite');
      const req = tx.objectStore('fileBlobs').put({ id, blob });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getFileBlob(id: string): Promise<Blob | null> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['fileBlobs'], 'readonly');
      const req = tx.objectStore('fileBlobs').get(id);
      req.onsuccess = () => resolve((req.result as { id: string; blob: Blob } | undefined)?.blob || null);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------- FICHIERS (complément message) --------------------

  async updateMessageFileData(
    messageId: string,
    fileData: { name: string; size: number; type: string; url: string },
  ): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(messageId);
      getReq.onsuccess = () => {
        const msg = getReq.result as StoredMessage | undefined;
        if (msg) {
          msg.fileData = fileData;
          msg.content = fileData.name;
          const putReq = store.put(msg);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          console.warn(`Message with id ${messageId} not found for file data update.`);
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
}

export default IndexedDBService;
