import * as util from 'util';

const mutableUtil = util as typeof util & {
  isDate?: (value: unknown) => value is Date;
  isArray?: (value: unknown) => value is unknown[];
  isRegExp?: (value: unknown) => value is RegExp;
  isError?: (value: unknown) => value is Error;
  isPrimitive?: (value: unknown) => boolean;
};

if (typeof mutableUtil.isDate !== 'function') {
  mutableUtil.isDate = (value: unknown): value is Date => value instanceof Date;
}

if (typeof mutableUtil.isArray !== 'function') {
  mutableUtil.isArray = Array.isArray;
}

if (typeof mutableUtil.isRegExp !== 'function') {
  mutableUtil.isRegExp = (value: unknown): value is RegExp =>
    value instanceof RegExp;
}

if (typeof mutableUtil.isError !== 'function') {
  mutableUtil.isError = (value: unknown): value is Error => value instanceof Error;
}

if (typeof mutableUtil.isPrimitive !== 'function') {
  mutableUtil.isPrimitive = (value: unknown) =>
    value === null || (typeof value !== 'object' && typeof value !== 'function');
}
