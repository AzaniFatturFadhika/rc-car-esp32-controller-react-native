declare module 'react-native-udp' {
  interface UdpSocket {
    bind(port: number, callback?: () => void): void;
    send(
      msg: Buffer,
      offset: number,
      length: number,
      port: number,
      address: string,
      callback?: (error?: Error) => void
    ): void;
    close(callback?: () => void): void;
    on(event: 'message', callback: (data: Buffer, rinfo: { address: string; port: number; family: string; size: number }) => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'listening', callback: () => void): void;
    on(event: 'close', callback: () => void): void;
    removeAllListeners(event?: string): void;
    ref(): void;
    unref(): void;
  }

  export function createSocket(type: 'udp4' | 'udp6', callback?: () => void): UdpSocket;
}
