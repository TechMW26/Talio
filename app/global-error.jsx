"use client";

import NextError from "next/error";

export default function GlobalError() {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark', background: '#09090b' }}>
      <body style={{ margin: 0, background: '#09090b', color: '#f4f4f5' }}>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
