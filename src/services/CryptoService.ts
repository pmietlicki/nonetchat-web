import IndexedDBService from './IndexedDBService';

// ----- Helpers d'environnement (résolution paresseuse) -----
function resolveCrypto(): Crypto {
  // 1) Browser/jsdom/happy-dom
  const existing =
    (globalThis as any).crypto ??
    (typeof window !== 'undefined' ? (window as any).crypto : undefined);

  if (existing?.subtle) return existing as Crypto;

  // 2) Node (vitest) : fallback vers node:crypto.webcrypto
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('node:crypto');
    if (webcrypto?.subtle) {
      // Mémorise pour les prochains appels
      (globalThis as any).crypto = webcrypto;
      return webcrypto as unknown as Crypto;
    }
  } catch {
    // ignore, on lève plus bas
  }
  throw new Error('WebCrypto API is not available in this environment (subtle missing).');
}

function getSubtle(): SubtleCrypto {
  return resolveCrypto().subtle;
}

function getRand(): Crypto {
  return resolveCrypto();
}

// Compat Node/jsdom pour base64
function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (typeof btoa !== 'undefined') {
    // navigateur/jsdom
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  // Node
  return Buffer.from(u8).toString('base64');
}

function base64ToU8(base64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

// ----- Service -----
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
      const publicKey = await getSubtle().importKey(
        'jwk',
        storedKeys.publicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      const privateKey = await getSubtle().importKey(
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
    this.keyPair = await getSubtle().generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    const publicKeyJwk = await getSubtle().exportKey('jwk', this.keyPair.publicKey!);
    const privateKeyJwk = await getSubtle().exportKey('jwk', this.keyPair.privateKey!);

    await this.dbService.saveCryptoKeys({ publicKey: publicKeyJwk, privateKey: privateKeyJwk });
  }

  async getPublicKeyJwk(): Promise<JsonWebKey | null> {
    if (!this.keyPair) return null;
    return await getSubtle().exportKey('jwk', this.keyPair.publicKey!);
  }

  async deriveSharedSecret(peerId: string, peerPublicKeyJwk: JsonWebKey): Promise<void> {
    const peerPublicKey = await getSubtle().importKey(
      'jwk',
      peerPublicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    const sharedSecret = await getSubtle().deriveKey(
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

    const iv = getRand().getRandomValues(new Uint8Array(12));
    const encodedMessage = new TextEncoder().encode(message);

    const encryptedData = await getSubtle().encrypt(
      { name: 'AES-GCM', iv },
      secretKey,
      encodedMessage
    );

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

      const iv = base64ToU8(payload.iv);
      const data = base64ToU8(payload.data);

      const decryptedData = await getSubtle().decrypt(
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

  // Compresser un fichier avec gzip
  private async compressFile(file: Blob): Promise<Blob> {
    if (typeof (globalThis as any).CompressionStream === 'undefined' || !file.stream) {
      console.warn('CompressionStream API not supported, skipping compression.');
      return file;
    }
    try {
      const stream = new (globalThis as any).CompressionStream('gzip');
      const compressedStream = (file as any).stream().pipeThrough(stream);
      return new Response(compressedStream).blob();
    } catch (error) {
      console.warn('Compression non supportée, fichier non compressé:', error);
      return file;
    }
  }

  // Décompresser un fichier avec gzip
  private async decompressFile(compressedBlob: Blob): Promise<Blob> {
    if (typeof (globalThis as any).DecompressionStream === 'undefined' || !compressedBlob.stream) {
      console.warn('DecompressionStream API not supported, skipping decompression.');
      return compressedBlob;
    }
    try {
      const stream = new (globalThis as any).DecompressionStream('gzip');
      const decompressedStream = (compressedBlob as any).stream().pipeThrough(stream);
      return new Response(decompressedStream).blob();
    } catch (error) {
      console.warn('Décompression échouée, retour du fichier original:', error);
      return compressedBlob;
    }
  }

  async encryptFile(file: File): Promise<Blob> {
    try {
      const compressedFile = await this.compressFile(file);

      console.log(
        `Compression: ${file.size} bytes -> ${compressedFile.size} bytes (${Math.round(
          (1 - compressedFile.size / file.size) * 100
        )}% de réduction)`
      );

      const key = await getSubtle().generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const iv = getRand().getRandomValues(new Uint8Array(12));

      const fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(compressedFile);
      });

      const dataToEncrypt = new Uint8Array(fileBuffer);

      const encryptedData = await getSubtle().encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataToEncrypt
      );

      const exportedKey = await getSubtle().exportKey('raw', key);

      const originalSize = new Uint8Array(4);
      new DataView(originalSize.buffer).setUint32(0, file.size, true);

      const header = new Uint8Array(12 + 32 + 4); // 12 IV + 32 key + 4 size
      header.set(iv, 0);
      header.set(new Uint8Array(exportedKey), 12);
      header.set(originalSize, 44);

      const result = new Uint8Array(header.length + encryptedData.byteLength);
      result.set(header, 0);
      result.set(new Uint8Array(encryptedData), header.length);

      return new Blob([result]);
    } catch (error) {
      console.error('Erreur lors du chiffrement du fichier:', error);
      throw error;
    }
  }

  async decryptFile(encryptedBlob: Blob): Promise<Blob> {
    try {
      const encryptedBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(encryptedBlob);
      });
      const encryptedArray = new Uint8Array(encryptedBuffer);

      const iv = encryptedArray.slice(0, 12);
      const keyData = encryptedArray.slice(12, 44);
      const originalSizeData = encryptedArray.slice(44, 48);
      // Utilisable si besoin
      const _originalSize = new DataView(originalSizeData.buffer).getUint32(0, true);

      const encryptedData = encryptedArray.slice(48);

      const key = await getSubtle().importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decryptedData = await getSubtle().decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );

      const compressedBlob = new Blob([decryptedData]);
      const decompressedBlob = await this.decompressFile(compressedBlob);

      console.log(`Décompression: ${compressedBlob.size} bytes -> ${decompressedBlob.size} bytes`);

      return decompressedBlob;
    } catch (error) {
      console.error('Erreur lors du déchiffrement du fichier:', error);
      throw error;
    }
  }
}

export default CryptoService;
