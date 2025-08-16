import { describe, it, expect, beforeEach, vi } from 'vitest';
import NotificationService from './NotificationService';

// --- Mocks for Browser APIs ---

const mockNotification = vi.fn() as any;
// Attacher les méthodes et propriétés statiques que le service utilise
mockNotification.requestPermission = vi.fn().mockResolvedValue('default');
Object.defineProperty(mockNotification, 'permission', {
  value: 'default',
  writable: true,
  configurable: true, // Important pour permettre à vi.spyOn de fonctionner
});

const mockStart = vi.fn();
const mockAudioContext = {
  createBuffer: vi.fn(() => ({
    getChannelData: vi.fn(() => new Float32Array(1)),
  })),
  createBufferSource: () => ({
    buffer: null,
    connect: vi.fn(),
    start: mockStart, // Toujours retourner le même spy
  }),
  decodeAudioData: vi.fn(),
};

const mockLocalStorage = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal('Notification', mockNotification);
vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));
vi.stubGlobal('localStorage', mockLocalStorage);


// --- Tests ---

describe('NotificationService', () => {
  let notificationService: NotificationService;
  const conversationId = 'conv-123';
  const message = {
    id: 'msg-1',
    conversationId,
    content: 'Test message',
    timestamp: Date.now(),
    type: 'text' as const,
    senderName: 'Tester',
  };

  beforeEach(() => {
    // @ts-ignore - Reset singleton instance for test isolation
    NotificationService.instance = null;
    notificationService = NotificationService.getInstance();
    mockLocalStorage.clear();
    vi.clearAllMocks();
    // Attacher manuellement les mocks à l'objet navigator de jsdom
    (window.navigator as any).setAppBadge = vi.fn();
    (window.navigator as any).clearAppBadge = vi.fn();

    // Mock read-only properties correctly
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(Notification, 'permission', 'get').mockReturnValue('default');
  });

  it('should load default settings', () => {
    const settings = notificationService.getSettings();
    expect(settings.globalEnabled).toBe(true);
    expect(settings.soundEnabled).toBe(true);
    expect(settings.doNotDisturb).toBe(false);
  });

  it('should update settings and save to localStorage', () => {
    notificationService.updateSettings({ globalEnabled: false, soundEnabled: false });
    const settings = notificationService.getSettings();
    expect(settings.globalEnabled).toBe(false);
    expect(settings.soundEnabled).toBe(false);
    expect(JSON.parse(mockLocalStorage.getItem('notificationSettings') || '{}').globalEnabled).toBe(false);
  });

  it('should add an unread message and update counts', () => {
    notificationService.addMessage(conversationId, message);
    expect(notificationService.getTotalUnreadCount()).toBe(1);
    expect(notificationService.getConversationUnreadCount(conversationId)).toBe(1);
  });

  it('should mark a conversation as read and reset counts', () => {
    notificationService.addMessage(conversationId, message);
    expect(notificationService.getTotalUnreadCount()).toBe(1);

    notificationService.markConversationAsRead(conversationId);
    expect(notificationService.getTotalUnreadCount()).toBe(0);
    expect(notificationService.getConversationUnreadCount(conversationId)).toBe(0);
  });

  it('should show a system notification if enabled and tab is hidden', () => {
    vi.spyOn(Notification, 'permission', 'get').mockReturnValue('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    notificationService.updateSettings({ systemNotificationsEnabled: true });
    notificationService.addMessage(conversationId, message);

    expect(mockNotification).toHaveBeenCalledWith('Nouveau message de Tester', {
      body: 'Test message',
      icon: '/manifest.json',
      tag: conversationId,
      requireInteraction: false,
    });
  });

  it('should NOT show a system notification if tab is visible', () => {
    vi.spyOn(Notification, 'permission', 'get').mockReturnValue('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    notificationService.updateSettings({ systemNotificationsEnabled: true });
    notificationService.addMessage(conversationId, message);

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('should NOT show a system notification if permission is not granted', () => {
    vi.spyOn(Notification, 'permission', 'get').mockReturnValue('denied');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    notificationService.updateSettings({ systemNotificationsEnabled: true });
    notificationService.addMessage(conversationId, message);

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('should play a sound if enabled', () => {
    notificationService.updateSettings({ soundEnabled: true });
    notificationService.addMessage(conversationId, message);
    expect(mockStart).toHaveBeenCalled();
  });

  it('should NOT play a sound if disabled', () => {
    notificationService.updateSettings({ soundEnabled: false });
    notificationService.addMessage(conversationId, message);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('should NOT trigger any notification when Do Not Disturb is on', () => {
    vi.spyOn(Notification, 'permission', 'get').mockReturnValue('granted');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    notificationService.updateSettings({ doNotDisturb: true, soundEnabled: true, systemNotificationsEnabled: true });

    notificationService.addMessage(conversationId, message);

    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('should update the app badge', () => {
    // Forcer les paramètres pour garantir que le test est indépendant
    notificationService.updateSettings({ globalEnabled: true, doNotDisturb: false });

    notificationService.addMessage(conversationId, message);
    expect(navigator.setAppBadge).toHaveBeenCalledWith(1);

    notificationService.addMessage(conversationId, { ...message, id: 'msg-2' });
    expect(navigator.setAppBadge).toHaveBeenCalledWith(2);

    notificationService.markConversationAsRead(conversationId);
    expect((navigator as any).clearAppBadge).toHaveBeenCalled();
  });
});