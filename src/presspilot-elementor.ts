export interface ElementorTextMatch {
  postId: number;
  elementId: string;
  widgetType: string | null;
  path: string;
  value: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTextSettingKey(key: string): boolean {
  return !/(url|link|css|class|color|background|font|size|width|height|margin|padding|animation|transform|shadow|id)$/i.test(key);
}

function walkStrings(value: unknown, path: string, visit: (path: string, text: string) => void): void {
  if (typeof value === "string") { visit(path, value); return; }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, path + "[" + index + "]", visit));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && !isTextSettingKey(key)) continue;
    walkStrings(child, path ? path + "." + key : key, visit);
  }
}

function replaceInObject(value: unknown, find: string, replace: string, path: string, ids: { count: number }): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => replaceInObject(item, find, replace, path + "[" + index + "]", ids));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + "." + key : key;
    if (typeof child === "string") {
      if (!isTextSettingKey(key) || !child.includes(find)) continue;
      value[key] = child.split(find).join(replace);
      ids.count += 1;
      continue;
    }
    replaceInObject(child, find, replace, childPath, ids);
  }
}

function walkNodes(node: unknown, postId: number, find: string, matches: ElementorTextMatch[]): void {
  if (Array.isArray(node)) {
    node.forEach((item) => walkNodes(item, postId, find, matches));
    return;
  }
  if (!isObject(node)) return;
  const widgetType = typeof node.widgetType === "string" ? node.widgetType : null;
  if (node.elType === "widget" && widgetType) {
    walkStrings(node.settings, "settings", (path, value) => {
      if (value.includes(find)) matches.push({ postId, elementId: String(node.id ?? ""), widgetType, path, value });
    });
  }
  walkNodes(node.elements, postId, find, matches);
}

export function findElementorText(data: unknown, postId: number, find: string, widgetType?: string): ElementorTextMatch[] {
  const matches: ElementorTextMatch[] = [];
  const filtered: ElementorTextMatch[] = [];
  walkNodes(data, postId, find, matches);
  if (!widgetType) return matches;
  for (const match of matches) if (match.widgetType === widgetType) filtered.push(match);
  return filtered;
}

export function editElementorText(data: unknown, postId: number, find: string, replace: string, widgetType?: string, replaceAll = false) {
  const matches = findElementorText(data, postId, find, widgetType);
  if (matches.length === 0) throw new Error("elementor_text_no_match");
  if (matches.length > 1 && !replaceAll) throw new Error("elementor_text_multiple_matches:" + matches.length);
  const targetIds = new Set(matches.map((match) => match.elementId));
  const changed = { count: 0 };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isObject(node)) return;
    if (node.elType === "widget" && targetIds.has(String(node.id ?? ""))) replaceInObject(node.settings, find, replace, "settings", changed);
    walk(node.elements);
  };
  walk(data);
  return {
    match_count: matches.length,
    changed_fields: changed.count,
    element_ids: matches.map((match) => match.elementId),
    matches
  };
}
