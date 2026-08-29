/**
 * ZoomableImage - 可缩放图片
 *
 * 点击放大到 lightbox，点击/Escape 关闭。
 */

import { useState, type ComponentProps } from "react";

export function ZoomableImage(props: ComponentProps<"img">) {
  const [zoomed, setZoomed] = useState(false);
  const { src, alt, ...rest } = props;

  return (
    <>
      <img
        {...rest}
        src={src}
        alt={alt}
        onClick={() => setZoomed(true)}
        className="max-w-full cursor-zoom-in rounded-lg my-2"
      />
      {zoomed && (
        <div
          onClick={() => setZoomed(false)}
          onKeyDown={(e) => e.key === "Escape" && setZoomed(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
          role="button"
          tabIndex={0}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
