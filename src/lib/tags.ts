export const MAX_TIP_TAGS = 8;
export const MAX_TIP_TAG_LENGTH = 32;

export interface MergeTagsResult {
  tags: string[];
  error: string | null;
}

export function normalizeTagName(value: string): string {
  return value.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ");
}

function tagKey(value: string): string {
  return value.toLocaleLowerCase();
}

/**
 * 合并用户输入和已选标签。逗号、中文逗号或换行可一次提交多个标签；
 * 历史标签只用于复用原显示名，不限制用户创建新标签。
 */
export function mergeTipTags(
  selected: string[],
  rawInput: string | string[],
  reusableTags: string[] = [],
): MergeTagsResult {
  const rawValues = Array.isArray(rawInput)
    ? rawInput
    : rawInput.split(/[,，\n]+/).filter((value) => value.trim().length > 0);
  const reusableByKey = new Map(
    reusableTags.map((tag) => [tagKey(normalizeTagName(tag)), normalizeTagName(tag)]),
  );
  const result: string[] = [];
  const seen = new Set<string>();

  const append = (raw: string): string | null => {
    const normalized = normalizeTagName(raw);
    if (!normalized) return null;
    if ([...normalized].length > MAX_TIP_TAG_LENGTH) {
      return `标签不能超过 ${MAX_TIP_TAG_LENGTH} 个字符`;
    }
    const key = tagKey(normalized);
    if (seen.has(key)) return null;
    if (result.length >= MAX_TIP_TAGS) {
      return `每条便签最多添加 ${MAX_TIP_TAGS} 个标签`;
    }
    seen.add(key);
    result.push(reusableByKey.get(key) ?? normalized);
    return null;
  };

  for (const tag of selected) {
    const error = append(tag);
    if (error) return { tags: selected, error };
  }
  for (const raw of rawValues) {
    const error = append(raw);
    if (error) return { tags: selected, error };
  }
  return { tags: result, error: null };
}
