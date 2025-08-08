# Diagnostic des problèmes de connexion NoNetChat

## Problèmes identifiés

Après analyse du code, plusieurs problèmes potentiels peuvent expliquer pourquoi deux ordinateurs sur le même réseau WiFi ne se voient pas :

### 1. Configuration du serveur PeerJS

**Problème :** Le serveur PeerJS écoute sur le port 3001 mais l'URL de signalisation ne spécifie pas de port.

**Solution :** Vérifier la configuration du proxy inverse (nginx) qui redirige vers le port 3001.

### 2. Isolation des clients WiFi (AP Isolation)

**Problème :** Certains routeurs WiFi empêchent la communication directe entre appareils.

**Solutions :**
- Vérifier les paramètres du routeur WiFi
- Désactiver l'isolation des clients (AP Isolation) si activée
- Tester sur un autre réseau WiFi

### 3. Configuration ICE/STUN/TURN

**Problème :** Les serveurs STUN externes peuvent ne pas fonctionner correctement pour le réseau local.

**Solution :** Ajouter des serveurs STUN locaux ou améliorer la configuration.

### 4. Génération des IDs de peers

**Problème :** Collision potentielle d'IDs si les deux ordinateurs génèrent le même UUID.

**Solution :** Le code utilise `uuidv4()` qui devrait être unique, mais vérifier le stockage local.

## Solutions implémentées

### 1. Service de diagnostic

Ajout d'un service de diagnostic complet (`DiagnosticService.ts`) qui :
- Enregistre tous les événements de connexion
- Teste la connectivité aux serveurs STUN/TURN
- Vérifie l'accès au serveur de signalisation
- Exporte les logs pour analyse

### 2. Logs détaillés dans PeerService

Ajout de logs détaillés pour tracer :
- L'initialisation du service
- La découverte des peers
- Les tentatives de connexion
- Les erreurs de connexion
- L'établissement des connexions

### 3. Panneau de diagnostic

Interface utilisateur (`DiagnosticPanel.tsx`) permettant :
- Visualisation des logs en temps réel
- Tests de connectivité
- Export des diagnostics
- Monitoring des connexions

## Instructions de débogage

### Étape 1 : Ouvrir le panneau de diagnostic
1. Lancer l'application sur les deux ordinateurs
2. Cliquer sur l'icône de bug (🐛) dans la barre d'état
3. Cliquer sur "Tester la connectivité"

### Étape 2 : Analyser les résultats
- **Serveur de signalisation :** Doit être "OK" sur les deux machines
- **Serveurs STUN :** Au moins un doit être "OK"
- **Logs :** Rechercher les messages d'erreur

### Étape 3 : Vérifier la découverte des peers
Dans les logs, rechercher :
```
Discovered peers: { totalPeers: X, peerIds: [...], myId: "..." }
```

Si `totalPeers` est 0 ou ne contient que votre propre ID, le problème est au niveau du serveur de signalisation.

### Étape 4 : Vérifier les tentatives de connexion
Rechercher dans les logs :
```
Attempting to connect to discovered peer: { peerId: "..." }
Initiating connection to peer: { peerId: "..." }
```

Si ces messages n'apparaissent pas, le problème est dans la découverte.
S'ils apparaissent mais sans "Connection opened successfully", le problème est dans l'établissement de la connexion WebRTC.

## Solutions spécifiques par type de problème

### Si les peers ne se découvrent pas
1. Vérifier que le serveur PeerJS fonctionne correctement
2. Vérifier la configuration réseau (proxy, firewall)
3. Tester avec un autre serveur de signalisation

### Si les peers se découvrent mais ne se connectent pas
1. Vérifier la configuration du routeur WiFi (AP Isolation)
2. Tester les serveurs STUN/TURN
3. Vérifier les firewalls locaux
4. Essayer sur un réseau différent

### Si les connexions s'établissent puis se ferment
1. Vérifier la stabilité du réseau
2. Analyser les messages d'erreur dans les logs
3. Vérifier la configuration des timeouts

## Améliorations recommandées

### 1. Configuration ICE améliorée
```typescript
config: {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Ajouter un serveur STUN local si disponible
    { urls: 'stun:192.168.1.1:3478' }, // IP du routeur
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
}
```

### 2. Retry logic améliorée
```typescript
// Ajouter une logique de retry plus agressive pour les réseaux locaux
if (isLocalNetwork(peerId)) {
  retryInterval = 2000; // Plus fréquent pour le réseau local
  maxRetries = 10;
}
```

### 3. Détection de réseau local
```typescript
// Détecter si on est sur le même réseau local
private isLocalNetwork(): boolean {
  // Logique pour détecter le réseau local
  return window.location.hostname === 'localhost' || 
         window.location.hostname.startsWith('192.168.') ||
         window.location.hostname.startsWith('10.') ||
         window.location.hostname.startsWith('172.');
}
```

## Contact et support

Si le problème persiste après avoir suivi ces étapes :
1. Exporter les logs de diagnostic des deux machines
2. Noter la configuration réseau (routeur, FAI, etc.)
3. Tester sur un réseau différent pour isoler le problème

Les logs exportés contiennent toutes les informations nécessaires pour un diagnostic approfondi.