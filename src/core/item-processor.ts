import * as cheerio from "cheerio";
import { Context } from "koishi";

import { Config, rssArg } from "../types";
import { debug } from "../utils/logger";
import { createSanitizer } from "../utils/sanitizer";
import { getAiSummary } from "./ai";
import { processItemTemplate } from "./item-processor-template";
import {
  ItemProcessorRuntimeDeps,
  normalizeText,
} from "./item-processor-runtime";

function normalizeLinkValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeLinkValue(item);
      if (normalized) return normalized;
    }
    return "";
  }
  if (typeof value === "object") {
    const linkValue = value as Record<string, any>;
    return (
      linkValue.href || linkValue.url || linkValue.link || linkValue.value || ""
    );
  }
  return String(value);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function isRenderableSectionImage(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return !/\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/i.test(url);
}

function isImageUrl(url: string): boolean {
  return (
    /^data:image\//i.test(url) ||
    /\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:[?#]|$)/i.test(url)
  );
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/i.test(url);
}

function normalizeMediaUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://sbox.game${url}`;
  return url;
}

function isIgnoredMediaUrl(url: string): boolean {
  if (!url) return true;
  return (
    /\/img\/ratings\//i.test(url) ||
    /steamcommunity\.com/i.test(url) ||
    /(avatar|profile_avatar|steamuserimages)/i.test(url)
  );
}

function looksLikeHtmlSummary(summary: string): boolean {
  return /<\s*(p|div|ul|ol|li|img|h[1-6])\b/i.test(String(summary || ""));
}

function sanitizeAiSummaryHtml(summary: string): string {
  const $ = cheerio.load(
    `<div id="__ai_summary_root__">${summary || ""}</div>`,
  );
  $("img").each((_, element) => {
    const src = normalizeMediaUrl($(element).attr("src") || "");
    if (!src || !isImageUrl(src) || isIgnoredMediaUrl(src)) {
      $(element).remove();
      return;
    }
    $(element).attr("src", src);
  });
  $("video, source, picture, iframe").remove();
  return $("#__ai_summary_root__").html() || "";
}

function extractSectionMediaMap(
  sourceHtml: string,
): Map<string, { image: string; hasVideoOnly: boolean }> {
  const $ = cheerio.load(sourceHtml || "");
  const mediaMap = new Map<string, { image: string; hasVideoOnly: boolean }>();
  let currentTitle = "";

  $("h2, p").each((_, element) => {
    const tagName = (element as any).tagName?.toLowerCase();
    const text = normalizeSectionText($(element).text());
    if (!text) return;

    if (tagName === "h2") {
      currentTitle = text;
      if (!mediaMap.has(currentTitle)) {
        mediaMap.set(currentTitle, { image: "", hasVideoOnly: false });
      }
      return;
    }

    if (!currentTitle || !text.startsWith("[当前小节媒体]")) return;
    const mediaInfo = mediaMap.get(currentTitle)!;
    const imageMatch = text.match(
      /^\[当前小节媒体\]\s+\[(图片链接|视频封面链接)\]\s+(\S+)/,
    );
    if (imageMatch && !mediaInfo.image) {
      mediaInfo.image = imageMatch[2];
      return;
    }
    if (/^\[当前小节媒体\]\s+\[视频链接\]\s+\S+/.test(text)) {
      mediaInfo.hasVideoOnly = true;
    }
  });

  return mediaMap;
}

function applySectionMediaFromSource(
  summaryHtml: string,
  sourceHtml: string,
): string {
  if (!summaryHtml) return "";

  const mediaMap = extractSectionMediaMap(sourceHtml);
  if (!mediaMap.size) return summaryHtml;

  const $ = cheerio.load(`<div id="__ai_summary_root__">${summaryHtml}</div>`);
  $(".rss-ai-section").each((_, element) => {
    const section = $(element);
    const title = normalizeSectionText(
      section.find(".rss-ai-section-title").first().text(),
    );
    if (!title) return;

    const mediaInfo = mediaMap.get(title);
    section.find(".rss-ai-section-image").remove();
    if (mediaInfo?.image) {
      section.append(
        `<img class="rss-ai-section-image" src="${escapeHtmlAttr(mediaInfo.image)}" alt="" />`,
      );
    }
  });

  return $("#__ai_summary_root__").html() || summaryHtml;
}

