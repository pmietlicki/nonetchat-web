import { describe, it, expect, beforeAll, vi } from 'vitest';
import CryptoService from './CryptoService';

// Mock du IndexedDBService pour isoler le CryptoService du stockage réel
vi.mock('./IndexedDBService', () => {
  const db = new Map();
  return {
    default: {
      getInstance: () => ({
        saveCryptoKeys: (keys: any) => {
          db.set('user-keys', keys);
          return Promise.resolve();
        },
        getCryptoKeys: () => {
          return Promise.resolve(db.get('user-keys'));
        },
      }),
    },
  };
});

describe('CryptoService', () => {
  let cryptoService: CryptoService;

  const peerIdA = 'peer-A';
  const peerIdB = 'peer-B';

  // Avant tous les tests, on initialise le service et on simule un échange de clés
  beforeAll(async () => {
    cryptoService = CryptoService.getInstance();
    await cryptoService.initialize();

    // Simuler un second pair (Peer B) en générant sa propre paire de clés
    const keysB = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    const publicKeyJwkB = await window.crypto.subtle.exportKey('jwk', keysB.publicKey);

    // 1. Peer A dérive le secret partagé en utilisant la clé publique de Peer B
    await cryptoService.deriveSharedSecret(peerIdB, publicKeyJwkB);

    // 2. Simuler la dérivation du secret du point de vue de Peer B
    const publicKeyJwkA = await cryptoService.getPublicKeyJwk();
    const importedPublicKeyA = await window.crypto.subtle.importKey('jwk', publicKeyJwkA!, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const sharedSecretB = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: importedPublicKeyA },
      keysB.privateKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    // On stocke le secret de B dans la même instance pour les besoins du test
    (cryptoService as any).sharedSecrets.set(peerIdA, sharedSecretB);
  });

  it('devrait initialiser et générer une paire de clés valide', async () => {
    const publicKey = await cryptoService.getPublicKeyJwk();
    expect(publicKey).toBeDefined();
    expect(publicKey?.kty).toBe('EC');
    expect(publicKey?.crv).toBe('P-256');
  });

  it('devrait dériver un secret partagé pour un pair', async () => {
    const secret = (cryptoService as any).sharedSecrets.get(peerIdB);
    expect(secret).toBeDefined();
    expect(secret.type).toBe('secret');
    expect(secret.algorithm.name).toBe('AES-GCM');
  });

  it('devrait chiffrer et déchiffrer un message texte avec succès', async () => {
    const originalMessage = 'Ceci est un message secret de test.';

    // Peer A chiffre un message pour Peer B
    const encryptedPayload = await cryptoService.encryptMessage(peerIdB, originalMessage);
    expect(encryptedPayload).toBeTypeOf('string');

    // Peer B (simulé) déchiffre le message de Peer A
    const decryptedMessage = await cryptoService.decryptMessage(peerIdA, encryptedPayload);
    
    expect(decryptedMessage).toBe(originalMessage);
  });

  it('devrait chiffrer et déchiffrer un fichier avec succès', async () => {
    const fileContent = 'Contenu du fichier de test.';
    const testFile = new File([fileContent], 'test.txt', { type: 'text/plain' });

    // Chiffrer le fichier
    const encryptedBlob = await cryptoService.encryptFile(testFile);
    expect(encryptedBlob).toBeInstanceOf(Blob);
    
    // Déchiffrer le fichier
    const decryptedBlob = await cryptoService.decryptFile(encryptedBlob);
    expect(decryptedBlob).toBeInstanceOf(Blob);
    
    const decryptedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(decryptedBlob);
    });
    expect(decryptedText).toBe(fileContent);
  });

  it('devrait gérer une erreur de déchiffrement avec une mauvaise clé', async () => {
    const originalMessage = 'un autre message';
    const encryptedPayload = await cryptoService.encryptMessage(peerIdB, originalMessage);

    // Tenter de déchiffrer avec un ID de pair incorrect (pour lequel aucun secret n'a été dérivé)
    await expect(cryptoService.decryptMessage('peer-C', encryptedPayload))
      .rejects.toThrow('Shared secret not derived for this peer');
  });
});
