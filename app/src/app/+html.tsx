import { type PropsWithChildren } from 'react';

// Root HTML is used only by Expo Router's web static export.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script async src="https://stats.blackholeenglish.com/js/pa-Uf_rsZZCKOX--QPxFzZzI.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: 'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
