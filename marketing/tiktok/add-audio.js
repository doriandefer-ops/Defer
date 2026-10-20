// Ajoute la voix off (synthèse vocale espeak-ng + MBROLA fr1) et la musique originale aux vidéos de out/.
// Produit out/<nom>-voix-musique.mp4. Prérequis : espeak-ng, mbrola, mbrola-fr1, python3 + numpy, ffmpeg.
// Usage : node marketing/tiktok/add-audio.js [nom-de-video]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const videos = require('./videos');

const OUT = path.join(__dirname, 'out');
const VOICE = process.env.TTS_VOICE || 'mb-fr1';
const SPEED = process.env.TTS_SPEED || '160';

const duration = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

const only = process.argv[2];
for (const v of videos.filter((x) => !only || x.file === only)) {
  const tmp = fs.mkdtempSync(path.join(OUT, `.audio-${v.file}-`));
  const music = path.join(tmp, 'music.wav');
  execFileSync('python3', [path.join(__dirname, 'music.py'), music, String(v.duration)]);

  const inputs = ['-i', path.join(OUT, `${v.file}.mp4`), '-i', music];
  const filters = [];
  v.voice.forEach((seg, i) => {
    const wav = path.join(tmp, `v${i}.wav`);
    execFileSync('espeak-ng', ['-v', VOICE, '-s', SPEED, '-a', '50', '-w', wav, seg.text]);
    const d = duration(wav);
    const next = v.voice[i + 1]?.t ?? v.duration;
    if (seg.t + d > next) console.warn(`⚠ ${v.file} : la phrase ${i + 1} déborde de ${(seg.t + d - next).toFixed(2)} s`);
    inputs.push('-i', wav);
    const ms = Math.round(seg.t * 1000);
    filters.push(`[${i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
  });
  const n = v.voice.length;
  filters.push(
    `${v.voice.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0,` +
      // voix : on coupe les graves, on la rend plus présente et plus chaleureuse
      'volume=3,highpass=f=90,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,' +
      'aecho=0.8:0.5:40:0.12,asplit=2[voice][key]',
    // musique plus basse, et qui s'efface automatiquement quand la voix parle
    '[1:a]volume=0.18[mus]',
    '[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[ducked]',
    '[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[aout]',
  );
  const out = path.join(OUT, `${v.file}-voix-musique.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest',
    '-movflags', '+faststart', out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`✔ ${out}`);
}
