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

  // Compresser un fichier avec gzip
  private async compressFile(file: Blob): Promise<Blob> {
    // Vérifier si les API de compression sont disponibles
    if (typeof CompressionStream === 'undefined' || !file.stream) {
      console.warn('CompressionStream API not supported, skipping compression.');
      return file;
    }
    try {
      const stream = new CompressionStream('gzip');
      const compressedStream = file.stream().pipeThrough(stream);
      return new Response(compressedStream).blob();
    } catch (error) {
      console.warn('Compression non supportée, fichier non compressé:', error);
      return file;
    }
  }

  // Décompresser un fichier avec gzip
  private async decompressFile(compressedBlob: Blob): Promise<Blob> {
    // Vérifier si les API de décompression sont disponibles
    if (typeof DecompressionStream === 'undefined' || !compressedBlob.stream) {
      console.warn('DecompressionStream API not supported, skipping decompression.');
      return compressedBlob;
    }
    try {
      const stream = new DecompressionStream('gzip');
      const decompressedStream = compressedBlob.stream().pipeThrough(stream);
      return new Response(decompressedStream).blob();
    } catch (error) {
      console.warn('Décompression échouée, retour du fichier original:', error);
      return compressedBlob;
    }
  }

  async encryptFile(file: File): Promise<Blob> {
    try {
      // Étape 1: Compresser le fichier
      const compressedFile = await this.compressFile(file);
      
      console.log(`Compression: ${file.size} bytes -> ${compressedFile.size} bytes (${Math.round((1 - compressedFile.size / file.size) * 100)}% de réduction)`);

      // Générer une clé symétrique pour ce fichier
      const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // Générer un IV aléatoire
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      // Lire le fichier compressé comme ArrayBuffer de manière compatible
      const fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(compressedFile);
      });

      // Créer un Uint8Array propre pour garantir la compatibilité avec l'API crypto
      const dataToEncrypt = new Uint8Array(fileBuffer);

      // Chiffrer les données
      const encryptedData = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataToEncrypt
      );

      // Exporter la clé
      const exportedKey = await window.crypto.subtle.exportKey('raw', key);

      // Créer l'en-tête avec IV, clé et taille originale
      const originalSize = new Uint8Array(4);
      new DataView(originalSize.buffer).setUint32(0, file.size, true);
      
      const header = new Uint8Array(12 + 32 + 4); // 12 bytes IV + 32 bytes key + 4 bytes original size
      header.set(iv, 0);
      header.set(new Uint8Array(exportedKey), 12);
      header.set(originalSize, 44);

      // Combiner l'en-tête et les données chiffrées
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

      // Extraire l'IV (12 premiers bytes)
      const iv = encryptedArray.slice(0, 12);

      // Extraire la clé (32 bytes suivants)
      const keyData = encryptedArray.slice(12, 44);

      // Extraire la taille originale (4 bytes suivants)
      const originalSizeData = encryptedArray.slice(44, 48);
      const originalSize = new DataView(originalSizeData.buffer).getUint32(0, true);

      // Extraire les données chiffrées (le reste)
      const encryptedData = encryptedArray.slice(48);

      // Importer la clé
      const key = await window.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // Déchiffrer les données
      const decryptedData = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );

      // Décompresser le fichier
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
