# Gemini Analysis for NoNetChat-Web

## 1. Project Vision & Philosophy

**NoNetChat-Web** is a **hyperlocal, geolocation-based messaging application** that uses WebRTC for direct peer-to-peer (P2P) communication.

The primary goal is to **enable users to discover and communicate with others within a configurable geographic radius**, from immediate surroundings (100m) to a city-wide scale. The application prioritizes user privacy and data control through end-to-end encryption and a decentralized architecture.

The core tenets of the project are:

-   **Geolocation-Based Discovery**: The core experience is finding and interacting with people nearby. The application must automatically discover peers based on their physical proximity.
-   **Privacy & Security First**: All communications are protected by **end-to-end encryption (E2EE)** by default. The discovery/signaling server knows the user's location for matchmaking but never has access to message content or user identity beyond a temporary session ID.
-   **User Control**: Users must have control over their interactions, including a configurable discovery radius and the ability to **block and unblock** other users.
-   **Rich Media Communication**: The platform must support not only text messages but also the seamless exchange of **files, photos, and voice messages**.
-   **Reliability & Resilience**: Connections should be stable and automatically recover from temporary network issues. The application must be resilient to dead connections and network changes.
-   **Offline-First**: Thanks to `IndexedDB`, user data (identity, conversations, keys, block lists) is stored client-side, ensuring access to history and a seamless experience even when offline.

## 2. Architecture Evolution: From P2P to Geo-P2P

The initial architecture must be significantly enhanced to support this vision. The new architecture will consist of:

1.  **Smart Signaling & Discovery Server**: A custom WebSocket server that acts as both a WebRTC signaling broker and a geolocation matchmaking service.
    -   **Responsibilities**:
        -   Manages WebSocket connections.
        -   Receives and stores temporary location data for each client.
        -   Performs geospatial queries to find peers within a user-defined radius.
        -   Notifies clients of nearby peers.
        -   Forwards E2EE WebRTC signaling messages (offers, answers, candidates) between clients.
        -   Implements a heartbeat to manage connection liveness.

2.  **Geolocated Web Client**: The React application will be enhanced to:
    -   Request and handle user location permissions.
    -   Periodically send location updates to the server.
    -   Allow users to set a discovery radius.
    -   Manage a client-side block list stored in IndexedDB.
    -   Handle the full lifecycle of `RTCPeerConnection` for direct, E2EE communication.
    -   Implement UI and logic for file and voice message exchange.

## 3. Phased Implementation Plan

### Phase 1: Core Geolocation Architecture
*   **Server**: Rework `server/server.js` to handle location data and perform distance-based peer discovery.
*   **Client**:
    -   Refactor `PeerService.ts` to remove `peerjs` and communicate with the new geo-aware WebSocket server.
    -   Integrate `navigator.geolocation` to get and send user's position.
    -   Implement the basic discovery loop: get nearby peers from the server and establish P2P connections.

### Phase 2: Core Features & User Control
*   **Client**:
    -   Implement the client-side **block list** feature, including storage in IndexedDB and filtering in the UI.
    -   Implement **file/photo transfer** over the `RTCDataChannel`, including file chunking and progress indicators.
    -   Add the UI for configuring the discovery radius.

### Phase 3: Advanced Communication & Refinements
*   **Client**:
    -   Implement **voice message** recording and playback.
    -   Refine the UI/UX for all new features.
    -   Consider a lightweight state manager like **Zustand** to handle the increased complexity of the application state.

---
*This document replaces the previous analysis and serves as the new strategic guide for the project's development.*
