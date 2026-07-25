/**
 * StoryMee Shared Extension SDK (TypeScript version)
 * Version: 1.0.0
 * Purpose: Centralized utilities for Chrome Extensions (WebSocket, Cookies, Logs, Captcha)
 */

export class LogBroadcaster {
  private port: chrome.runtime.Port | null;

  constructor(port: chrome.runtime.Port | null = null) {
    this.port = port;
  }

  setPort(port: chrome.runtime.Port | null) {
    this.port = port;
  }

  broadcast(message: string, type: "info" | "success" | "warning" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${type.toUpperCase()}] ${message}`);

    if (this.port) {
      try {
        this.port.postMessage({
          type: "LOG",
          payload: { message: `[${timestamp}] ${message}`, level: type }
        });
      } catch (err) {
        this.port = null;
      }
    }

    chrome.runtime.sendMessage({
      type: "LOG_UPDATE",
      payload: { message: `[${timestamp}] ${message}`, level: type }
    }).catch(() => {});
  }
}

interface ResilientWebSocketOptions {
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  logger?: LogBroadcaster;
  workerId?: string;
  workerName?: string;
  getPingPayload?: () => Record<string, any>;
}

export class ResilientWebSocket {
  public url: string;
  public ws: WebSocket | null = null;
  public options: Required<ResilientWebSocketOptions>;
  public reconnectAttempts = 0;
  public isClosedIntentionally = false;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};
  private pingTimer: any = null;

  constructor(url: string, options: ResilientWebSocketOptions = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 20,
      pingInterval: 25000,
      logger: new LogBroadcaster(),
      getPingPayload: () => ({}),
      ...options
    } as Required<ResilientWebSocketOptions>;
  }

  connect() {
    this.options.logger.broadcast(`Đang kết nối WebSocket đến Hub: ${this.url}...`, "info");
    this.isClosedIntentionally = false;
    this.broadcastStatus("CONNECTING");
    
    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (err: any) {
      this.options.logger.broadcast(`Lỗi tạo WebSocket: ${err.message}`, "error");
      this.broadcastStatus("DISCONNECTED");
      this.handleReconnect();
    }
  }

  broadcastStatus(status: string) {
    chrome.storage.local.set({ workerState: status }).catch(() => {});
    chrome.runtime.sendMessage({ type: "WS_STATUS", status }).catch(() => {});
    this.trigger("stateChange", status);
  }

  setupEventHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.options.logger.broadcast("Kết nối WebSocket thành công!", "success");
      this.broadcastStatus("ONLINE");
      this.startPing();
      this.trigger("open");
    };

    this.ws.onclose = (event) => {
      this.stopPing();
      this.broadcastStatus("DISCONNECTED");
      this.trigger("close", event);
      if (!this.isClosedIntentionally) {
        this.options.logger.broadcast(`WebSocket bị đóng. Mã: ${event.code}, Lý do: ${event.reason || "Không rõ"}`, "warning");
        this.handleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      this.options.logger.broadcast(`WebSocket lỗi`, "error");
      this.broadcastStatus("DISCONNECTED");
      this.trigger("error", err);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.trigger("message", data);
      } catch (err) {
        this.options.logger.broadcast(`Nhận dữ liệu thô: ${event.data}`, "info");
        this.trigger("raw_message", event.data);
      }
    };
  }

  send(data: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    }
    this.options.logger.broadcast("Không thể gửi dữ liệu, WebSocket đã đóng!", "error");
    return false;
  }

  close() {
    this.isClosedIntentionally = true;
    this.stopPing();
    if (this.ws) {
      try {
        this.send({ 
          action: "PING",
          workerId: this.options.workerId || "unknown-worker",
          status: "offline",
          workerName: this.options.workerName || "Universal Extension"
        });
      } catch(e) {}
      this.ws.close();
    }
    this.broadcastStatus("DISCONNECTED");
  }

  handleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.options.logger.broadcast("Đã đạt giới hạn thử lại WebSocket. Dừng kết nối.", "error");
      return;
    }

    const delay = Math.min(this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;
    this.options.logger.broadcast(`Sẽ thử kết nối lại WebSocket sau ${(delay / 1000).toFixed(1)} giây (Lần ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`, "warning");
    
    setTimeout(() => {
      if (!this.isClosedIntentionally) {
        this.connect();
      }
    }, delay);
  }

  startPing() {
    this.stopPing();
    
    // Gửi ngay 1 phát PING để báo danh với Radar
    this.send({ 
      action: "PING",
      workerId: this.options.workerId || "unknown-worker",
      status: "idle",
      workerName: this.options.workerName || "Universal Extension",
      ...this.options.getPingPayload(),
    });

    this.pingTimer = setInterval(() => {
      // Gửi Ping kèm theo data cho NATS worker.ping
      this.send({ 
        action: "PING",
        workerId: this.options.workerId || "unknown-worker",
        status: "idle",
        workerName: this.options.workerName || "Universal Extension",
        ...this.options.getPingPayload(),
      });
    }, this.options.pingInterval);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  trigger(event: string, ...args: any[]) {
    const list = this.listeners[event] || [];
    for (const callback of list) {
      try {
        callback(...args);
      } catch (err) {
        console.error(`Error in WebSocket listener for ${event}:`, err);
      }
    }
  }
}
