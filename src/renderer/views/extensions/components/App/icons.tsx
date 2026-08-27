import * as React from 'react';

// 内联图标(跟随 currentColor),与 downloads / settings 页风格一致。

const S = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconSearch = () => (
  <svg {...S()}>
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-3.5-3.5"></path>
  </svg>
);

export const IconAll = () => (
  <svg {...S()}>
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

export const IconCheck = () => (
  <svg {...S()}>
    <circle cx="12" cy="12" r="9"></circle>
    <path d="m8.5 12 2.5 2.5 4.5-5"></path>
  </svg>
);

export const IconBan = () => (
  <svg {...S()}>
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M5.6 5.6l12.8 12.8"></path>
  </svg>
);

export const IconStore = () => (
  <svg {...S()}>
    <path d="M3 9l1.5-5h15L21 9"></path>
    <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
    <path d="M9 9a3 3 0 0 1-6 0M15 9a3 3 0 0 1-6 0M21 9a3 3 0 0 1-6 0"></path>
  </svg>
);

export const IconFolder = () => (
  <svg {...S()}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
  </svg>
);

export const IconCrx = () => (
  <svg {...S()}>
    <path d="M12 3v18M3 12h18"></path>
    <rect x="4" y="4" width="16" height="16" rx="2"></rect>
  </svg>
);

export const IconPuzzle = () => (
  <svg {...S(48)} strokeWidth={1.5}>
    <path d="M20 16.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 16.5V7.5A2.5 2.5 0 0 1 6.5 5H9l2-2h2l2 2h2.5A2.5 2.5 0 0 1 20 7.5z"></path>
  </svg>
);

export const IconBug = () => (
  <svg {...S()}>
    <rect x="8" y="6" width="8" height="14" rx="4"></rect>
    <path d="M8 12H3M21 12h-5M8 8L5 5M16 8l3-3M8 16l-3 3M16 16l3 3"></path>
  </svg>
);

export const IconRefresh = () => (
  <svg {...S()}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path>
    <path d="M21 3v5h-5"></path>
  </svg>
);

export const IconClose = () => (
  <svg {...S(18)}>
    <path d="M6 6l12 12M18 6L6 18"></path>
  </svg>
);

export const IconPlus = () => (
  <svg {...S()}>
    <path d="M12 5v14M5 12h14"></path>
  </svg>
);

export const IconEdit = () => (
  <svg {...S()}>
    <path d="m4 16-.8 4.8L8 20l11.5-11.5a2.1 2.1 0 0 0-3-3z"></path>
    <path d="m14.5 7.5 2 2"></path>
  </svg>
);

export const IconTrash = () => (
  <svg {...S()}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>
  </svg>
);
