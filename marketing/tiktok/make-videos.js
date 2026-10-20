// Génère les vidéos MP4 verticales (1080×1920, 30 i/s) à partir de videos.js.
// Prérequis : ffmpeg installé et le paquet « playwright » (npm i -D playwright).
// Usage : node marketing/tiktok/make-videos.js [nom-de-video]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const videos = require('./videos');

const FPS = 30;
const OUT = path.join(__dirname, 'out');

(async () => {
  const only = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(`file://${path.join(__dirname, 'video.html')}`);

  for (const v of videos.filter((x) => !only || x.file === only)) {
    const frames = fs.mkdtempSync(path.join(OUT, `.frames-${v.file}-`));
    await page.evaluate((s) => window.setup(s), v);
    const total = Math.round(v.duration * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.renderAt(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    const mp4 = path.join(OUT, `${v.file}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
      // piste audio silencieuse : TikTok accepte mieux les vidéos avec audio ; ajoutez un son tendance dans l'appli
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', mp4]);
    fs.rmSync(frames, { recursive: true, force: true });
    // Miniature (couverture) : l'image de l'accroche
    await page.evaluate(() => window.renderAt(1.2));
    await page.screenshot({ path: path.join(OUT, `${v.file}-couverture.jpg`), type: 'jpeg', quality: 90 });
    console.log(`✔ ${mp4}`);
  }
  await browser.close();
})();
