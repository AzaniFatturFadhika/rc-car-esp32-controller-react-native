import { useCallback, useEffect, useRef, useState } from "react";

import { buildWebSocketUrl, validateConnectionSettings } from "./protocol";
import type { ConnectionSettings, ConnectionStatus } from "./types";

const FRAME_SEND_MS = 16;
const HEARTBEAT_MS = 1000;
const MAX_HEARTBEAT_MISSES = 3;
const RECONNECT_DELAYS_MS = [250, 600, 1100];

type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;

export function useWifiTransport(payloadMessage: string) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const payloadRef = useRef(payloadMessage);
  const manualDisconnectRef = useRef(false);
  const sendTimerRef = useRef<TimeoutId | null>(null);
  const heartbeatRef = useRef<IntervalId | null>(null);
  const reconnectTimerRef = useRef<TimeoutId | null>(null);
  const lastSentAtRef = useRef(0);
  const missedHeartbeatRef = useRef(0);

  // Ref to hold openSocket so reconnect closures always call the latest version.
  const openSocketRef = useRef<
    (settings: ConnectionSettings, attempt?: number) => void
  >(() => undefined);

  const clearTimers = useCallback(() => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const sendNow = useCallback((message: string) => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      missedHeartbeatRef.current += 1;
      return false;
    }

    socket.send(message);
    lastSentAtRef.current = Date.now();
    missedHeartbeatRef.current = 0;
    return true;
  }, []);

  const schedulePayloadSend = useCallback(() => {
    const socket = socketRef.current;
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      sendTimerRef.current
    ) {
      return;
    }

    const elapsedMs = Date.now() - lastSentAtRef.current;
    const waitMs = Math.max(0, FRAME_SEND_MS - elapsedMs);

    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      sendNow(payloadRef.current);
    }, waitMs);
  }, [sendNow]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearTimers();
    socketRef.current?.close();
    socketRef.current = null;
    missedHeartbeatRef.current = 0;
    setStatus("disconnected");
  }, [clearTimers]);

  const openSocket = useCallback(
    (settings: ConnectionSettings, attempt = 0) => {
      clearTimers();
      missedHeartbeatRef.current = 0;
      setStatus(attempt > 0 ? "reconnecting" : "connecting");
      setErrorMessage(null);

      const socket = new WebSocket(buildWebSocketUrl(settings));
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus("connected");
        sendNow(payloadRef.current);

        heartbeatRef.current = setInterval(() => {
          const sent = sendNow(payloadRef.current);
          if (!sent && missedHeartbeatRef.current >= MAX_HEARTBEAT_MISSES) {
            socket.close();
          }
        }, HEARTBEAT_MS);
      };

      socket.onmessage = () => {
        missedHeartbeatRef.current = 0;
      };

      socket.onerror = () => {
        setErrorMessage(`Could not reach ${settings.host}:${settings.port}.`);
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        if (manualDisconnectRef.current) {
          setStatus("disconnected");
          return;
        }

        if (attempt < RECONNECT_DELAYS_MS.length) {
          setStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(() => {
            openSocketRef.current(settings, attempt + 1);
          }, RECONNECT_DELAYS_MS[attempt]);
          return;
        }

        setStatus("error");
        setErrorMessage(
          `Connection lost after ${RECONNECT_DELAYS_MS.length} retries.`,
        );
      };
    },
    [clearTimers, sendNow],
  );

  // Keep the ref in sync so reconnect closures always call the latest openSocket.
  useEffect(() => {
    openSocketRef.current = openSocket;
  }, [openSocket]);

  const connect = useCallback(
    (settings: ConnectionSettings) => {
      const validationError = validateConnectionSettings(settings);
      if (validationError) {
        setStatus("error");
        setErrorMessage(validationError);
        return false;
      }

      manualDisconnectRef.current = false;
      socketRef.current?.close();
      openSocket(settings);
      return true;
    },
    [openSocket],
  );

  useEffect(() => {
    payloadRef.current = payloadMessage;
    schedulePayloadSend();
  }, [payloadMessage, schedulePayloadSend]);

  useEffect(
    () => () => {
      manualDisconnectRef.current = true;
      clearTimers();
      socketRef.current?.close();
    },
    [clearTimers],
  );

  return {
    status,
    errorMessage,
    connect,
    disconnect,
  };
}
