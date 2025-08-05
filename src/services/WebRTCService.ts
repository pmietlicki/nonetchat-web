import SimplePeer from 'simple-peer';
import { v4 as uuidv4 } from 'uuid';

type SignalData = SimplePeer.SignalData;

interface Message {
  id: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file-info';
  fileInfo?: {
    name: string;
    size: number;
    type: string;
  };
}

class WebRTCService {
  private static instance: WebRTCService;
  private signaling: WebSocket | null = null;
  private peers: Map<string, SimplePeer.Instance> = new Map();
  private clientId: string | null = null;

  public onPeerConnect: (peerId: string) => void = () => {};
  public onPeerDisconnect: (peerId: string) => void = () => {};
  public onMessage: (senderId: string, message: Message) => void = () => {};
  public onFile: (senderId: string, file: Blob, fileName: string) => void = () => {};

  public static getInstance(): WebRTCService {
    if (!WebRTCService.instance) {
      WebRTCService.instance = new WebRTCService();
    }
    return WebRTCService.instance;
  }

  connect(serverUrl: string) {
    if (this.signaling) return;

    this.signaling = new WebSocket(serverUrl);

    this.signaling.onopen = () => {
      console.log('Connected to signaling server');
    };

    this.signaling.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message);
    };

    this.signaling.onclose = () => {
      console.log('Disconnected from signaling server');
      this.peers.forEach(peer => peer.destroy());
      this.peers.clear();
      this.signaling = null;
    };
  }

  private handleSignalingMessage(message: any) {
    switch (message.type) {
      case 'welcome':
        this.clientId = message.clientId;
        console.log(`My ID is: ${this.clientId}`);
        // Connect to existing peers
        message.peers.forEach((peerId: string) => this.createPeer(peerId, true));
        break;
      case 'user-joined':
        console.log(`User joined: ${message.clientId}`);
        this.createPeer(message.clientId, false);
        break;
      case 'user-left':
        console.log(`User left: ${message.clientId}`);
        if (this.peers.has(message.clientId)) {
          this.peers.get(message.clientId)?.destroy();
          this.peers.delete(message.clientId);
          this.onPeerDisconnect(message.clientId);
        }
        break;
      case 'signal':
        if (this.peers.has(message.senderId)) {
          this.peers.get(message.senderId)?.signal(message.signal);
        }
        break;
    }
  }

  private createPeer(peerId: string, initiator: boolean) {
    if (this.peers.has(peerId)) return;

    const peer = new SimplePeer({
      initiator: initiator,
      trickle: true, // Important for NAT traversal
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    this.peers.set(peerId, peer);

    peer.on('signal', (signal) => {
      this.sendSignal(peerId, signal);
    });

    peer.on('connect', () => {
      console.log(`Connected to peer: ${peerId}`);
      this.onPeerConnect(peerId);
    });

    peer.on('data', (data) => {
      this.handlePeerData(peerId, data);
    });

    peer.on('close', () => {
      console.log(`Connection closed with peer: ${peerId}`);
      this.peers.delete(peerId);
      this.onPeerDisconnect(peerId);
    });

    peer.on('error', (err) => {
      console.error(`Error with peer ${peerId}:`, err);
    });
  }

  private handlePeerData(senderId: string, data: any) {
    try {
      // Check if the data is a file chunk (ArrayBuffer)
      if (data instanceof ArrayBuffer) {
        // This part will be handled by a file transfer manager
        console.log(`Received file chunk from ${senderId}`);
        return;
      }

      // Assume it's a JSON message
      const message = JSON.parse(data.toString());
      this.onMessage(senderId, message);

    } catch (error) {
      console.error('Error processing peer data:', error);
    }
  }

  sendMessage(peerId: string, content: string) {
    if (this.peers.has(peerId)) {
      const message: Message = {
        id: uuidv4(),
        content,
        timestamp: Date.now(),
        type: 'text',
      };
      this.peers.get(peerId)?.send(JSON.stringify(message));
      return message;
    }
  }

  sendFile(peerId: string, file: File) {
    if (!this.peers.has(peerId)) return;
    
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // 1. Send file metadata first
    const fileInfo: Message = {
      id: uuidv4(),
      content: '',
      timestamp: Date.now(),
      type: 'file-info',
      fileInfo: {
        name: file.name,
        size: file.size,
        type: file.type,
      }
    };
    peer.send(JSON.stringify(fileInfo));

    // 2. Send file content in chunks
    const chunkSize = 64 * 1024; // 64KB
    let offset = 0;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        peer.send(e.target.result as ArrayBuffer);
        offset += (e.target.result as ArrayBuffer).byteLength;
        if (offset < file.size) {
          readSlice(offset);
        }
      }
    };

    const readSlice = (o: number) => {
      const slice = file.slice(o, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  }

  private sendSignal(targetId: string, signal: SignalData) {
    const message = {
      type: 'signal',
      targetId,
      signal,
    };
    this.signaling?.send(JSON.stringify(message));
  }

  getClientId(): string | null {
    return this.clientId;
  }

  getPeers(): string[] {
    return Array.from(this.peers.keys());
  }
}

export default WebRTCService;
