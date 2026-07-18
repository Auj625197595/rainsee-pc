import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { StyledSmallDialog, Label, ActionButton } from './style';

type ClickEvent = (e: React.MouseEvent<HTMLDivElement>) => void;

export const SelectionDialog = observer(
  ({
    amount,
    visible,
    onDeleteClick,
    onCancelClick,
    onSelectAllClick,
    selectAllLabel = '全选',
  }: {
    amount: number;
    visible: boolean;
    onDeleteClick: ClickEvent;
    onCancelClick: ClickEvent;
    onSelectAllClick?: ClickEvent;
    selectAllLabel?: string;
    theme?: any;
  }) => {
    return (
      <StyledSmallDialog visible={visible}>
        <Label>
          已选中 <b>{amount}</b> 项
        </Label>
        {onSelectAllClick && (
          <ActionButton variant="ghost" onClick={onSelectAllClick}>
            {selectAllLabel}
          </ActionButton>
        )}
        <ActionButton variant="danger" onClick={onDeleteClick}>
          删除
        </ActionButton>
        <ActionButton variant="ghost" onClick={onCancelClick}>
          取消
        </ActionButton>
      </StyledSmallDialog>
    );
  },
);
