import IndexedDBService from './IndexedDBService';

class CryptoService {
  private static instance: CryptoService;
  private dbService: IndexedDBService;
  private keyPair: CryptoKeyPair | null = null;
  private sharedSecrets: Map<string, CryptoKey> = new Map();

  private constructor() {
    this.dbService = IndexedDBService.getInstance();
  }

  public static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  async initialize(): Promise<void> {
    const storedKeys = await this.dbService.getCryptoKeys();
    if (storedKeys) {
      const publicKey = await window.crypto.subtle.importKey(
        'jwk',
        storedKeys.publicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      const privateKey = await window.crypto.subtle.importKey(
        'jwk',
        storedKeys.privateKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
      );
      this.keyPair = { publicKey, privateKey };
    } else {
      await this.generateKeys();
    }
  }

  private async generateKeys(): Promise<void> {
    this.keyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', this.keyPair.publicKey!);
    const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', this.keyPair.privateKey!);

    await this.dbService.saveCryptoKeys({ publicKey: publicKeyJwk, privateKey: privateKeyJwk });
  }

  async getPublicKeyJwk(): Promise<JsonWebKey | null> {
    if (!this.keyPair) return null;
    return await window.crypto.subtle.exportKey('jwk', this.keyPair.publicKey!);
  }

  async deriveSharedSecret(peerId: string, peerPublicKeyJwk: JsonWebKey): Promise<void> {
    const peerPublicKey = await window.crypto.subtle.importKey(
      'jwk',
      peerPublicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    const sharedSecret = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      this.keyPair!.privateKey!,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    this.sharedSecrets.set(peerId, sharedSecret);
  }

  async encryptMessage(peerId: string, message: string): Promise<string> {
    const secretKey = this.sharedSecrets.get(peerId);
    if (!secretKey) throw new Error('Shared secret not derived for this peer');

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedMessage = new TextEncoder().encode(message);

    const encryptedData = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      secretKey,
      encodedMessage
    );

    const bufferToBase64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

    return JSON.stringify({
      iv: bufferToBase64(iv),
      data: bufferToBase64(encryptedData),
    });
  }

  async decryptMessage(peerId: string, jsonPayload: string): Promise<string> {
    const secretKey = this.sharedSecrets.get(peerId);
    if (!secretKey) throw new Error('Shared secret not derived for this peer');

    try {
      const payload = JSON.parse(jsonPayload);
      const base64ToBuffer = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const iv = base64ToBuffer(payload.iv);
      const data = base64ToBuffer(payload.data);

      const decryptedData = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        secretKey,
        data
      );

      return new TextDecoder().decode(decryptedData);
    } catch (error) {
      console.error('Decryption failed:', error);
      return 'Failed to decrypt message';
    }
  }
}

export default CryptoService;
