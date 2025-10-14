import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const toastTimeoutRef = useRef(null);
  const { user } = useAuth();

  // Debounced toast function to prevent spam
  const showDebouncedToast = (message, type = 'success', delay = 1000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = setTimeout(() => {
      if (type === 'success') {
        toast.success(message);
      } else if (type === 'error') {
        toast.error(message);
      } else if (type === 'loading') {
        toast.loading(message);
      }
    }, delay);
  };

  useEffect(() => {
    if (user) {
      // Clean up existing socket if any
      if (socket) {
        console.log('Cleaning up existing socket connection');
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }

      // Initialize socket connection - dynamically detect server URL
      let serverUrl;

      // Check if we're accessing VPS (has srv512766.hstgr.cloud in URL)
      if (window.location.hostname.includes('srv512766.hstgr.cloud')) {
        // VPS mode - use the same hostname but port 5001
        serverUrl = `${window.location.protocol}//${window.location.hostname}:5001`;
      } else if (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      ) {
        // Local mode - use localhost:5001
        serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5001';
      } else {
        // Fallback - use current hostname with port 5001
        serverUrl =
          process.env.REACT_APP_SERVER_URL ||
          window.location.protocol +
            '//' +
            window.location.hostname +
            ':' +
            (window.location.port || '5001');
      }

      console.log('Socket connecting to:', serverUrl);

      const newSocket = io(serverUrl, {
        auth: {
          userId: user.id,
          username: user.username,
        },
        // Add connection options for better stability
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        forceNew: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        maxReconnectionAttempts: 5,
      });

      newSocket.on('connect', () => {
        console.log('✅ Socket connected to server:', serverUrl);
        setConnected(true);
        setIsConnecting(false);
        setConnectionAttempts(0);

        // Only show success toast after reconnection attempts
        if (connectionAttempts > 0) {
          showDebouncedToast('Reconnected to server', 'success', 500);
        } else {
          // Don't show toast on initial connection to avoid spam
          console.log('Connected to server');
        }

        // Join user-specific room
        newSocket.emit('join_room', `user_${user.id}`);

        // Join general notifications room
        newSocket.emit('join_room', 'general');
      });

      newSocket.on('disconnect', (reason) => {
        console.log('❌ Socket disconnected from server:', reason);
        setConnected(false);
        setIsConnecting(false);

        // Only show disconnect toast if it's not a normal page reload
        if (reason !== 'io client disconnect') {
          showDebouncedToast('Connection lost', 'error', 1000);
        }
      });

      newSocket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
        setConnected(false);
        setIsConnecting(false);
        setConnectionAttempts((prev) => prev + 1);

        // Only show error toast after multiple failed attempts
        if (connectionAttempts >= 3) {
          showDebouncedToast(
            `Connection failed: ${error.message}`,
            'error',
            2000,
          );
        }
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
        setConnected(true);
        setIsConnecting(false);
        setConnectionAttempts(0);
        showDebouncedToast('Reconnected to server', 'success', 500);
      });

      newSocket.on('reconnect_attempt', (attemptNumber) => {
        console.log('🔄 Socket reconnection attempt:', attemptNumber);
        setIsConnecting(true);
        setConnectionAttempts(attemptNumber);

        // Only show loading toast for first few attempts
        if (attemptNumber <= 2) {
          showDebouncedToast(
            `Reconnecting... (${attemptNumber})`,
            'loading',
            500,
          );
        }
      });

      newSocket.on('reconnect_error', (error) => {
        console.error('❌ Socket reconnection error:', error);
        setIsConnecting(false);
        // Don't show error toast for every attempt, only after multiple failures
      });

      newSocket.on('reconnect_failed', () => {
        console.error('❌ Failed to reconnect to server');
        setConnected(false);
        setIsConnecting(false);
        showDebouncedToast('Connection lost permanently', 'error', 1000);
      });

      // Real-time event handlers
      newSocket.on('product_created', (product) => {
        // Don't show toast here to avoid duplicate messages
        // The mutation success handler already shows the message
        window.dispatchEvent(
          new CustomEvent('productCreated', { detail: product }),
        );
      });

      newSocket.on('product_updated', (product) => {
        // Don't show toast here to avoid duplicate messages
        // The mutation success handler already shows the message
        window.dispatchEvent(
          new CustomEvent('productUpdated', { detail: product }),
        );
      });

      newSocket.on('product_deleted', (data) => {
        // Don't show toast here to avoid duplicate messages
        // The mutation success handler already shows the message
        window.dispatchEvent(
          new CustomEvent('productDeleted', { detail: data }),
        );
      });

      newSocket.on('barcode_created', (barcode) => {
        toast.success(`New barcode created: ${barcode.barcode}`);
        window.dispatchEvent(
          new CustomEvent('barcodeCreated', { detail: barcode }),
        );
      });

      newSocket.on('barcodes_generated', (data) => {
        toast.success(`${data.quantity} barcodes generated for product`);
        window.dispatchEvent(
          new CustomEvent('barcodesGenerated', { detail: data }),
        );
      });

      newSocket.on('transaction_created', (data) => {
        const { transaction } = data;
        toast.success(
          `${transaction.transaction_type} transaction: ${transaction.quantity} units of ${transaction.product_name}`,
          { duration: 3000 },
        );
        window.dispatchEvent(
          new CustomEvent('transactionCreated', { detail: data }),
        );
      });

      newSocket.on('stock_updated', (data) => {
        // This could trigger a refetch of stock data in components
        // Emit a custom event that components can listen to
        window.dispatchEvent(new CustomEvent('stockUpdated', { detail: data }));
      });

      newSocket.on('new_low_stock_alerts', (alerts) => {
        alerts.forEach((alert) => {
          toast.error(
            `Low stock alert: ${alert.product_name} (${alert.current_stock} remaining)`,
            { duration: 6000 },
          );
        });
      });

      newSocket.on('alerts_resolved', (alerts) => {
        toast.success(`${alerts.length} alert(s) resolved`);
      });

      setSocket(newSocket);

      return () => {
        console.log('Cleaning up socket connection on unmount');
        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }
        newSocket.close();
        setSocket(null);
        setConnected(false);
      };
    } else {
      // Clean up socket when user logs out
      if (socket) {
        console.log('Cleaning up socket connection on logout');
        socket.close();
        setSocket(null);
        setConnected(false);
      }
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (event, data) => {
    if (socket && connected) {
      socket.emit(event, data);
    }
  };

  const on = (event, callback) => {
    if (socket) {
      socket.on(event, callback);
      return () => socket.off(event, callback);
    }
  };

  const off = (event, callback) => {
    if (socket) {
      socket.off(event, callback);
    }
  };

  const value = {
    socket,
    connected,
    emit,
    on,
    off,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};
