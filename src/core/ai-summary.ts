import { Config } from "../types";
import { debug } from "../utils/logger";
import { AiSummaryCache, getOrInitAiCache } from "./ai-cache";
import { callAiApi } from "./ai-client";
import {
  buildBatchSummaryPrompt,
  buildSingleSummaryPrompt,
  cleanHtmlContent,
  cleanSummaryItems,
  enhancePromptWithSearch,
} from "./ai-utils";

function shouldSkipAiSummary(config: Config): boolean {
  return !config.ai?.enabled || !config.ai?.apiKey;
}

function getSummaryCache(config: Config): AiSummaryCache {
  return getOrInitAiCache(undefined, config.security?.maxCacheSize);
}

function truncatePlainText(text: string, maxLength: number): string {
  if (
    !Number.isFinite(maxLength) ||
    maxLength <= 0 ||
    text.length <= maxLength
  ) {
    return text;
  }

  const changelogPattern =
    /(Added[:：]|Improved[:：]|Fixed[:：]|🎁Added|🧼Improved|🪛Fixed)/i;
  if (changelogPattern.test(text)) {
    const headLength = Math.floor(maxLength * 0.7);
    const tailLength = Math.max(maxLength - headLength - 12, 0);
    return `${text.substring(0, headLength).trim()}\n\n[中略]\n\n${text.substring(Math.max(text.length - tailLength, 0)).trim()}`;
  }

  return `${text.substring(0, maxLength).trim()}...`;
}

function buildSummaryCandidates(
  plainText: string,
  configuredMaxLength: number,
): string[] {
  const candidates = [plainText];
  if (configuredMaxLength > 0) {
    return candidates;
  }

  for (const limit of [48000, 36000, 28000, 20000, 16000, 12000]) {
    const truncated = truncatePlainText(plainText, limit);
    if (truncated.length >= 50 && !candidates.includes(truncated)) {
      candidates.push(truncated);
    }
  }

  return candidates;
}

function hasRenderedChangeGroups(summary: string): boolean {
  return /rss-ai-change-group|rss-ai-change-title|<ul[^>]*rss-ai-change-list/i.test(
    summary || "",
  );
}

function splitChangelogText(plainText: string): {
  mainText: string;
  changelogText: string;
} {
  const normalized = String(plainText || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(
      /Added\s*\/\s*Improved\s*\/\s*Fixed/gi,
      "\nAdded / Improved / Fixed\n",
    )
    .replace(/(🎁\s*Added|🧼\s*Improved|🪛\s*Fixed)/g, "\n$1")
    .replace(/\s*•\s*/g, "\n• ")
    .replace(/\n{3,}/g, "\n\n");

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const startIndex = lines.findIndex(
    (line) =>
      /^Added\s*\/\s*Improved\s*\/\s*Fixed$/i.test(line) ||
      /^(🎁\s*)?Added[:：]?$/i.test(line),
  );

  if (startIndex < 0) {
    return {
      mainText: String(plainText || "").trim(),
      changelogText: "",
    };
  }

  const mainLines = lines
    .slice(0, startIndex)
    .filter((line) => !/^Added\s*\/\s*Improved\s*\/\s*Fixed$/i.test(line));
  const changelogLines: string[] = [];

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (/^Added\s*\/\s*Improved\s*\/\s*Fixed$/i.test(line)) continue;
    if (
      /^(🎁\s*)?Added[:：]?$|^(🧼\s*)?Improved[:：]?$|^(🪛\s*)?Fixed[:：]?$/i.test(
        line,
      )
    ) {
      changelogLines.push(line);
      continue;
    }
    if (/^•\s+/.test(line)) {
      changelogLines.push(line);
      continue;
    }
    if (!changelogLines.length) continue;
    if (
      /^(arrow_back_ios|arrow_forward_ios|News|Docs|Metrics|FAQ|Forum|Discord|Twitter)$/i.test(
        line,
      ) ||
      /news\/update-|posts\b|days? ago\b|^#\d+$/i.test(line)
    ) {
      break;
    }
    const lastIndex = changelogLines.length - 1;
    if (/^•\s+/.test(changelogLines[lastIndex])) {
      changelogLines[lastIndex] += ` ${line}`;
    }
  }

  return {
    mainText: mainLines.join("\n").trim(),
    changelogText: changelogLines.join("\n").trim(),
  };
}

function extractChangelogText(plainText: string): string {
  return splitChangelogText(plainText).changelogText;
}

