import { defaultRemarkPlugins } from 'streamdown';
import { toRemarkPluginList } from '@/lib/markdown/toRemarkPluginList';

export { toRemarkPluginList };

/** Streamdown 默认 remark 插件（含 remark-gfm），已转为插件列表。 */
export const streamdownRemarkPlugins = toRemarkPluginList(defaultRemarkPlugins);
