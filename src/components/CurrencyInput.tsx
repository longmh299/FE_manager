// src/components/CurrencyInput.tsx
import React from "react";

type Props = {
  value: number | null | undefined;           // số thực tế (raw number)
  onValueChange: (val: number) => void;       // trả ra raw number
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  min?: number;
  max?: number;
  allowNegative?: boolean;
  name?: string;
  id?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
};

function clamp(n: number, min?: number, max?: number) {
  if (typeof min === "number" && n < min) return min;
  if (typeof max === "number" && n > max) return max;
  return n;
}

function formatVnInt(n: number) {
  // Format kiểu vi-VN: 7.000.000 (dấu chấm)
  // Nếu bạn muốn DẤU PHẨY như ảnh bạn nói, dùng en-US: 7,000,000
  // => Mình để mặc định en-US theo yêu cầu "dấu ,"
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function parseDigits(input: string, allowNegative?: boolean) {
  const s = String(input ?? "");
  const hasMinus = allowNegative && s.trim().startsWith("-");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return hasMinus ? -n : n;
}

export const CurrencyInput: React.FC<Props> = ({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  inputClassName,
  min = 0,
  max,
  allowNegative = false,
  name,
  id,
  onBlur,
}) => {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;

  const [display, setDisplay] = React.useState<string>(() => formatVnInt(raw));

  React.useEffect(() => {
    // đồng bộ khi parent đổi value (load invoice, reset form...)
    setDisplay(formatVnInt(raw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return (
    <div className={className}>
      <input
        id={id}
        name={name}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        className={inputClassName}
        value={display}
        onChange={(e) => {
          const nextRaw = clamp(parseDigits(e.target.value, allowNegative), min, max);
          onValueChange(nextRaw);

          // Cập nhật display theo raw để luôn có dấu phẩy
          // (đơn giản, caret sẽ nhảy về cuối — thường ok cho nhập tiền)
          setDisplay(formatVnInt(nextRaw));
        }}
        onFocus={(e) => {
          // focus vẫn giữ format (dễ đọc, giảm sai)
          // nếu bạn muốn focus thì bỏ dấu phẩy để gõ nhanh, đổi thành: setDisplay(String(raw));
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          setDisplay(formatVnInt(raw));
          onBlur?.(e);
        }}
      />
    </div>
  );
};