function normalizeSectionText(text: string): string {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMediaLinesFromNode(
  $: cheerio.CheerioAPI,
  node: any,
  seenUrls = new Set<string>(),
): string[] {
  const mediaLines: string[] = [];
  const pushLine = (label: string, rawUrl?: string) => {
    const url = normalizeMediaUrl(rawUrl || "");
    if (!url || seenUrls.has(url) || isIgnoredMediaUrl(url)) return;
    if (
      (label === "[图片链接]" || label === "[视频封面链接]") &&
      !isImageUrl(url)
    )
      return;
    if (label === "[视频链接]" && !isVideoUrl(url)) return;
    seenUrls.add(url);
    mediaLines.push(`${label} ${url}`);
  };

  $(node)
    .find("img")
    .each((_, element) => {
      pushLine("[图片链接]", (element as any).attribs?.src);
    });
  $(node)
    .find("video")
    .each((_, element) => {
      const poster = (element as any).attribs?.poster;
      const src = (element as any).attribs?.src;
      if (poster) {
        pushLine("[视频封面链接]", poster);
      } else if (src) {
        pushLine("[视频链接]", src);
      }
    });
  $(node)
    .find("source")
    .each((_, element) => {
      const src = (element as any).attribs?.src;
      if (isVideoUrl(normalizeMediaUrl(src || ""))) {
        pushLine("[视频链接]", src);
      } else {
        pushLine("[图片链接]", src);
      }
    });
  $(node)
    .find("a[href]")
    .each((_, element) => {
      const href = (element as any).attribs?.href;
      if (isVideoUrl(normalizeMediaUrl(href || ""))) {
        pushLine("[视频链接]", href);
      } else {
        pushLine("[图片链接]", href);
      }
    });

  return mediaLines;
}

function extractChangelogTextFromPage(pageHtml: string): string {
  if (!pageHtml) return "";

  const $ = cheerio.load(pageHtml);
  $("script, style, noscript").remove();
  $("br").replaceWith("\n");
  $(
    "h1, h2, h3, h4, h5, h6, p, li, section, article, blockquote, pre, div",
  ).each((_, element) => {
    $(element).append("\n");
  });
  $("li").each((_, element) => {
    const text = $(element).text().trim();
    if (text && !text.startsWith("• ")) {
      $(element).text(`• ${text}`);
    }
  });

  const lines = $.text()
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) =>
    /^(🎁\s*)?Added[:：]?$/i.test(line),
  );
  if (startIndex < 0) return "";

  const collected: string[] = [];
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (
      /^(🎁\s*)?Added[:：]?$|^(🧼\s*)?Improved[:：]?$|^(🪛\s*)?Fixed[:：]?$/i.test(
        line,
      )
    ) {
      collected.push(line);
      continue;
    }
    if (/^•\s+/.test(line)) {
      collected.push(line);
      continue;
    }
    if (collected.length && /^\w/.test(line) && !/^•\s+/.test(line)) {
      const lastIndex = collected.length - 1;
      if (/^•\s+/.test(collected[lastIndex])) {
        collected[lastIndex] += ` ${line}`;
      }
    }
  }

  return collected.join("\n");
}

