import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import IndexedDBService from './IndexedDBService';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import IDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

// Avant tous les tests, on remplace les API IndexedDB globales par notre simulateur
beforeAll(() => {
  vi.stubGlobal('indexedDB', new FDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

describe('IndexedDBService', () => {
  let dbService: IndexedDBService;

  // Avant chaque test, on s'assure d'avoir une instance propre et initialisée
  beforeEach(async () => {
    // Nettoyer la fausse base de données entre les tests
    indexedDB.deleteDatabase('NoNetChatWeb');
    dbService = IndexedDBService.getInstance();
    // @ts-ignore - on force la réinitialisation pour les tests
    dbService.db = null;
    await dbService.initialize();
  });

  it('devrait initialiser la base de données avec les bons stores', async () => {
    // @ts-ignore
    const db = dbService.db as IDBDatabase;
    expect(db).toBeDefined();
    expect(db.objectStoreNames).toContain('messages');
    expect(db.objectStoreNames).toContain('conversations');
    expect(db.objectStoreNames).toContain('cryptoKeys');
    expect(db.objectStoreNames).toContain('avatars');
    expect(db.objectStoreNames).toContain('blockList');
    expect(db.objectStoreNames).toContain('pendingMessages');
  });

  it('devrait sauvegarder et récupérer les clés de chiffrement', async () => {
    const keys = {
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      privateKey: { kty: 'EC', crv: 'P-256', d: 'd' },
    };
    await dbService.saveCryptoKeys(keys as any);
    const retrievedKeys = await dbService.getCryptoKeys();
    expect(retrievedKeys).toEqual({ id: 'user-keys', ...keys });
  });

  it('devrait sauvegarder un message et créer/mettre à jour une conversation', async () => {
    const conversationId = 'peer-123';
    const message = {
      id: 'msg-1',
      senderId: 'current_user',
      receiverId: conversationId,
      content: 'Hello world',
      timestamp: Date.now(),
      type: 'text' as const,
      encrypted: true,
      status: 'sent' as const,
    };

    await dbService.saveMessage(message, conversationId);

    const messages = await dbService.getMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello world');

    const conversation = await dbService.getConversation(conversationId);
    expect(conversation).toBeDefined();
    expect(conversation?.lastMessage?.id).toBe('msg-1');
    // Le compteur de non-lus est à 0 car on est l'expéditeur
    expect(conversation?.unreadCount).toBe(0);
  });

  it('devrait incrémenter le compteur de non-lus pour les messages reçus', async () => {
    const conversationId = 'peer-456';
    const message = {
      id: 'msg-2',
      senderId: conversationId, // Message reçu
      receiverId: 'current_user',
      content: 'Are you there?',
      timestamp: Date.now(),
      type: 'text' as const,
      encrypted: true,
      status: 'delivered' as const,
    };

    await dbService.saveMessage(message, conversationId);
    const conversation = await dbService.getConversation(conversationId);
    expect(conversation?.unreadCount).toBe(1);
  });

  it('devrait marquer une conversation comme lue', async () => {
    const conversationId = 'peer-789';
    const message = { id: 'msg-3', senderId: conversationId, receiverId: 'current_user', content: '...ping...', timestamp: Date.now(), type: 'text' as const, encrypted: true, status: 'delivered' as const };
    
    await dbService.saveMessage(message, conversationId);
    let conversation = await dbService.getConversation(conversationId);
    expect(conversation?.unreadCount).toBe(1);

    await dbService.markConversationAsRead(conversationId);
    conversation = await dbService.getConversation(conversationId);
    expect(conversation?.unreadCount).toBe(0);
  });

  it('devrait mettre à jour le statut d\'un message', async () => {
    const conversationId = 'peer-abc';
    const message = { id: 'msg-4', senderId: 'current_user', receiverId: conversationId, content: 'Checking status', timestamp: Date.now(), type: 'text' as const, encrypted: true, status: 'sending' as const };

    await dbService.saveMessage(message, conversationId);
    await dbService.updateMessageStatus('msg-4', 'read');

    const messages = await dbService.getMessages(conversationId);
    expect(messages[0].status).toBe('read');
  });

  it('devrait supprimer une conversation et tous ses messages', async () => {
    const conversationId = 'peer-todelete';
    await dbService.saveMessage({ id: 'msg-5', senderId: 'current_user', receiverId: conversationId, content: 'msg 1', timestamp: Date.now(), type: 'text', encrypted: true, status: 'sent' }, conversationId);
    await dbService.saveMessage({ id: 'msg-6', senderId: conversationId, receiverId: 'current_user', content: 'msg 2', timestamp: Date.now(), type: 'text', encrypted: true, status: 'delivered' }, conversationId);

    await dbService.deleteConversation(conversationId);

    const messages = await dbService.getMessages(conversationId);
    expect(messages).toHaveLength(0);

    const conversation = await dbService.getConversation(conversationId);
    expect(conversation).toBeNull();
  });

  it('devrait persister et purger les messages en attente', async () => {
    const now = Date.now();
    const pendingMessage = {
      id: 'pending-1',
      peerId: 'peer-123',
      message: { type: 'chat-message', payload: 'Bonjour', messageId: 'pending-1' },
      createdAt: now,
    };

    await dbService.savePendingMessage(pendingMessage);
    const stored = await dbService.getPendingMessages();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'pending-1', peerId: 'peer-123' });

    await dbService.deletePendingMessage('pending-1');
    const afterDelete = await dbService.getPendingMessages();
    expect(afterDelete).toHaveLength(0);
  });
});
