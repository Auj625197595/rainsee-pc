import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { useI18n } from '~/renderer/components/I18n';
import { StyledSmallDialog, Label, ActionButton } from './style';

type ClickEvent = (e: React.MouseEvent<HTMLDivElement>) => void;

export const SelectionDialog = observer(
  ({
    amount,
    visible,
    onDeleteClick,
    onCancelClick,
    onSelectAllClick,
    onMoveClick,
    onPinClick,
    selectAllLabel,
  }: {
    amount: number;
    visible: boolean;
    onDeleteClick: ClickEvent;
    onCancelClick: ClickEvent;
    onSelectAllClick?: ClickEvent;
    onMoveClick?: ClickEvent;
    onPinClick?: ClickEvent;
    selectAllLabel?: string;
    theme?: any;
  }) => {
    const t = useI18n();
    return (
      <StyledSmallDialog visible={visible}>
        <Label>
          {t('sdSelectedN', {count: amount})}
        </Label>
        {onSelectAllClick && (
          <ActionButton variant="ghost" onClick={onSelectAllClick}>
            {selectAllLabel ?? t('selectAll')}
          </ActionButton>
        )}
        {onMoveClick && (
          <ActionButton variant="primary" onClick={onMoveClick}>
            {t('moveAction')}
          </ActionButton>
        )}
        {onPinClick && (
          <ActionButton variant="ghost" onClick={onPinClick}>
            {t('sdPinToTop')}
          </ActionButton>
        )}
        <ActionButton variant="danger" onClick={onDeleteClick}>
          {t('delete')}
        </ActionButton>
        <ActionButton variant="ghost" onClick={onCancelClick}>
          {t('cancel')}
        </ActionButton>
      </StyledSmallDialog>
    );
  },
);
