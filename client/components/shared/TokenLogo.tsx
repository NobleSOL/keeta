import { useState } from "react";

export function TokenLogo({ src, alt, size = 20 }: { src?: string; alt: string; size?: number }) {
  const [error, setError] = useState(false);
  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden rounded-full bg-muted"
      style={{ width: size, height: size }}
    >
      {!error && src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setError(true)}
        />
      ) : null}
    </span>
  );
}

export default TokenLogo;
