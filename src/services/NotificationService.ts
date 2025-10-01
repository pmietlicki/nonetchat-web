import { t } from '../i18n';

interface NotificationSettings {
  globalEnabled: boolean;
  soundEnabled: boolean;
  systemNotificationsEnabled: boolean;
  doNotDisturb: boolean;
  nearbyNotificationsEnabled: boolean;
  conversationSettings: Map<string, {
    soundEnabled: boolean;
    notificationsEnabled: boolean;
  }>;
}

interface UnreadMessage {
  id: string;
  conversationId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file';
  senderName: string;
}

class NotificationService {
  private static instance: NotificationService;
  private settings: NotificationSettings;
  private unreadMessages: Map<string, UnreadMessage[]> = new Map();
  private lastSeenTimestamps: Map<string, number> = new Map();
  private isTabVisible: boolean = true;
  private audioContext: AudioContext | null = null;
  private notificationSound: AudioBuffer | null = null;
  private audioInitPromise: Promise<void> | null = null;
  private listeners: Map<string, Function[]> = new Map();
  private nearbyNotifiedAt: Map<string, number> = new Map();
  private readonly nearbyCooldownMs = 15 * 60 * 1000; // 15 minutes

  private constructor() {
    this.settings = this.loadSettings();
    this.setupVisibilityDetection();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  private loadSettings(): NotificationSettings {
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        nearbyNotificationsEnabled: parsed.nearbyNotificationsEnabled ?? true,
        conversationSettings: new Map(parsed.conversationSettings || [])
      };
    }
    return {
      globalEnabled: true,
      soundEnabled: true,
      systemNotificationsEnabled: true,
      doNotDisturb: false,
      nearbyNotificationsEnabled: true,
      conversationSettings: new Map()
    };
  }

  private saveSettings(): void {
    const toSave = {
      ...this.settings,
      conversationSettings: Array.from(this.settings.conversationSettings.entries())
    };
    localStorage.setItem('notificationSettings', JSON.stringify(toSave));
  }

  private async initializeAudio(): Promise<void> {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (error) {
          console.warn('Audio context resume failed:', error);
        }
      }
      return;
    }

    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioCtx) {
      console.warn('AudioContext API not supported in this environment.');
      return;
    }

    try {
      this.audioContext = new AudioCtx();
      const buffer = this.audioContext.createBuffer(1, 44100 * 0.1, 44100);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin(2 * Math.PI * 800 * i / 44100) * 0.1;
      }
      this.notificationSound = buffer;
    } catch (error) {
      console.warn('Audio context initialization failed:', error);
    }
  }

  async prepareSound(): Promise<void> {
    if (this.audioContext && this.notificationSound) {
      return;
    }

    if (!this.audioInitPromise) {
      this.audioInitPromise = this.initializeAudio().finally(() => {
        this.audioInitPromise = null;
      });
    }

    await this.audioInitPromise;
  }

  private setupVisibilityDetection(): void {
    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = !document.hidden;
      this.emit('visibility-changed', this.isTabVisible);
    });

    window.addEventListener('focus', () => {
      this.isTabVisible = true;
      this.emit('visibility-changed', true);
    });

    window.addEventListener('blur', () => {
      this.isTabVisible = false;
      this.emit('visibility-changed', false);
    });
  }

  async requestSystemPermission(): Promise<NotificationPermission | undefined> {
    if (!('Notification' in window)) {
      return undefined;
    }

    if (Notification.permission === 'default') {
      try {
        return await Notification.requestPermission();
      } catch (error) {
        console.warn('Notification permission request failed:', error);
        return undefined;
      }
    }

    return Notification.permission;
  }

  addMessage(conversationId: string, message: UnreadMessage): void {
    if (!this.unreadMessages.has(conversationId)) {
      this.unreadMessages.set(conversationId, []);
    }
    this.unreadMessages.get(conversationId)!.push(message);
    
    this.emit('unread-count-changed', this.getTotalUnreadCount());
    this.emit('conversation-unread-changed', conversationId, this.getConversationUnreadCount(conversationId));
    
    // Déclencher les notifications
    this.triggerNotifications(conversationId, message);
  }

  markConversationAsRead(conversationId: string): void {
    this.unreadMessages.delete(conversationId);
    this.lastSeenTimestamps.set(conversationId, Date.now());
    
    this.emit('unread-count-changed', this.getTotalUnreadCount());
    this.emit('conversation-unread-changed', conversationId, 0);

    this.updateAppBadge(); // Mettre à jour le badge après avoir lu les messages
  }

  markMessageAsRead(conversationId: string, messageId: string): void {
    const messages = this.unreadMessages.get(conversationId);
    if (messages) {
      const index = messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        messages.splice(index, 1);
        if (messages.length === 0) {
          this.unreadMessages.delete(conversationId);
        }
        this.emit('unread-count-changed', this.getTotalUnreadCount());
        this.emit('conversation-unread-changed', conversationId, this.getConversationUnreadCount(conversationId));
      }
    }
  }

  getTotalUnreadCount(): number {
    let total = 0;
    for (const messages of this.unreadMessages.values()) {
      total += messages.length;
    }
    return total;
  }

  getUnreadConversationsCount(): number {
    return this.unreadMessages.size;
  }

  getConversationUnreadCount(conversationId: string): number {
    return this.unreadMessages.get(conversationId)?.length || 0;
  }

  getNewMessagesSince(conversationId: string, timestamp: number): UnreadMessage[] {
    const messages = this.unreadMessages.get(conversationId) || [];
    return messages.filter(m => m.timestamp > timestamp);
  }

  getLastSeenTimestamp(conversationId: string): number {
    return this.lastSeenTimestamps.get(conversationId) || 0;
  }

  private triggerNotifications(conversationId: string, message: UnreadMessage): void {
    if (!this.settings.globalEnabled || this.settings.doNotDisturb) {
      return;
    }

    const conversationSettings = this.settings.conversationSettings.get(conversationId);
    if (conversationSettings && !conversationSettings.notificationsEnabled) {
      return;
    }

    // Son
    if (this.settings.soundEnabled && (!conversationSettings || conversationSettings.soundEnabled)) {
      this.playNotificationSound();
    }

    // Notification système
    if (this.settings.systemNotificationsEnabled && document.hidden) {
      this.showSystemNotification(message);
    }

    // Mettre à jour le badge de l'application
    this.updateAppBadge();
  }

  private playNotificationSound(): void {
    if (this.audioContext && this.notificationSound) {
      try {
        const source = this.audioContext.createBufferSource();
        source.buffer = this.notificationSound;
        source.connect(this.audioContext.destination);
        source.start();
      } catch (error) {
        console.warn('Failed to play notification sound:', error);
      }
    }
  }

  private showSystemNotification(message: UnreadMessage): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(`Nouveau message de ${message.senderName}`, {
        body: message.type === 'file' ? '📎 Fichier partagé' : message.content,
        icon: '/manifest.json', // Vous pouvez ajouter une icône
        tag: message.conversationId, // Remplace les notifications précédentes de la même conversation
        requireInteraction: false
      });

      notification.onclick = () => {
        window.focus();
        this.emit('notification-clicked', message.conversationId);
        notification.close();
      };

      // Auto-fermeture après 5 secondes
      setTimeout(() => notification.close(), 5000);
    }
  }

  private async showNearbyPeerSystemNotification(details: { title: string; body: string; icon?: string; tag: string }): Promise<void> {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    const icon = details.icon || '/manifest-icon-192.png';

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(details.title, {
          body: details.body,
          icon,
          badge: '/manifest-icon-96.png',
          tag: details.tag,
          data: { type: 'nearby-peer', peerId: details.tag },
          requireInteraction: false,
        });
        return;
      }
    } catch (error) {
      console.warn('Failed to show notification via service worker', error);
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(details.title, {
        body: details.body,
        icon,
        tag: details.tag,
        requireInteraction: false,
      });
    }
  }

  private updateAppBadge(): void {
    const count = this.getTotalUnreadCount();
    
    // App Badging API (PWA)
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        (navigator as any).setAppBadge(count);
      } else {
        (navigator as any).clearAppBadge();
      }
    }

    // Favicon badge (fallback)
    this.updateFaviconBadge(count);
  }

  private updateFaviconBadge(count: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    // Dessiner l'icône de base (vous pouvez améliorer cela)
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('💬', 16, 22);

    // Ajouter le badge si nécessaire
    if (count > 0) {
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(24, 8, 8, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = 'white';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(count > 99 ? '99+' : count.toString(), 24, 12);
    }

    // Mettre à jour le favicon
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement || document.createElement('link');
    link.rel = 'icon';
    link.href = canvas.toDataURL();
    if (!document.querySelector('link[rel="icon"]')) {
      document.head.appendChild(link);
    }
  }

  // Gestion des paramètres
  updateSettings(newSettings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    this.emit('settings-changed', this.settings);
  }

  updateConversationSettings(conversationId: string, settings: { soundEnabled: boolean; notificationsEnabled: boolean }): void {
    this.settings.conversationSettings.set(conversationId, settings);
    this.saveSettings();
    this.emit('settings-changed', this.settings);
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  getConversationSettings(conversationId: string) {
    return this.settings.conversationSettings.get(conversationId) || {
      soundEnabled: true,
      notificationsEnabled: true
    };
  }

  // Système d'événements
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    }
  }

  // Méthodes utilitaires
  getTabVisibility(): boolean {
    return this.isTabVisible;
  }

  clearAllNotifications(): void {
    this.unreadMessages.clear();
    this.updateAppBadge();
    this.emit('unread-count-changed', 0);
  }

  private pruneNearbyHistory(reference = Date.now()): void {
    const threshold = reference - this.nearbyCooldownMs;
    for (const [peerId, ts] of this.nearbyNotifiedAt.entries()) {
      if (ts < threshold) this.nearbyNotifiedAt.delete(peerId);
    }
  }

  notifyNearbyPeer(details: { peerId: string; displayName?: string; distanceLabel?: string; avatar?: string }): void {
    if (!details.peerId) return;
    if (!this.settings.globalEnabled || this.settings.doNotDisturb || !this.settings.nearbyNotificationsEnabled) {
      return;
    }

    const now = Date.now();
    this.pruneNearbyHistory(now);
    const lastNotified = this.nearbyNotifiedAt.get(details.peerId);
    if (lastNotified && now - lastNotified < this.nearbyCooldownMs) {
      return;
    }
    this.nearbyNotifiedAt.set(details.peerId, now);

    const displayName = details.displayName?.trim() || t('notifications.nearby.unknown_user');
    const distanceText = details.distanceLabel;
    const title = t('notifications.nearby.title', { name: displayName });
    const body = distanceText
      ? t('notifications.nearby.body_with_distance', { distance: distanceText })
      : t('notifications.nearby.body');

    if (this.settings.soundEnabled) {
      this.playNotificationSound();
    }

    if (this.settings.systemNotificationsEnabled) {
      void this.showNearbyPeerSystemNotification({
        title,
        body,
        icon: details.avatar,
        tag: `nearby-peer-${details.peerId}`,
      });
    }

    this.emit('nearby-peer-notified', { peerId: details.peerId, displayName, distanceLabel: distanceText });
  }
}

export default NotificationService;
