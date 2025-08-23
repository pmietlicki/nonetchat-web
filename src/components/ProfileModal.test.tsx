import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileModal from './ProfileModal';
import React from 'react';

// --- Mocks ---
vi.mock('../i18n', () => ({
  t: (key: string) => key, // Renvoie la clé elle-même
}));

// --- Tests ---

describe('ProfileModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnRefreshAvatar = vi.fn();

  const initialProfile = {
    name: 'Old Name',
    age: 30,
    gender: 'male',
  };

  beforeEach(() => {
    // Nettoyer les mocks avant chaque test
    vi.clearAllMocks();
  });

  it('ne devrait pas s\'afficher si isOpen est false', () => {
    render(
      <ProfileModal
        isOpen={false}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialProfile={initialProfile}
        displayAvatarUrl=""
        onRefreshAvatar={mockOnRefreshAvatar}
      />
    );
    // Le modal est identifié par son titre
    expect(screen.queryByText('profileModal.title')).toBeNull();
  });

  it('devrait s\'afficher avec les bonnes données initiales si isOpen est true', () => {
    render(
      <ProfileModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        initialProfile={initialProfile}
        displayAvatarUrl="some-url"
        onRefreshAvatar={mockOnRefreshAvatar}
      />
    );

    // Utiliser getByLabelText pour trouver les champs par leur label
    expect(screen.getByLabelText('profileModal.username_label')).toHaveValue('Old Name');
    expect(screen.getByLabelText('profileModal.age_label')).toHaveValue(30);
    expect(screen.getByLabelText('profileModal.gender_label')).toHaveValue('male');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'some-url');
  });

  it('devrait appeler onClose quand on clique sur le bouton Annuler', () => {
    render(<ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={{}} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    fireEvent.click(screen.getByText('profileModal.cancel'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('devrait appeler onSave avec les nouvelles données quand on clique sur Sauvegarder', () => {
    render(<ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={initialProfile} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    const nameInput = screen.getByLabelText('profileModal.username_label');
    const ageInput = screen.getByLabelText('profileModal.age_label');
    const genderSelect = screen.getByLabelText('profileModal.gender_label');

    // Simuler les actions de l'utilisateur
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.change(ageInput, { target: { value: '35' } });
    fireEvent.change(genderSelect, { target: { value: 'female' } });

    // Cliquer sur Sauvegarder
    fireEvent.click(screen.getByText('profileModal.save'));

    // Vérifier que onSave a été appelé avec les bonnes données
    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnSave).toHaveBeenCalledWith(
      { name: 'New Name', age: 35, gender: 'female' },
      undefined // Pas de fichier d'avatar dans ce test
    );
  });

  it('devrait appeler onRefreshAvatar quand on clique sur le bouton de rafraîchissement', () => {
    render(<ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={{}} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    fireEvent.click(screen.getByTitle('profileModal.refresh_avatar_title'));
    expect(mockOnRefreshAvatar).toHaveBeenCalledTimes(1);
  });
});

