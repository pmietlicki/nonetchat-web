import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChatWindow from './ChatWindow';
import { User } from '../types';

// --- Mocks ---

const mockPeerService = {
  sendMessage: vi.fn(),
  sendFile: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  // Optionnel: si plus tard tu veux tester les ACK de lecture, tu peux mocker:
  // sendMessageReadAck: vi.fn(),
};
const mockDbService = {
  getMessages: vi.fn(),
  saveMessage: vi.fn(),
  updateConversationParticipant: vi.fn(),
  updateMessageStatus: vi.fn(),
  deleteConversation: vi.fn(),
  markConversationAsRead: vi.fn(),
};
const mockNotificationService = {
  addMessage: vi.fn(),
  markConversationAsRead: vi.fn(),
};

vi.mock('../services/PeerService', () => ({ default: { getInstance: () => mockPeerService } }));
vi.mock('../services/IndexedDBService', () => ({ default: { getInstance: () => mockDbService } }));
vi.mock('../services/NotificationService', () => ({ default: { getInstance: () => mockNotificationService } }));

// --- Test Data ---

const mockMyId = 'user-A';
const mockPeer: User = {
  id: 'peer-B',
  name: 'Bob',
  avatar: 'avatar-bob',
  status: 'online',
  joinedAt: new Date().toISOString(),
};

const mockMessages = [
  {
    id: 'msg-1',
    senderId: mockMyId,
    receiverId: mockPeer.id,
    content: 'Hello Bob',
    timestamp: Date.now() - 10000,
    type: 'text' as const,
    encrypted: true,
    status: 'read' as const,
  },
  {
    id: 'msg-2',
    senderId: mockPeer.id,
    receiverId: mockMyId,
    content: 'Hello Alice',
    timestamp: Date.now() - 5000,
    type: 'text' as const,
    encrypted: true,
    status: 'delivered' as const,
  },
];

// --- Tests ---

describe('ChatWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbService.getMessages.mockResolvedValue([...mockMessages]);
    // Les méthodes "awaitées" peuvent retourner undefined, ce qui est ok avec await
    mockDbService.saveMessage.mockResolvedValue(undefined);
    mockDbService.updateConversationParticipant.mockResolvedValue(undefined);
    mockDbService.updateMessageStatus.mockResolvedValue(undefined);
    mockDbService.markConversationAsRead.mockResolvedValue(undefined);
    mockNotificationService.markConversationAsRead.mockResolvedValue(undefined);
  });

  it('devrait afficher les messages existants et les informations du pair au chargement', async () => {
    render(<ChatWindow selectedPeer={mockPeer} myId={mockMyId} onBack={() => {}} />);

    // Attendre le rendu et les chargements async
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(await screen.findByText('En ligne')).toBeInTheDocument();
    expect(await screen.findByText('Hello Bob')).toBeInTheDocument();
    expect(await screen.findByText('Hello Alice')).toBeInTheDocument();

    await vi.waitFor(() => {
      expect(mockNotificationService.markConversationAsRead).toHaveBeenCalledWith(mockPeer.id);
    });
  });

  it("devrait envoyer un message texte quand l'utilisateur clique sur Envoyer", async () => {
    render(<ChatWindow selectedPeer={mockPeer} myId={mockMyId} onBack={() => {}} />);

    await screen.findByText('Hello Bob');

    const input = screen.getByPlaceholderText('Tapez votre message... (Swipe → pour envoyer)');
    // On cible le bouton via son nom accessible (aria-label dynamique)
    const sendButton = screen.getByRole('button', { name: /envoyer le message/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test message' } });
    });

    await act(async () => {
      fireEvent.click(sendButton);
    });

    // Le message saisi apparaît immédiatement (ajout au state), avant les awaits internes
    expect(await screen.findByText('Test message')).toBeInTheDocument();

    // Les opérations async sont bien déclenchées
    await vi.waitFor(() => {
      expect(mockDbService.saveMessage).toHaveBeenCalled();
      expect(mockPeerService.sendMessage).toHaveBeenCalledWith(
        mockPeer.id,
        'Test message',
        expect.any(String)
      );
    });
  });

  it('devrait désactiver la saisie si le pair est hors ligne', async () => {
    const offlinePeer: User = { ...mockPeer, status: 'offline' as const };
    render(<ChatWindow selectedPeer={offlinePeer} myId={mockMyId} onBack={() => {}} />);

    await screen.findByText('Hors ligne');

    const input = screen.getByPlaceholderText(/utilisateur hors ligne/i);
    // Le bouton d’envoi porte le nom accessible "Utilisateur hors ligne - envoi désactivé"
    const sendButton = screen.getByRole('button', { name: /utilisateur hors ligne - envoi désactivé/i });

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });
});
