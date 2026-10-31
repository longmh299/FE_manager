// src/hooks/useIsMobile.ts
// ✅ true khi màn hình hẹp hơn 768px (điện thoại). Dùng cho các trang viết bằng style inline,
//    nơi không dùng được class md: của Tailwind.
import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 768) {
  const get = () => (typeof window === "undefined" ? false : window.innerWidth < breakpoint);
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const onResize = () => setMobile(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoint]);
  return mobile;
}

export default useIsMobile;
