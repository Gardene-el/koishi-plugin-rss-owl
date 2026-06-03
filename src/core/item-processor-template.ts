import * as cheerio from "cheerio";
import { h } from "koishi";

import { rssArg } from "../types";
import { parseTemplateContent } from "../utils/common";
import { debug } from "../utils/logger";
import {
  SecurityError,
  getSecurityOptions,
  validateUrlOrThrow,
} from "../utils/security";
import { getDescriptionTemplate, getDefaultTemplate } from "../utils/template";
import {
  buildResolvedImageMap,
  formatVideoList,
  ItemProcessorRuntimeDeps,
  normalizeText,
  processVideos,
  renderImageListFromHtml,
  renderLoadedHtml,
  renderTemplatedDescription,
} from "./item-processor-runtime";

interface ProcessItemTemplateParams {
  deps: ItemProcessorRuntimeDeps;
  template: string | undefined;
  item: any;
  arg: rssArg;
  html: cheerio.CheerioAPI;
  aiSummary: string;
}

type ParseContentFn = (templateStr: string, itemObj: any) => string;

async function processCustomTemplate(
  deps: ItemProcessorRuntimeDeps,
  item: any,
  arg: rssArg,
  parseContent: ParseContentFn,
): Promise<string> {
  const customTemplate = deps.config.template?.custom || "";
  const summaryPlaceholder = "__AI_SUMMARY_HTML__";
  let description = parseContent(customTemplate, { ...item, arg });
  if (description.includes(summaryPlaceholder)) {
    description = description.replace(summaryPlaceholder, item.aiSummary || "");
  }
  const renderedDescription = await renderTemplatedDescription(
    deps,
    item,
    arg,
    description,
    {
      skipAiSummarySection:
        customTemplate.includes("{{aiSummary}}") ||
        customTemplate.includes(summaryPlaceholder),
    },
  );
  return parseContent(deps.config.template?.customRemark || "", {
    ...item,
    arg,
    description: renderedDescription,
  });
}

async function processContentTemplate(
  deps: ItemProcessorRuntimeDeps,
  item: any,
  arg: rssArg,
  html: cheerio.CheerioAPI,
  parseContent: ParseContentFn,
): Promise<string> {
  const resolvedImageMap = await buildResolvedImageMap(deps, html, arg);
  html("img").replaceWith((_: any, element: any) => {
    const src = element.attribs?.src;
    return src ? `<p>$img{{${src}}}</p>` : "";
  });

  const contentText = html.text();
  item.description = contentText.replace(
    /\$img\{\{(.*?)\}\}/g,
    (_match, src: string) => {
      const finalUrl = resolvedImageMap[src];
      return finalUrl ? `<img src="${finalUrl}"/>` : "";
    },
  );

  return parseContent(deps.config.template?.content || "", { ...item, arg });
}

async function processDefaultTemplate(
  deps: ItemProcessorRuntimeDeps,
  item: any,
  arg: rssArg,
  parseContent: ParseContentFn,
): Promise<string> {
  const description = parseContent(
    getDefaultTemplate(
      deps.config,
      arg.bodyWidth,
      arg.bodyPadding,
      arg.bodyFontSize || deps.config.template?.bodyFontSize,
    ),
    { ...item, arg },
  );

  return await renderTemplatedDescription(deps, item, arg, description, {
    logImageMode: true,
  });
}

async function processOnlyDescriptionTemplate(
  deps: ItemProcessorRuntimeDeps,
  item: any,
  arg: rssArg,
  parseContent: ParseContentFn,
): Promise<string> {
  const description = parseContent(
    getDescriptionTemplate(
      deps.config,
      arg.bodyWidth,
      arg.bodyPadding,
      arg.bodyFontSize || deps.config.template?.bodyFontSize,
    ),
    { ...item, arg },
  );

  return await renderTemplatedDescription(deps, item, arg, description, {
    contentStyle: "color: #475569; line-height: 1.6;",
    dividerStyle: "border-top: 1px solid #e2e8f0; margin: 24px 0;",
  });
}

async function processLinkTemplate(
  deps: ItemProcessorRuntimeDeps,
  item: any,
  arg: rssArg,
): Promise<string> {
  const html = cheerio.load(item.description);
  const src = html("a").first().attr("href") || normalizeText(item?.link);
  if (!src) {
    debug(
      deps.config,
      "link 模板未找到可用链接，回退原始内容",
      "link src",
      "info",
    );
    return normalizeText(item?.description);
  }

  debug(deps.config, src, "link src", "info");

  try {
    validateUrlOrThrow(src, getSecurityOptions(deps.config));
  } catch (error) {
    if (error instanceof SecurityError) {
      debug(
        deps.config,
        `链接 URL 安全验证失败: ${error.message}`,
        "security",
        "error",
      );
      return `链接安全验证失败: ${error.message}`;
    }
    throw error;
  }

  const html2 = cheerio.load((await deps.$http(src, arg)).data);
  const bodyWidth = arg?.bodyWidth ?? deps.config.template?.bodyWidth ?? 600;
  const bodyPadding =
    arg?.bodyPadding ?? deps.config.template?.bodyPadding ?? 20;
  html2("body").attr("style", `width:${bodyWidth}px;padding:${bodyPadding}px;`);
  return await renderLoadedHtml(deps, html2, arg, true);
}

async function appendVideoMessage(
  deps: ItemProcessorRuntimeDeps,
  html: cheerio.CheerioAPI,
  arg: rssArg,
  msg: string,
  options?: { appendPosterImages?: boolean },
): Promise<string> {
  const videoList: Array<[string, string]> = [];
  await processVideos(deps, html, arg, videoList);

  let result = msg + formatVideoList(videoList);
  if (options?.appendPosterImages) {
    result += videoList
      .filter(([src, poster]) => poster && !src.startsWith("__VIDEO_LINK__"))
      .map(([_, poster]) => h("img", { src: poster }))
      .join("");
  }

  return result;
}

/**
 * 根据模板类型分发并生成 RSS 条目的最终消息内容。
 */
export async function processItemTemplate(
  params: ProcessItemTemplateParams,
): Promise<string> {
  const { deps, template, item, arg, html, aiSummary } = params;
  const parseContent = (templateStr: string, itemObj: any) =>
    parseTemplateContent(templateStr, { ...itemObj, aiSummary });

  switch (template) {
    case "custom": {
      const msg = await processCustomTemplate(deps, item, arg, parseContent);
      return await appendVideoMessage(deps, html, arg, msg);
    }
    case "content": {
      const msg = await processContentTemplate(
        deps,
        item,
        arg,
        html,
        parseContent,
      );
      return await appendVideoMessage(deps, html, arg, msg, {
        appendPosterImages: true,
      });
    }
    case "only text":
      return html.text();
    case "only media": {
      const msg = await renderImageListFromHtml(deps, html, arg);
      return await appendVideoMessage(deps, html, arg, msg);
    }
    case "only image":
      return await renderImageListFromHtml(deps, html, arg);
    case "only video": {
      const videoList: Array<[string, string]> = [];
      await processVideos(deps, html, arg, videoList);
      return formatVideoList(videoList);
    }
    case "proto":
      return item.description;
    case "default": {
      const msg = await processDefaultTemplate(deps, item, arg, parseContent);
      return await appendVideoMessage(deps, html, arg, msg);
    }
    case "only description": {
      const msg = await processOnlyDescriptionTemplate(
        deps,
        item,
        arg,
        parseContent,
      );
      return await appendVideoMessage(deps, html, arg, msg);
    }
    case "link":
      return await processLinkTemplate(deps, item, arg);
    default:
      return item.description;
  }
}
