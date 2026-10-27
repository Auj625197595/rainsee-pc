export const TAB_MAX_WIDTH = 240;
export const TAB_MIN_WIDTH = 72;
// 多行 shrink 模式的舒适换行宽度。标签先从最大宽度收缩到该值，继续变窄
// 才增加一行；达到配置行数上限后仍可继续缩到 TAB_MIN_WIDTH。
export const TAB_WRAP_WIDTH = 180;
export const TAB_PINNED_WIDTH = 40;
export const TAB_ANIMATION_DURATION = 200;
export const TABS_PADDING = 2;

// 标签组芯片(chip)解析法定宽常量。组在标签栏里是单个折叠 slot,宽度按内容
// 解析计算(不读 DOM),避免与 animejs 布局动画抢帧。
export const CHIP_PAD_LR = 8; // 芯片左右内边距
export const CHIP_NAME_MAX = 64; // 组名最大宽度(超出 ellipsis)
export const CHIP_NAME_FAV_GAP = 6; // 组名与 favicon 行的间距
export const CHIP_FAV_W = 22; // 每个 favicon 槽宽
export const CHIP_ACTIVE_TITLE_W = 120; // 含选中标签时显示的标题槽(~5 格)
export const CHIP_MAX_WIDTH = 320; // 芯片最大宽度(触顶则可横向滚动)
export const CHIP_SLOT_MARGIN = 6; // slot 之间的间距(首个 slot 为 0)
