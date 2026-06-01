import { describe, expect, it } from 'vitest';
import {
  deriveRecordCategoryOptions,
  extractRecordCategoryValues,
  releaseRecordModeFromCategories,
} from './release-new-model';

describe('extractRecordCategoryValues', () => {
  it('splits Chinese judgment labels joined by 或', () => {
    expect(extractRecordCategoryValues('正向 或 负向 或 中立')).toEqual(['正向', '负向', '中立']);
  });

  it('splits common enum separators without losing CJK labels', () => {
    expect(extractRecordCategoryValues('类别：退款、物流，其他')).toEqual(['退款', '物流', '其他']);
  });

  it('reads quoted enum values', () => {
    expect(extractRecordCategoryValues('Enum: "refund" / "shipping" / "other"')).toEqual([
      'refund',
      'shipping',
      'other',
    ]);
  });
});

describe('deriveRecordCategoryOptions', () => {
  it('collects categories from judgment fields only', () => {
    expect(
      deriveRecordCategoryOptions({
        fields: [
          { key: 'label', value: '正确 或 错误', isJudgment: true },
          { key: 'reason', value: 'text', isJudgment: false },
        ],
      }),
    ).toEqual(['正确', '错误']);
  });
});

describe('releaseRecordModeFromCategories', () => {
  it('maps single correct category to correct_only', () => {
    expect(releaseRecordModeFromCategories(['正确'], ['正确', '错误'])).toBe('correct_only');
  });
});