async function appendChangelogGroups(
  config: Config,
  title: string,
  summary: string,
  plainText: string,
): Promise<string> {
  if (!summary || hasRenderedChangeGroups(summary)) {
    return summary;
  }

  const changelogText = extractChangelogText(plainText);
  if (!changelogText) {
    return summary;
  }

  const prompt = `你是一位资深的中文游戏更新编辑。请把下面 Added / Improved / Fixed 变更列表逐条翻译成中文，并且只输出合法、闭合的 HTML 片段：

<div class="rss-ai-change-group">
  <div class="rss-ai-change-title">Added</div>
  <ul class="rss-ai-change-list">
    <li>逐条中文翻译</li>
  </ul>
</div>

要求：
1. 只允许输出 HTML 片段，不要输出 Markdown，不要输出解释。
2. 每一条原文细项都要逐条翻译，不要合并，不要省略。
3. 保持 Added / Improved / Fixed 三组原有顺序；缺失的组可以省略。
4. 不要捏造原文中不存在的条目。

原文变更列表：
${changelogText}`;

  const result = await callAiApi(config, prompt, `变更细则翻译: ${title}`);
  if (!result.success || !result.summary) {
    return summary;
  }

  return `${summary}\n${result.summary}`;
}

export async function getAiSummary(
  config: Config,
  title: string,
  contentHtml: string,
): Promise<string> {
  if (shouldSkipAiSummary(config)) return "";

  const cache = getSummaryCache(config);
  const plainText = cleanHtmlContent(contentHtml, config.ai!.maxInputLength!);
  if (!plainText || plainText.length < 50) return "";
  const splitContent = splitChangelogText(plainText);
  const summaryInput = splitContent.mainText || plainText;
  const searchQuery = title || plainText.substring(0, 100);

  for (const candidateText of buildSummaryCandidates(
    summaryInput,
    config.ai!.maxInputLength!,
  )) {
    const cachedSummary = cache.get(title, candidateText);
    if (cachedSummary) {
      debug(config, `使用缓存的 AI 摘要: ${title}`, "AI-Cache", "details");
      return cachedSummary;
    }

    let prompt = buildSingleSummaryPrompt(
      config.ai!.prompt!,
      title,
      candidateText,
    );
    prompt = await enhancePromptWithSearch(config, prompt, searchQuery);

    const result = await callAiApi(
      config,
      prompt,
      `单条摘要(${candidateText.length}字输入): ${title}`,
    );
    if (result.success && result.summary) {
      const finalSummary = await appendChangelogGroups(
        config,
        title,
        result.summary,
        plainText,
      );
      cache.set(title, candidateText, finalSummary);
      return finalSummary;
    }

    if (candidateText !== summaryInput) {
      debug(config, `AI 摘要失败，降级为更短输入重试: ${title}`, "AI", "info");
    }
  }

  return "";
}

export async function getBatchAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>,
): Promise<string> {
  if (shouldSkipAiSummary(config) || items.length === 0) return "";
  if (items.length === 1) {
    return getAiSummary(config, items[0].title, items[0].content);
  }

  debug(config, `批量生成 AI 摘要: ${items.length} 条内容`, "AI-Batch", "info");

  try {
    const cleanedItems = cleanSummaryItems(items, config.ai!.maxInputLength!);
    if (cleanedItems.length === 0) {
      debug(config, "所有内容都太短，无法生成批量摘要", "AI-Batch", "info");
      return "";
    }

    let prompt = buildBatchSummaryPrompt(cleanedItems);
    prompt = await enhancePromptWithSearch(
      config,
      prompt,
      cleanedItems[0].title,
      "批量摘要 - ",
    );

    const result = await callAiApi(
      config,
      prompt,
      `批量摘要: ${cleanedItems.length}条`,
    );
    if (result.success && result.summary) {
      debug(
        config,
        `批量摘要生成成功: ${result.summary.substring(0, 50)}...`,
        "AI-Batch",
        "details",
      );
    }

    return result.summary;
  } catch (error: any) {
    debug(config, `批量摘要生成失败: ${error.message}`, "AI-Batch", "error");
    return "";
  }
}

export async function getSmartAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>,
): Promise<string> {
  if (shouldSkipAiSummary(config) || items.length === 0) {
    return "";
  }

  const threshold = 3;
  if (items.length > threshold) {
    return getBatchAiSummary(config, items);
  }

  const summaries = await Promise.all(
    items.map((item) => getAiSummary(config, item.title, item.content)),
  );
  return summaries.filter((summary) => summary).join("\n\n");
}
