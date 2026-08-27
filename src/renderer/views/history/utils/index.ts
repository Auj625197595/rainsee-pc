import { daysList, monthsList } from '~/renderer/constants/dictionary';

export const compareDates = (first: Date, second: Date) => {
  return (
    first != null &&
    second != null &&
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
};

export const getSectionLabel = (date: Date) => {
  let prefix = '';
  const current = new Date();
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);

  if (compareDates(date, current)) {
    prefix = '今天 - ';
  } else if (compareDates(date, yesterday)) {
    prefix = '昨天 - ';
  }

  return `${prefix}${daysList[date.getDay()]}, ${
    monthsList[date.getMonth()]
  } ${date.getDate()}, ${date.getFullYear()}`;
};

export const formatTime = (date: Date) => {
  return `${date
    .getHours()
    .toString()
    .padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

// 视觉稿日期分组头：标题（今天/昨天/星期几）+ 副标题（星期 · 年 月 日）。

export const getSectionTitle = (date: Date) => {
  const current = new Date();
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);

  if (compareDates(date, current)) return '今天';
  if (compareDates(date, yesterday)) return '昨天';

  return daysList[date.getDay()];
};

export const getSectionSubtitle = (date: Date) => {
  return `${daysList[date.getDay()]} · ${date.getFullYear()} 年 ${
    date.getMonth() + 1
  } 月 ${date.getDate()} 日`;
};

// 计算各时间范围的边界（与 store.range 同口径），供侧栏计数显示使用。
export const getRangeBounds = (
  range: 'today' | 'yesterday' | 'last-week' | 'last-month' | 'older',
): { min: number; max: number } | null => {
  const current = new Date();
  const day = current.getDate();
  const month = current.getMonth();
  const year = current.getFullYear();

  let minDate: Date;
  let maxDate: Date;

  switch (range) {
    case 'today':
      minDate = new Date(year, month, day, 0, 0, 0, 0);
      maxDate = new Date(year, month, day, 23, 59, 59, 999);
      break;
    case 'yesterday':
      minDate = new Date(year, month, day - 1, 0, 0, 0, 0);
      maxDate = new Date(year, month, day - 1, 23, 59, 59, 999);
      break;
    case 'last-week': {
      let currentDay = current.getDay() - 1;
      if (currentDay === -1) currentDay = 6;
      minDate = new Date(year, month, day - currentDay - 7, 0, 0, 0, 0);
      maxDate = new Date(year, month, day - currentDay - 1, 0, 0, 0, 0);
      break;
    }
    case 'last-month':
      minDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
      maxDate = new Date(year, month, 0, 0, 0, 0, 0);
      break;
    case 'older': {
      let currentDay = current.getDay() - 1;
      if (currentDay === -1) currentDay = 6;
      minDate = new Date(0);
      maxDate = new Date(year, month, day - currentDay - 7, 0, 0, 0, 0);
      break;
    }
    default:
      return null;
  }

  return { min: minDate.getTime(), max: maxDate.getTime() };
};
