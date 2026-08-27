import { useRef, ChangeEvent, FocusEvent, forwardRef, Ref } from 'react';
import * as React from 'react';
import {Input} from "./style";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
}

export const MyInput = forwardRef((props: InputProps, ref: Ref<HTMLInputElement>) => {
  const el = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const skipChangeValue = useRef<string | null>(null);
  const { onChange, onFocus, onBlur, value, defaultValue, ...attrs } = props;
  const _value = 'value' in props ? value : 'defaultValue' in props ? defaultValue : null;
  const latestValue = useRef(value);
  latestValue.current = value;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (onChange) {
      onChange(e);
    }
  };

  const forceSetValue = () => {
    if ('value' in props && el.current && !composing.current) {
      const input = el.current;
      const nextValue = String(latestValue.current == null ? '' : latestValue.current);

      // Reassigning value also moves the caret. Only synchronize an actual
      // external change, and never replace Chromium's active IME buffer.
      if (input.value !== nextValue) {
        input.value = nextValue;
      }
      input.setAttribute('value', nextValue);
    }
  };

  return (
    <Input
      {...attrs}
      defaultValue={_value}
      ref={(input) => {
        el.current = input;
        if (ref) {
          if (typeof ref === 'function') {
            ref(input);
          } else {
            ref.current = input;
          }
        }
        if (!input) {
          return;
        }
        forceSetValue();
      }}
      onFocus={(e) => {
        setTimeout(forceSetValue, 10);
        onFocus && onFocus(e);
      }}
      onBlur={(e) => {
        setTimeout(forceSetValue, 150);
        onBlur && onBlur(e);
      }}
      onCompositionStart={() => {
        composing.current = true;
        skipChangeValue.current = null;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        skipChangeValue.current = e.currentTarget.value;
        handleChange(e);
      }}
      onChange={(e) => {
        if (composing.current) return;

        // Chromium may emit the final change immediately after
        // compositionend. The value was already forwarded above.
        if (skipChangeValue.current === e.currentTarget.value) {
          skipChangeValue.current = null;
          return;
        }

        skipChangeValue.current = null;
        handleChange(e);
      }}
    />
  );
});

export default MyInput;
