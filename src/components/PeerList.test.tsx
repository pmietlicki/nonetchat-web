import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PeerList from './PeerList';
import { User } from '../types';

// --- Mocks & Test Data ---

vi.mock('../i18n', () => ({
  t: (key: string) => key, // Renvoie la clé elle-même
}));

const mockPeers: User[] = [
  {
    id: 'peer-1',
    name: 'Alice',
    avatar: 'avatar-url-1',
    status: 'online',
    joinedAt: new Date().toISOString(),
    age: 28,
    gender: 'female',
  },
  {
    id: 'peer-2',
    name: 'Bob',
    avatar: 'avatar-url-2',
    status: 'online',
    joinedAt: new Date().toISOString(),
    age: 32,
    gender: 'male',
  },
];

// --- Tests ---

describe('PeerList', () => {
  const mockOnSelectPeer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devrait afficher un message quand aucun pair n\'est connecté', () => {
    render(<PeerList peers={[]} onSelectPeer={mockOnSelectPeer} isConnected={true} />);
    expect(screen.getByText('peerList.no_peers_title')).toBeInTheDocument();
  });

  it('devrait afficher un message quand la connexion est requise', () => {
    render(<PeerList peers={[]} onSelectPeer={mockOnSelectPeer} isConnected={false} />);
    expect(screen.getByText('peerList.connection_required_title')).toBeInTheDocument();
  });

  it('devrait afficher une liste de pairs', () => {
    render(<PeerList peers={mockPeers} onSelectPeer={mockOnSelectPeer} isConnected={true} />);
    
    // Vérifier que les noms des pairs sont affichés
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    // Vérifier que le nombre d'éléments de liste est correct
    // Le rôle 'listitem' n'est pas explicite, on cherche les conteneurs de peer
    const peerContainers = screen.getAllByRole('listitem'); // En supposant que chaque pair est dans un <li> ou a un role
    expect(peerContainers).toHaveLength(2);
  });

  it('devrait appeler onSelectPeer avec le bon ID lors d\'un clic', () => {
    render(<PeerList peers={mockPeers} onSelectPeer={mockOnSelectPeer} isConnected={true} />);

    // Cliquer sur le premier pair (Alice)
    fireEvent.click(screen.getByText('Alice'));

    expect(mockOnSelectPeer).toHaveBeenCalledTimes(1);
    expect(mockOnSelectPeer).toHaveBeenCalledWith('peer-1');
  });

  it('devrait mettre en surbrillance le pair sélectionné', () => {
    render(
      <PeerList
        peers={mockPeers}
        onSelectPeer={mockOnSelectPeer}
        isConnected={true}
        selectedPeerId={'peer-2'} // Bob est sélectionné
      />
    );

    const bobContainer = screen.getByText('Bob').closest('[role="listitem"]');
    const aliceContainer = screen.getByText('Alice').closest('[role="listitem"]');

    // La surbrillance est souvent gérée par des classes CSS. On vérifie leur présence.
    // Ici, on s'attend à ce que le pair sélectionné ait une classe comme 'bg-blue-50'
    expect(bobContainer).toHaveClass('bg-blue-50');
    expect(aliceContainer).not.toHaveClass('bg-blue-50');
  });
});

