import { APK_PATH, GRANT_TTL_MINUTES, JOIN_APP_PATH } from '@lustre/shared';
import { serverEnvironment } from '../../config.ts';

const APP_SCHEME = serverEnvironment === 'development' ? 'com.lustre.clinic.dev' : 'com.lustre.clinic';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Lustre role code</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f4f4f6; color: #111114; }
  main { max-width: 420px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { color: #3a3a40; line-height: 1.45; margin: 0 0 20px; }
  .step { background: #fff; border-radius: 18px; padding: 18px; margin-bottom: 14px; }
  .step h2 { font-size: 16px; margin: 0 0 6px; }
  .step p { font-size: 14px; margin: 0 0 14px; }
  a.button { display: block; text-align: center; padding: 15px; border-radius: 14px; font-weight: 600;
    text-decoration: none; background: #111114; color: #fff; }
  a.secondary { background: #f0f0f3; color: #111114; }
  .missing { display: none; }
</style>
</head>
<body>
<main>
  <h1>Lustre role code</h1>
  <p id="lead">This code gives this phone its role in the clinic's Lustre app. It works once, for ${GRANT_TTL_MINUTES} minutes.</p>
  <div id="steps">
    <div class="step">
      <h2>1. Don't have Lustre yet?</h2>
      <p>Download it and tap the file to install. Android may ask you to allow installs from your browser.</p>
      <a class="button secondary" href="${APK_PATH}">Download Lustre</a>
    </div>
    <div class="step">
      <h2>2. Open it with this code</h2>
      <p>Once Lustre is installed, come back here and tap below. Lustre asks before it uses the code.</p>
      <a class="button" id="open" href="#">Open in Lustre</a>
    </div>
  </div>
  <p class="missing" id="missing">This page is missing its code. Scan the QR code again.</p>
</main>
<script>
  var code = location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(code)) {
    document.getElementById('steps').style.display = 'none';
    document.getElementById('lead').style.display = 'none';
    document.getElementById('missing').style.display = 'block';
  } else {
    document.getElementById('open').href = '${APP_SCHEME}://${JOIN_APP_PATH}?code=' + encodeURIComponent(code)
      + '&server=' + encodeURIComponent(location.origin);
  }
</script>
</body>
</html>
`;

export function serveJoinPage(): Response {
    return new Response(PAGE, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
        },
    });
}
