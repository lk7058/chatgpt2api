"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ImageThumbnailProps = {
  src: string;
  thumbnailSrc?: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
};

export function getImageThumbnailUrl(src: string) {
  const marker = "/images/";
  const index = src.indexOf(marker);
  if (index < 0) return src;
  return `${src.slice(0, index)}/image-thumbnails/${src.slice(index + marker.length)}`;
}

export function ImageThumbnail({ src, thumbnailSrc, alt = "", className, imageClassName }: ImageThumbnailProps) {
  const initialSrc = useMemo(() => thumbnailSrc || getImageThumbnailUrl(src), [src, thumbnailSrc]);
  const [currentSrc, setCurrentSrc] = useState(initialSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(initialSrc);
    setFailed(false);
  }, [initialSrc]);

  if (failed) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-stone-100 text-center text-[10px] leading-3 text-stone-400",
          className,
        )}
      >
        缓存已清理
      </span>
    );
  }

  return (
    <span className={cn("block overflow-hidden bg-stone-100", className)}>
      <img
        src={currentSrc}
        alt={alt}
        className={cn("h-full w-full object-cover", imageClassName)}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (currentSrc !== src) {
            setCurrentSrc(src);
          } else {
            // 缩略图与原图都加载失败：缓存已被清理
            setFailed(true);
          }
        }}
      />
    </span>
  );
}
