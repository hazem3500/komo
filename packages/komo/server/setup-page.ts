export function setupPage() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up inline feedback</title><style>html{color-scheme:dark}body{margin:0;background:#111;color:#777;font:15px system-ui}main{height:100dvh;display:grid;place-items:center;background:#171717}h1{font-size:32px;letter-spacing:-1.5px;font-weight:500;color:#444}</style></head><body><main><h1>Inline feedback</h1></main><script type="module" src="/setup-client.js"></script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      },
    }
  );
}
