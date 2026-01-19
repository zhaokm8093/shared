/**
 * 请求去重工具
 * 防止相同请求并发执行多次
 */

export interface ExecuteOptions {
  method: string;
  url: string;
  data?: unknown;
  /** 完成后阻止时间(ms)，0表示不阻止 */
  blockAfterComplete?: number;
}

export class DuplicateRequestError extends Error {
  public readonly reason: 'in_progress' | 'recently_completed';

  constructor(reason: 'in_progress' | 'recently_completed') {
    super(
      reason === 'in_progress'
        ? 'Request is already in progress'
        : 'Request was recently completed'
    );
    this.name = 'DuplicateRequestError';
    this.reason = reason;
  }
}

interface PendingEntry {
  promise: Promise<unknown>;
  startTime: number;
}

/**
 * 请求去重器
 */
export class RequestDeduplicator {
  private pending = new Map<string, PendingEntry>();
  private completed = new Map<string, number>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  /** 请求超时时间(ms)，超时后会被清理 */
  private readonly requestTimeout: number;

  constructor(options?: { requestTimeout?: number }) {
    this.requestTimeout = options?.requestTimeout ?? 30000; // 默认30秒
  }

  /**
   * 排序对象的键（用于稳定的序列化）
   */
  private sortObjectKeys(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item: unknown) => this.sortObjectKeys(item));
    }

    const record = obj as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = this.sortObjectKeys(record[key]);
        return result;
      }, {});
  }

  /**
   * 生成请求唯一键
   */
  generateKey(method: string, url: string, data?: unknown): string {
    let dataKey = '';

    if (data !== undefined) {
      try {
        const sortedData = this.sortObjectKeys(data);
        dataKey = JSON.stringify(sortedData);
      } catch {
        dataKey = String(data);
      }
    }

    return `${method.toUpperCase()}:${url}:${dataKey}`;
  }

  /**
   * 简单去重：返回已存在的请求或执行新请求
   */
  async deduplicate<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    const promise = requestFn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, { promise, startTime: Date.now() });
    return promise;
  }

  /**
   * 执行请求（带去重和幂等性保护）
   */
  async execute<T>(options: ExecuteOptions, requestFn: () => Promise<T>): Promise<T> {
    const key = this.generateKey(options.method, options.url, options.data);
    const now = Date.now();

    // 1. 检查是否刚完成（阻止重复提交）
    if (options.blockAfterComplete && options.blockAfterComplete > 0) {
      const completedTime = this.completed.get(key);
      if (completedTime && now - completedTime < options.blockAfterComplete) {
        throw new DuplicateRequestError('recently_completed');
      }
    }

    // 2. 检查是否进行中（去重）
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    // 3. 执行请求
    const promise = requestFn()
      .then(result => {
        this.pending.delete(key);
        if (options.blockAfterComplete && options.blockAfterComplete > 0) {
          this.completed.set(key, Date.now());
        }
        return result;
      })
      .catch(error => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, { promise, startTime: now });
    return promise;
  }

  /**
   * 清理过期的完成记录和卡住的请求
   */
  cleanup(maxAge: number = 10000): void {
    const now = Date.now();

    // 清理完成记录
    for (const [key, completedTime] of this.completed.entries()) {
      if (now - completedTime > maxAge) {
        this.completed.delete(key);
      }
    }

    // 清理卡住的 pending 请求（超过 requestTimeout）
    for (const [key, entry] of this.pending.entries()) {
      if (now - entry.startTime > this.requestTimeout) {
        this.pending.delete(key);
      }
    }
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup(intervalMs: number = 60000): void {
    if (this.cleanupIntervalId) return;
    this.cleanupIntervalId = setInterval(() => this.cleanup(), intervalMs);
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { pendingCount: number; completedCount: number } {
    return {
      pendingCount: this.pending.size,
      completedCount: this.completed.size,
    };
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.pending.clear();
    this.completed.clear();
  }
}

/**
 * 默认实例
 */
export const requestDeduplicator = new RequestDeduplicator();
