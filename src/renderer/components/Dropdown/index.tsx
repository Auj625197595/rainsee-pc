import * as React from 'react';
import { createPortal } from 'react-dom';

import { ContextMenuItem, ContextMenuItemProps } from '../ContextMenu';
import { StyledDropdown, DropdownMenu, Label, DropIcon } from './styles';

interface ItemProps extends ContextMenuItemProps {
  value: string;
  children?: any;
}

const Item = (props: ItemProps) => {
  return <ContextMenuItem {...props}>{props.children}</ContextMenuItem>;
};

interface Props {
  color?: string;
  children?: any;
  defaultValue?: any;
  onChange?: (newValue?: any, oldValue?: any) => void;
  onMouseDown?: (e: React.MouseEvent<any>) => void;
  style?: any;
}

interface State {
  expanded: boolean;
  label?: string;
  value?: string;
  menuPosition?: {
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  };
}

export class Dropdown extends React.PureComponent<Props, State> {
  public static Item = Item;

  private root: HTMLDivElement | null = null;
  private menu: HTMLDivElement | null = null;

  public state: State = {
    expanded: false,
  };

  componentDidMount() {
    const { defaultValue } = this.props;

    if (defaultValue != null) {
      this.setValue(defaultValue, false);
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.defaultValue !== prevProps.defaultValue) {
      this.setValue(this.props.defaultValue, false);
    }
  }

  public setValue(value: string, emitEvent = true) {
    const { onChange, children } = this.props;
    const oldValue = this.state.value;
    const el = children.find((r: any) => r.props.value === value);

    if (el) {
      this.setState({
        value,
        label: el.props.children,
      });

      if (emitEvent && onChange) {
        onChange(value, oldValue);
      }
    }
  }

  public toggleMenu(val: boolean) {
    this.setState({
      expanded: val,
      ...(val ? { menuPosition: this.getMenuPosition() } : {}),
    });

    requestAnimationFrame(() => {
      if (val) {
        this.updateMenuPosition();
        window.addEventListener('mousedown', this.onWindowMouseDown);
        window.addEventListener('resize', this.updateMenuPosition);
        window.addEventListener('scroll', this.updateMenuPosition, true);
      } else {
        window.removeEventListener('mousedown', this.onWindowMouseDown);
        window.removeEventListener('resize', this.updateMenuPosition);
        window.removeEventListener('scroll', this.updateMenuPosition, true);
      }
    });
  }

  componentWillUnmount() {
    window.removeEventListener('mousedown', this.onWindowMouseDown);
    window.removeEventListener('resize', this.updateMenuPosition);
    window.removeEventListener('scroll', this.updateMenuPosition, true);
  }

  private updateMenuPosition = (event?: Event) => {
    if (!this.state.expanded) return;
    if (event?.target === this.menu) return;

    this.setState({ menuPosition: this.getMenuPosition() });
  };

  private getMenuPosition() {
    const rect = this.root?.getBoundingClientRect();
    if (!rect) return undefined;

    const viewportMargin = 8;
    const spaceBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - viewportMargin,
    );
    const spaceAbove = Math.max(0, rect.top - viewportMargin);
    const menuHeight = this.menu?.scrollHeight || 0;
    const openAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = openAbove ? spaceAbove : spaceBelow;

    return {
      top: openAbove ? rect.top - Math.min(menuHeight, maxHeight) : rect.bottom,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  }

  private onItemClick = (value: string) => () => {
    this.setValue(value);
    this.toggleMenu(false);
  };

  private onItemMouseDown = (e: React.MouseEvent<any>) => {
    e.stopPropagation();
  };

  private onMouseDown = (e: React.MouseEvent<any>) => {
    e.stopPropagation();

    if (this.props.onMouseDown) this.props.onMouseDown(e);

    const { expanded } = this.state;
    this.toggleMenu(!expanded);
  };

  public onWindowMouseDown = () => {
    this.toggleMenu(false);
  };

  render() {
    const { children, style } = this.props;
    const { expanded, label, value, menuPosition } = this.state;

    // 触发按钮文案从当前选中项实时派生:子项文案被翻译(语言切换)时,收起态
    // 的触发标签立即跟随,而不是停留在挂载时抓取的旧文案快照(state.label
    // 仅在 defaultValue 变化时重同步)。仅作兜底保留。
    const selected = React.Children.toArray(children).find(
      (child) => React.isValidElement(child) && child.props.value === value,
    ) as React.ReactElement<ItemProps> | undefined;
    const displayLabel =
      (React.isValidElement(selected) && selected.props.children) || label;

    const menu = (
      <DropdownMenu
        style={{
          top: menuPosition?.top || 0,
          left: menuPosition?.left || 0,
          width: menuPosition?.width || '100%',
          maxHeight: menuPosition?.maxHeight,
          position: 'fixed',
        }}
        visible={expanded}
        ref={(menu) => {
          this.menu = menu;
        }}
      >
        {React.Children.map(children, (child) => {
          const { props } = child;

          return React.cloneElement(child, {
            selected: value === props.value,
            onClick: this.onItemClick(props.value),
            onMouseDown: this.onItemMouseDown,
          });
        })}
      </DropdownMenu>
    );

    return (
      <StyledDropdown
        className="dropdown"
        onMouseDown={this.onMouseDown}
        style={style}
        ref={(root) => {
          this.root = root;
        }}
      >
        <Label>{displayLabel}</Label>
        <DropIcon expanded={expanded} />
        {createPortal(menu, document.body)}
      </StyledDropdown>
    );
  }
}
