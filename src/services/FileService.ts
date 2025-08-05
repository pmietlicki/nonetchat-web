import { FileData } from '../types';
import CryptoService from './CryptoService';

class FileService {
  private static instance: FileService;
  private cryptoService: CryptoService;

  public static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  constructor() {
    this.cryptoService = CryptoService.getInstance();
  }

  async processFile(file: File): Promise<FileData> {
    // Validation du fichier
    if (!this.isValidFile(file)) {
      throw new Error('Type de fichier non supporté');
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB max
      throw new Error('Fichier trop volumineux (max 50MB)');
    }

    const encryptedFile = await this.cryptoService.encryptFile(file);
    const url = URL.createObjectURL(encryptedFile);
    
    const fileData: FileData = {
      name: file.name,
      size: file.size,
      type: file.type,
      url,
      thumbnail: await this.generateThumbnail(file)
    };

    return fileData;
  }

  private isValidFile(file: File): boolean {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    return allowedTypes.includes(file.type);
  }

  private async generateThumbnail(file: File): Promise<string | undefined> {
    if (!file.type.startsWith('image/')) {
      return undefined;
    }

    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        const maxSize = 200;
        let { width, height } = img;

        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };

      img.src = URL.createObjectURL(file);
    });
  }

  formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  getFileIcon(type: string): string {
    if (type.startsWith('image/')) return '🖼️';
    if (type === 'application/pdf') return '📄';
    if (type.startsWith('text/')) return '📝';
    if (type.includes('word')) return '📄';
    return '📎';
  }

  async downloadFile(fileData: FileData): Promise<void> {
    const response = await fetch(fileData.url);
    const blob = await response.blob();
    const decryptedBlob = await this.cryptoService.decryptFile(blob);
    
    const url = URL.createObjectURL(decryptedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export default FileService;