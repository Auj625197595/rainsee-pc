// 轻量 JSON Schema 子集校验(type/required/enum/min/max/maxLength/maxItems/items/properties)。
// 只覆盖 manifest 用到的关键字,不引第三方依赖,各端可直接移植。

import { JsonSchema } from './protocol';

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (expected: JsonSchema['type'], value: unknown) => {
  if (!expected) return true;
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
};

/** 返回首个错误描述;合法返回 null。 */
export const validateAgainstSchema = (
  schema: JsonSchema,
  value: unknown,
  path = 'arguments',
): string | null => {
  if (!matchesType(schema.type, value)) {
    return `${path} must be ${schema.type}`;
  }
  if (schema.enum && !schema.enum.includes(value as any)) {
    return `${path} must be one of ${schema.enum.join(', ')}`;
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      return `${path} must be >= ${schema.minimum}`;
    }
    if (schema.maximum != null && value > schema.maximum) {
      return `${path} must be <= ${schema.maximum}`;
    }
  }
  if (typeof value === 'string' && schema.maxLength != null && value.length > schema.maxLength) {
    return `${path} is longer than ${schema.maxLength} characters`;
  }
  if (Array.isArray(value)) {
    if (schema.maxItems != null && value.length > schema.maxItems) {
      return `${path} has more than ${schema.maxItems} items`;
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = validateAgainstSchema(schema.items, value[i], `${path}[${i}]`);
        if (err) return err;
      }
    }
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (obj[key] === undefined || obj[key] === null) return `${path}.${key} is required`;
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (obj[key] === undefined) continue;
      const err = validateAgainstSchema(propSchema, obj[key], `${path}.${key}`);
      if (err) return err;
    }
  }
  return null;
};
