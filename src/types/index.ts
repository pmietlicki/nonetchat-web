export interface User {
  id: string;
  name: string;
  avatar: string;
  age?: number;
  gender?: string;
  status: 'online' | 'offline' | 'busy';
  joinedAt: string;
  publicKey?: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file' | 'image';
  encrypted: boolean;
  fileData?: FileData;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  reactions?: { [emoji: string]: string[] };
}

export interface FileData {
  name: string;
  size: number;
  type: string;
  url: string;
  thumbnail?: string;
}

export interface Conversation {
  id: string;
  participantId: string;
  messages: Message[];
  lastMessage?: Message;
  unreadCount: number;
}

export interface PeerConnection {
  id: string;
  user: User;
  connection: 'bluetooth' | 'wifi' | 'direct';
  signal: number;
  isConnected: boolean;
  discoveredAt: Date;
}

export interface EncryptionKeys {
  publicKey: string;
  privateKey: string;
}