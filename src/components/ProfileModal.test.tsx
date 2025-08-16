import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileModal from './ProfileModal';
import React from 'react';

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
    // Le modal est identifié par son titre "Votre Profil"
    expect(screen.queryByText('Votre Profil')).toBeNull();
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

    // Utiliser getByLabelText pour trouver les champs par leur label, ce qui est une bonne pratique
    expect(screen.getByLabelText(/Nom d\'utilisateur/i)).toHaveValue('Old Name');
    expect(screen.getByLabelText(/Âge/i)).toHaveValue(30);
    expect(screen.getByLabelText(/Genre/i)).toHaveValue('male');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'some-url');
  });

  it('devrait appeler onClose quand on clique sur le bouton Annuler', () => {
    render(
      <ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={{}} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    fireEvent.click(screen.getByText('Annuler'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('devrait appeler onSave avec les nouvelles données quand on clique sur Sauvegarder', () => {
    render(
      <ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={initialProfile} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    const nameInput = screen.getByLabelText(/Nom d\'utilisateur/i);
    const ageInput = screen.getByLabelText(/Âge/i);
    const genderSelect = screen.getByLabelText(/Genre/i);

    // Simuler les actions de l'utilisateur
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.change(ageInput, { target: { value: '35' } });
    fireEvent.change(genderSelect, { target: { value: 'female' } });

    // Cliquer sur Sauvegarder
    fireEvent.click(screen.getByText('Sauvegarder'));

    // Vérifier que onSave a été appelé avec les bonnes données
    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnSave).toHaveBeenCalledWith(
      { name: 'New Name', age: 35, gender: 'female' },
      undefined // Pas de fichier d'avatar dans ce test
    );
  });

  it('devrait appeler onRefreshAvatar quand on clique sur le bouton de rafraîchissement', () => {
    render(
      <ProfileModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} initialProfile={{}} displayAvatarUrl="" onRefreshAvatar={mockOnRefreshAvatar} />
    );

    fireEvent.click(screen.getByTitle('Générer un nouvel avatar par défaut'));
    expect(mockOnRefreshAvatar).toHaveBeenCalledTimes(1);
  });
});
