export class DiagnosticService {
  private static instance: DiagnosticService;
  private logs: string[] = [];

  public static getInstance(): DiagnosticService {
    if (!DiagnosticService.instance) {
      DiagnosticService.instance = new DiagnosticService();
    }
    return DiagnosticService.instance;
  }

  public log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    if (data) {
      console.log(logEntry, data);
      this.logs.push(`${logEntry} ${JSON.stringify(data)}`);
    } else {
      console.log(logEntry);
      this.logs.push(logEntry);
    }
  }

  public getLogs(): string[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
  }

  public async testConnectivity(signalingUrl: string): Promise<{
    signalingServer: boolean;
    stunServers: boolean[];
    networkInfo: any;
  }> {
    const results = {
      signalingServer: false,
      stunServers: [] as boolean[],
      networkInfo: {}
    };

    // Test signaling server via WebSocket
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(signalingUrl);
        ws.onopen = () => {
          results.signalingServer = true;
          ws.close();
          resolve(true);
        };
        ws.onerror = (err) => {
          this.log('Signaling server test failed', err);
          reject(err);
        };
        setTimeout(() => reject(new Error('Timeout')), 5000); // 5 second timeout
      });
    } catch (error) {
      this.log('Signaling server test failed', error);
    }

    // Test STUN servers
    const stunServers = [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ];

    for (const stunServer of stunServers) {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: stunServer }] });
        const result = await this.testStunServer(pc);
        results.stunServers.push(result);
        pc.close();
      } catch (error) {
        this.log(`STUN server test failed for ${stunServer}`, error);
        results.stunServers.push(false);
      }
    }

    // Get network info
    try {
      const connection = (navigator as any).connection;
      if (connection) {
        results.networkInfo = {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt
        };
      }
    } catch (error) {
      this.log('Network info gathering failed', error);
    }

    return results;
  }

  private testStunServer(pc: RTCPeerConnection): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      
      pc.onicecandidate = (event) => {
        if (event.candidate && event.candidate.type === 'srflx') {
          clearTimeout(timeout);
          resolve(true);
        }
      };

      pc.createDataChannel('test');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
    });
  }

  public exportDiagnostics(): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      logs: this.logs,
      url: window.location.href
    }, null, 2);
  }
}