function hasChangelogGroups(html: string): boolean {
  if (!html) return false;

  const $ = cheerio.load(html);
  const lines = normalizeSectionText($.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.some((line) =>
    /^(🎁\s*)?Added[:：]?$|^(🧼\s*)?Improved[:：]?$|^(🪛\s*)?Fixed[:：]?$/i.test(
      line,
    ),
  );
}

function appendChangelogHtml(
  sectionedHtml: string,
  changelogText: string,
): string {
  if (!sectionedHtml || !changelogText || hasChangelogGroups(sectionedHtml))
    return sectionedHtml;
  const changelogHtml = changelogText
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  return `${sectionedHtml}<h2>Added / Improved / Fixed</h2>${changelogHtml}`;
}

function hasArticleSections(html: string): boolean {
  if (!html) return false;

  const $ = cheerio.load(html);
  const titles = $("h1, h2, h3")
    .toArray()
    .map((element) => normalizeSectionText($(element).text()))
    .filter(Boolean)
    .filter(
      (title) =>
        !/^Added\s*\/\s*Improved\s*\/\s*Fixed$/i.test(title) &&
        !/^(🎁\s*)?Added[:：]?$/i.test(title) &&
        !/^(🧼\s*)?Improved[:：]?$/i.test(title) &&
        !/^(🪛\s*)?Fixed[:：]?$/i.test(title),
    );

  return titles.length >= 2;
}

function shouldFetchRenderedChangelog(
  title: string,
  articleHtml: string,
): boolean {
  if (!articleHtml || hasChangelogGroups(articleHtml)) return false;
  const text = cheerio.load(articleHtml).text();
  return (
    /Update\s+\d{2}\.\d{2}\.\d{2}/i.test(String(title || "")) ||
    /\bCatch Up\b/i.test(text)
  );
}

function stripMediaFromNode($: cheerio.CheerioAPI, node: any): any {
  const clone = $(node).clone();
  clone.find("script, style, noscript, svg, button, form").remove();
  clone
    .find(
      ".comments, .reply, .footer, .rating, .ratings, .menu, .navbar, .nav, .sidebar, .share, .social, .login",
    )
    .remove();
  clone.find("img, video, source, picture, iframe").remove();
  clone.find("a[href]").each((_, element) => {
    const href = normalizeMediaUrl($(element).attr("href") || "");
    if (isImageUrl(href) || isVideoUrl(href)) {
      $(element).remove();
    }
  });
  return clone;
}

function findSectionContainer(
  $: cheerio.CheerioAPI,
  root: any,
  heading: any,
): any {
  const headingTitle = normalizeSectionText($(heading).text());
  let cursor = $(heading);
  let best: any = null;

  while (cursor.length && !cursor.is(root)) {
    const headingCount = cursor.find("h1, h2, h3").addBack("h1, h2, h3").length;
    const textLength = normalizeSectionText(cursor.text()).length;
    if (headingCount === 1 && textLength > headingTitle.length + 24) {
      best = cursor;
    }
    cursor = cursor.parent();
  }

  return best || $(heading).parent();
}

function collectSectionNodes($: cheerio.CheerioAPI, container: any): any[] {
  const nodes = [container];
  let sibling = container.next();
  while (sibling.length) {
    const hasHeading =
      /^(h1|h2|h3)$/i.test((sibling[0] as any)?.tagName || "") ||
      sibling.find("h1, h2, h3").length > 0;
    if (hasHeading) break;
    nodes.push(sibling);
    sibling = sibling.next();
  }
  return nodes;
}

function extractSectionedArticleHtml($: cheerio.CheerioAPI, root: any): string {
  const headings = root
    .find("h1, h2, h3")
    .toArray()
    .filter(
      (heading: any) => normalizeSectionText($(heading).text()).length > 0,
    );
  if (!headings.length) return "";

  const sectionFragments: string[] = [];
  const processedNodes = new Set<any>();

  for (const heading of headings) {
    const title = normalizeSectionText($(heading).text());
    if (!title) continue;
    if (/^Update\s+\d{2}\.\d{2}\.\d{2}$/i.test(title)) continue;

    const container = findSectionContainer($, root, heading);
    const sectionNodes = collectSectionNodes($, container);
    if (!sectionNodes.length) continue;

    const firstNode = sectionNodes[0].get(0);
    if (!firstNode || processedNodes.has(firstNode)) continue;

    const mediaLines: string[] = [];
    const seenUrls = new Set<string>();
    const bodyParts: string[] = [];

    for (let index = 0; index < sectionNodes.length; index++) {
      const sectionNode = sectionNodes[index];
      const domNode = sectionNode.get(0);
      if (domNode) processedNodes.add(domNode);

      mediaLines.push(...extractMediaLinesFromNode($, sectionNode, seenUrls));
      const cleanedNode = stripMediaFromNode($, sectionNode);
      if (index === 0) {
        cleanedNode.find("h1, h2, h3").first().remove();
      }
      const cleanedHtml = $.html(cleanedNode) || "";
      if (normalizeSectionText(cleanedNode.text())) {
        bodyParts.push(cleanedHtml);
      }
    }

    if (!bodyParts.length && !mediaLines.length) continue;
    const mediaHtml = mediaLines
      .map((line) => `<p>${escapeHtml(`[当前小节媒体] ${line}`)}</p>`)
      .join("");
    sectionFragments.push(
      `<h2>${escapeHtml(title)}</h2>${bodyParts.join("")}${mediaHtml}`,
    );
  }

  return sectionFragments.join("");
}

function extractStructuredNewsSections(
  $: cheerio.CheerioAPI,
  root: any,
): string {
  const sections = root.find(".news-section").toArray();
  if (!sections.length) return "";

  const sectionFragments: string[] = [];
  for (const section of sections) {
    const sectionNode = $(section);
    const title = normalizeSectionText(
      sectionNode
        .find(
          ".news-section-header .title, .news-section-header h1, .news-section-header h2, .news-section-header h3, h1, h2, h3",
        )
        .first()
        .text(),
    );
    if (!title) continue;

    const bodyNode = sectionNode.find(".news-section-body").first();
    const contentNode = bodyNode.length ? bodyNode : sectionNode;
    const mediaLines = extractMediaLinesFromNode(
      $,
      contentNode,
      new Set<string>(),
    );
    const cleanedNode = stripMediaFromNode($, contentNode);
    cleanedNode.find(".news-section-header, .title, h1, h2, h3").remove();

    const cleanedText = normalizeSectionText(cleanedNode.text());
    const cleanedHtml = cleanedText ? $.html(cleanedNode) || "" : "";
    if (!cleanedHtml && !mediaLines.length) continue;

    const mediaHtml = mediaLines
      .map((line) => `<p>${escapeHtml(`[当前小节媒体] ${line}`)}</p>`)
      .join("");
    sectionFragments.push(
      `<h2>${escapeHtml(title)}</h2>${cleanedHtml}${mediaHtml}`,
    );
  }

  return sectionFragments.join("");
}

function transformStructuredSummaryToHtml(summary: string): string {
  const text = String(summary || "")
    .replace(/\r/g, "")
    .trim();
  if (!text) return "";

  const lines = text.split("\n");
  const sections: Array<{ title: string; summary: string; image: string }> = [];
  const changeGroups: Record<"Added" | "Improved" | "Fixed", string[]> = {
    Added: [],
    Improved: [],
    Fixed: [],
  };

  let lead = "";
  let mode = "";
  let currentSection: { title: string; summary: string; image: string } | null =
    null;
  let currentField: "title" | "summary" | "image" | "" = "";
  let currentChangeGroup: "Added" | "Improved" | "Fixed" | "" = "";
  let currentChangeIndex = -1;

  const flushSection = () => {
    if (!currentSection) return;
    if (
      currentSection.title ||
      currentSection.summary ||
      currentSection.image
    ) {
      sections.push(currentSection);
    }
    currentSection = null;
    currentField = "";
  };

  const appendContinuation = (line: string) => {
    const value = line.trim();
    if (!value) return;
    if (mode === "lead") {
      lead = lead ? `${lead} ${value}` : value;
      return;
    }
    if (mode === "points" && currentSection && currentField) {
      currentSection[currentField] = currentSection[currentField]
        ? `${currentSection[currentField]} ${value}`
        : value;
      return;
    }
    if (mode === "changes" && currentChangeGroup && currentChangeIndex >= 0) {
      changeGroups[currentChangeGroup][currentChangeIndex] += ` ${value}`;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^简述[:：]\s*$/.test(line)) {
      flushSection();
      mode = "lead";
      currentChangeGroup = "";
      currentChangeIndex = -1;
      continue;
    }
    if (/^要点[:：]\s*$/.test(line)) {
      flushSection();
      mode = "points";
      currentChangeGroup = "";
      currentChangeIndex = -1;
      continue;
    }
    if (/^细则[:：]\s*$/.test(line)) {
      flushSection();
      mode = "changes";
      currentChangeGroup = "";
      currentChangeIndex = -1;
      continue;
    }

    const changeGroupMatch = line.match(/^(Added|Improved|Fixed)[:：]\s*$/i);
    if (changeGroupMatch) {
      flushSection();
      mode = "changes";
      currentChangeGroup =
        `${changeGroupMatch[1][0].toUpperCase()}${changeGroupMatch[1].slice(1).toLowerCase()}` as
          | "Added"
          | "Improved"
          | "Fixed";
      currentChangeIndex = -1;
      continue;
    }

    if (mode === "lead") {
      lead = lead ? `${lead} ${line}` : line;
      continue;
    }

    if (mode === "points") {
      const titleMatch = line.match(/^-?\s*小节[:：]\s*(.+)$/);
      if (titleMatch) {
        flushSection();
        currentSection = {
          title: titleMatch[1].trim(),
          summary: "",
          image: "",
        };
        currentField = "title";
        continue;
      }

      const summaryMatch = line.match(/^摘要[:：]\s*(.+)$/);
      if (summaryMatch) {
        currentSection ||= { title: "", summary: "", image: "" };
        currentSection.summary = summaryMatch[1].trim();
        currentField = "summary";
        continue;
      }

      const imageMatch = line.match(/^图片[:：]\s*(.+)$/);
      if (imageMatch) {
        currentSection ||= { title: "", summary: "", image: "" };
        currentSection.image = imageMatch[1].trim();
        currentField = "image";
        continue;
      }
    }

    if (mode === "changes" && currentChangeGroup) {
      const itemMatch = line.match(/^-\s*(.+)$/);
      if (itemMatch) {
        changeGroups[currentChangeGroup].push(itemMatch[1].trim());
        currentChangeIndex = changeGroups[currentChangeGroup].length - 1;
        continue;
      }
    }

    appendContinuation(line);
  }

  flushSection();

  const htmlParts: string[] = [];
  if (lead) {
    htmlParts.push(`<p class="rss-ai-lead">${escapeHtml(lead)}</p>`);
  }

  for (const section of sections) {
    const sectionParts: string[] = [];
    if (section.title) {
      sectionParts.push(
        `<div class="rss-ai-section-title">${escapeHtml(section.title)}</div>`,
      );
    }
    if (section.summary) {
      sectionParts.push(
        `<p class="rss-ai-section-summary">${escapeHtml(section.summary)}</p>`,
      );
    }
    if (
      section.image &&
      isRenderableSectionImage(section.image) &&
      !/^(无|none)$/i.test(section.image)
    ) {
      sectionParts.push(
        `<img class="rss-ai-section-image" src="${escapeHtmlAttr(section.image)}" alt="" />`,
      );
    }
    if (sectionParts.length) {
      htmlParts.push(
        `<div class="rss-ai-section">${sectionParts.join("")}</div>`,
      );
    }
  }

  for (const groupName of ["Added", "Improved", "Fixed"] as const) {
    const items = changeGroups[groupName].filter(Boolean);
    if (!items.length) continue;
    htmlParts.push(
      `<div class="rss-ai-change-group"><div class="rss-ai-change-title">${groupName}</div><ul class="rss-ai-change-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`,
    );
  }

  if (htmlParts.length) {
    return htmlParts.join("");
  }

  return `<p class="rss-ai-lead">${escapeHtml(text)}</p>`;
}

function extractDetailedArticleHtml(source: any): string {
  const pageHtml = typeof source === "string" ? source : source?.data || "";
  if (!pageHtml) return "";

  const $ = cheerio.load(pageHtml);
  const preferredSelectors = [
    "#news-sections",
    ".news-post .sections",
    ".news-post",
  ];

  for (const selector of preferredSelectors) {
    const preferred = $(selector).first();
    if (preferred.length) {
      const root = preferred.clone();
      root
        .find(
          "script, style, noscript, nav, header, footer, aside, form, svg, button",
        )
        .remove();
      root
        .find(
          ".comments, .reply, .footer, .rating, .ratings, .menu, .navbar, .nav, .sidebar, .share, .social, .login",
        )
        .remove();
      const sectionedHtml =
        extractStructuredNewsSections($, preferred) ||
        extractSectionedArticleHtml($, root);
      if (sectionedHtml) {
        const changelogText = extractChangelogTextFromPage(pageHtml);
        return appendChangelogHtml(sectionedHtml, changelogText);
      }
    }
  }

  const selectors = [
    "main article",
    "article",
    ".news-post",
    ".post",
    ".content article",
    "main",
    ".content",
    "body",
  ];

  let root: cheerio.Cheerio<any> | null = null;
  let bestScore = -1;
  for (const selector of selectors) {
    const candidate = $(selector).first();
    if (candidate.length) {
      const clone = candidate.clone();
      clone
        .find(
          "script, style, noscript, nav, header, footer, aside, form, svg, button",
        )
        .remove();
      clone
        .find(
          ".comments, .reply, .footer, .rating, .ratings, .menu, .navbar, .nav, .sidebar, .share, .social, .login",
        )
        .remove();
      const headingCount = clone.find("h1, h2, h3").length;
      const textLength = normalizeSectionText(clone.text()).length;
      const score = headingCount * 10000 + textLength;
      if (score > bestScore) {
        root = clone;
        bestScore = score;
      }
    }
  }

  if (!root?.length) return "";

  root
    .find(
      "script, style, noscript, nav, header, footer, aside, form, svg, button",
    )
    .remove();
  root
    .find(
      ".comments, .reply, .footer, .rating, .ratings, .menu, .navbar, .nav, .sidebar, .share, .social, .login",
    )
    .remove();
  const sectionedHtml = extractSectionedArticleHtml($, root);
  if (sectionedHtml) {
    const changelogText = extractChangelogTextFromPage(pageHtml);
    return appendChangelogHtml(sectionedHtml, changelogText);
  }
  root.find("img").each((_, element) => {
    const src = normalizeMediaUrl((element as any).attribs?.src || "");
    const alt = element.attribs?.alt || "配图";
    if (!src || !isImageUrl(src) || isIgnoredMediaUrl(src)) {
      $(element).remove();
      return;
    }
    $(element).replaceWith(`<p>[图片] ${alt}: ${src}</p>`);
  });
  root.find("video").each((_, element) => {
    const poster = normalizeMediaUrl((element as any).attribs?.poster || "");
    const src = normalizeMediaUrl((element as any).attribs?.src || "");
    if (poster && isImageUrl(poster) && !isIgnoredMediaUrl(poster)) {
      $(element).replaceWith(`<p>[视频封面] ${poster}</p>`);
    } else if (src && isVideoUrl(src)) {
      $(element).replaceWith(`<p>[视频链接] ${src}</p>`);
    } else {
      $(element).remove();
    }
  });
  root.find("source").each((_, element) => {
    const src = normalizeMediaUrl((element as any).attribs?.src || "");
    if (src && isVideoUrl(src)) {
      $(element).replaceWith(`<p>[视频链接] ${src}</p>`);
    } else {
      $(element).remove();
    }
  });
  root.find("a[href]").each((_, element) => {
    const href = normalizeMediaUrl((element as any).attribs?.href || "");
    if (href && isImageUrl(href) && !isIgnoredMediaUrl(href)) {
      $(element).replaceWith(`<p>[图片链接] ${href}</p>`);
    } else if (href && isVideoUrl(href)) {
      $(element).replaceWith(`<p>[视频链接] ${href}</p>`);
    }
  });

  return root.html() || "";
}

function hasEnoughArticleDetail(html: string, fallback: string): boolean {
  if (!html) return false;
  const text = cheerio.load(html).text().replace(/\s+/g, " ").trim();
  return text.length >= Math.max(fallback.length + 120, 300);
}

export class RssItemProcessor {
  constructor(
    private ctx: Context,
    private config: Config,
    private $http: any,
  ) {}

  private getRuntimeDeps(): ItemProcessorRuntimeDeps {
    return {
      ctx: this.ctx,
      config: this.config,
      $http: this.$http,
    };
  }

  private async fetchRenderedArticleHtml(url: string): Promise<string> {
    if (!this.ctx.puppeteer) return "";

    const page = await this.ctx.puppeteer.page();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 2e4 });
      try {
        await page.waitForSelector("article, main, h1, h2, .title", {
          timeout: 5e3,
        });
      } catch {}
      try {
        await page.evaluate(async () => {
          const getScrollableHeight = () =>
            Math.max(
              document.body?.scrollHeight || 0,
              document.documentElement?.scrollHeight || 0,
            );
          const maxPasses = 12;
          let lastHeight = 0;
          for (let index = 0; index < maxPasses; index++) {
            const nextHeight = getScrollableHeight();
            window.scrollTo({ top: nextHeight, behavior: "auto" });
            await new Promise((resolve) => setTimeout(resolve, 350));
            const currentHeight = getScrollableHeight();
            if (
              currentHeight <= lastHeight &&
              window.innerHeight + window.scrollY >= currentHeight - 4
            ) {
              break;
            }
            lastHeight = currentHeight;
          }
          window.scrollTo({ top: 0, behavior: "auto" });
        });
      } catch {}
      return await page.content();
    } catch (error: any) {
      debug(
        this.config,
        `puppeteer 抓取文章正文失败: ${error?.message || error}`,
        "ai source",
        "info",
      );
      return "";
    } finally {
      try {
        await page.close();
      } catch {}
    }
  }

  private async buildAiSourceHtml(item: any, arg: rssArg): Promise<string> {
    const fallback = normalizeText(item?.description);
    if (!item.link) return fallback;

    let detailedHtml = "";
    let renderedPageHtml = "";

    try {
      const response = await this.$http(item.link, arg);
      detailedHtml = extractDetailedArticleHtml(response?.data || response);
      if (
        hasEnoughArticleDetail(detailedHtml, fallback) &&
        hasArticleSections(detailedHtml) &&
        !shouldFetchRenderedChangelog(item?.title, detailedHtml)
      ) {
        return detailedHtml;
      }
    } catch (error: any) {
      debug(
        this.config,
        `抓取文章正文失败，回退 RSS 摘要: ${error?.message || error}`,
        "ai source",
        "info",
      );
    }

    renderedPageHtml = await this.fetchRenderedArticleHtml(item.link);
    const renderedHtml = extractDetailedArticleHtml(renderedPageHtml);
    if (
      hasEnoughArticleDetail(renderedHtml, fallback) &&
      hasArticleSections(renderedHtml)
    )
      return renderedHtml;

    if (detailedHtml && renderedPageHtml) {
      const renderedChangelogText =
        extractChangelogTextFromPage(renderedPageHtml);
      const mergedHtml = appendChangelogHtml(
        detailedHtml,
        renderedChangelogText,
      );
      if (
        hasEnoughArticleDetail(mergedHtml, fallback) &&
        hasArticleSections(mergedHtml)
      )
        return mergedHtml;
    }

    if (hasEnoughArticleDetail(detailedHtml, fallback)) return detailedHtml;
    return fallback;
  }

  async parseRssItem(
    item: any,
    arg: rssArg,
    authorId: string | number,
  ): Promise<string> {
    void authorId;

    debug(this.config, arg, "rss arg", "details");
    let template = arg.template;

    item.title = normalizeText(item?.title);
    item.link = normalizeLinkValue(item?.link);
    item.description = normalizeText(item?.description);

    const sanitizer = createSanitizer(this.config);
    if (sanitizer.isEnabled() && item.description) {
      item.description = sanitizer.sanitize(item.description);
    }

    let aiSummary = "";
    let formattedAiSummary = "";
    const hasCustomAiTemplate =
      this.config.template?.custom?.includes("{{aiSummary}}") ||
      this.config.template?.content?.includes("{{aiSummary}}");

    if (this.config.ai?.enabled) {
      const aiSourceHtml = await this.buildAiSourceHtml(item, arg);
      const rawSummary = await getAiSummary(
        this.config,
        item.title,
        aiSourceHtml,
      );
      if (rawSummary) {
        const htmlSummary = looksLikeHtmlSummary(rawSummary)
          ? sanitizeAiSummaryHtml(rawSummary)
          : "";
        aiSummary = htmlSummary || transformStructuredSummaryToHtml(rawSummary);
        aiSummary = applySectionMediaFromSource(aiSummary, aiSourceHtml);
        formattedAiSummary = `🤖 AI摘要：\n${rawSummary}`;
        item.aiSummary = aiSummary;
      }
    }

    arg.block?.forEach((blockWord: string) => {
      item.description = normalizeText(item.description).replace(
        new RegExp(blockWord, "gim"),
        (matched) =>
          Array(matched.length)
            .fill(this.config.msg?.blockString || "*")
            .join(""),
      );
      item.title = normalizeText(item.title).replace(
        new RegExp(blockWord, "gim"),
        (matched) =>
          Array(matched.length)
            .fill(this.config.msg?.blockString || "*")
            .join(""),
      );
    });

    const html = cheerio.load(item.description);
    if (this.config.basic?.videoMode === "filter" && html("video").length > 0) {
      return "";
    }

    if (template === "auto") {
      template = html.text().length < 300 ? "content" : "custom";
    }

    if (template) {
      debug(this.config, `使用模板: ${template}`, "template", "info");
    }

    let msg = await processItemTemplate({
      deps: this.getRuntimeDeps(),
      template,
      item,
      arg,
      html,
      aiSummary,
    });

    const imageMode = this.config.basic?.imageMode;
    const isImageRenderTemplate =
      template === "custom" ||
      template === "default" ||
      template === "only description";
    if (
      isImageRenderTemplate &&
      ["base64", "File", "assets"].includes(imageMode || "")
    ) {
      formattedAiSummary = "";
    }

    if (this.config.msg?.censor) {
      msg = `<censor>${msg}</censor>`;
    }

    if (formattedAiSummary && !hasCustomAiTemplate && this.config.ai) {
      const sep = this.config.ai.separator || "----------------";
      msg =
        this.config.ai.placement === "bottom"
          ? `${msg}\n${sep}\n${formattedAiSummary}`
          : `${formattedAiSummary}\n${sep}\n${msg}`;
    }

    debug(this.config, msg, "parse:msg", "info");
    return msg;
  }
}
