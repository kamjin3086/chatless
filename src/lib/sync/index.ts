/**
 * 通用同步框架 - 主入口
 */

// 核心模块
export * from './core';

// 传输层实现
export * from './transports';

// 适配器实现
export * from './adapters';

// 设备 ID
export { getOrCreateSyncDeviceId } from './deviceId';
