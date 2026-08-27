import { observer } from 'mobx-react-lite';
import * as React from 'react';

import { transparency } from '~/renderer/constants/transparency';
import { Button, Icon, IconComponent, Badge, PreloaderBg } from './style';
import { BLUE_500 } from '~/renderer/constants';
import { Preloader } from '~/renderer/components/Preloader';

type IconType = string | React.ComponentType<any>;

interface Props {
  onClick?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onMouseEnter?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  size?: number;
  style?: any;
  icon: IconType;
  iconColor?: string;
  iconWeight?:
    | 'thin'
    | 'light'
    | 'regular'
    | 'bold'
    | 'fill'
    | 'duotone';
  divRef?: (ref: HTMLDivElement) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children?: any;
  opacity?: number;
  autoInvert?: boolean;
  badgeBackground?: string;
  badge?: boolean;
  badgeTextColor?: string;
  badgeText?: string;
  badgeTop?: number;
  badgeRight?: number;
  preloader?: boolean;
  value?: number;
  toggled?: boolean;
  dense?: boolean;
  iconStyle?: any;
  id?: string;
  rainseeAction?: string;
  rainseeExtensionId?: string;
}

export const ToolbarButton = observer(
  ({
    icon,
    iconColor,
    iconWeight,
    onClick,
    onMouseDown,
    size,
    disabled,
    title,
    className,
    divRef,
    children,
    opacity,
    autoInvert,
    style,
    badgeText,
    badgeBackground,
    badge,
    badgeTextColor,
    badgeTop,
    badgeRight,
    value,
    preloader,
    onContextMenu,
    onMouseUp,
    onMouseEnter,
    onMouseLeave,
    toggled,
    dense,
    iconStyle,
    id,
    rainseeAction,
    rainseeExtensionId,
  }: Props) => {
    style = { ...style };

    return (
      <Button
        id={id}
        title={title}
        data-rainsee-part="toolbar-button"
        data-rainsee-action={rainseeAction}
        data-rainsee-extension-id={rainseeExtensionId}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={className}
        style={{ borderRadius: 99999, ...style }}
        toggled={toggled}
        dense={dense}
        ref={divRef && divRef}
        disabled={disabled}
      >
        {typeof icon === 'string' ? (
          <Icon
            data-rainsee-part="button-icon"
            style={{ backgroundImage: `url(${icon})`, ...iconStyle }}
            size={size}
            dense={dense}
            disabled={disabled}
            opacity={opacity}
            autoInvert={autoInvert}
          />
        ) : (
          <IconComponent
            data-rainsee-part="button-icon"
            style={iconStyle}
            disabled={disabled}
            opacity={opacity}
            autoInvert={autoInvert}
          >
            {React.createElement(icon, {
              size,
              color: iconColor || 'currentColor',
              weight: iconWeight || 'regular',
            })}
          </IconComponent>
        )}
        {badge && (
          <Badge
            data-rainsee-part="button-badge"
            right={badgeRight}
            top={badgeTop}
            background={badgeBackground}
            color={badgeTextColor}
          >
            {badgeText}
          </Badge>
        )}
        {preloader && value > 0 && (
          <>
            <PreloaderBg></PreloaderBg>
            <Preloader
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%)`,
                pointerEvents: 'none',
              }}
              thickness={3}
              size={36}
              value={value}
            />
          </>
        )}
        {children}
      </Button>
    );
  },
);

(ToolbarButton as any).defaultProps = {
  size: 20,
  opacity: transparency.icons.active,
  autoInvert: true,
  badgeBackground: BLUE_500,
  badgeTextColor: 'white',
  badgeTop: 4,
  badgeRight: 4,
};
