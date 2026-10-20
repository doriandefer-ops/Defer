"""Compose une musique de fond originale (libre de droits, générée ici) : boucle lo-fi entraînante à 100 BPM.
Usage : python3 marketing/tiktok/music.py sortie.wav [durée_en_secondes]
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 100
BEAT = 60 / BPM
rng = np.random.default_rng(7)  # graine fixe : même musique à chaque génération


def note(freq, dur, kind='pad'):
    t = np.arange(int(dur * SR)) / SR
    if kind == 'pad':  # nappe douce : sinus + légère harmonique, attaque/relâche lentes
        w = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t) + 0.08 * np.sin(2 * np.pi * 3.01 * freq * t)
        env = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.4)
    elif kind == 'pluck':  # pincé façon marimba
        w = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 4 * freq * t) * np.exp(-t * 18)
        env = np.exp(-t * 6)
    else:  # basse
        w = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
        env = np.minimum(1, t / 0.01) * np.exp(-t * 2.2)
    return w * env


def kick():
    t = np.arange(int(0.35 * SR)) / SR
    f = 120 * np.exp(-t * 22) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat():
    t = np.arange(int(0.06 * SR)) / SR
    n = rng.standard_normal(len(t))
    n = np.diff(n, prepend=0)  # passe-haut grossier
    return n * np.exp(-t * 70) * 0.25


def snap():
    t = np.arange(int(0.18 * SR)) / SR
    return rng.standard_normal(len(t)) * np.exp(-t * 28) * 0.35


def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i] * gain


def hz(n):  # n = numéro MIDI
    return 440 * 2 ** ((n - 69) / 12)


def compose(duration):
    buf = np.zeros(int((duration + 1) * SR))
    # La mineur – Fa – Do – Sol (Am F C G), une mesure de 4 temps par accord
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
    bass = [45, 41, 36, 43]
    arp = [[69, 72, 76, 72], [65, 69, 72, 69], [64, 67, 72, 67], [67, 71, 74, 71]]
    bar = 4 * BEAT
    t = 0.0
    k = 0
    while t < duration:
        c = k % 4
        for n in chords[c]:
            add(buf, note(hz(n), bar, 'pad'), t, 0.10)
        add(buf, note(hz(bass[c]), bar * 0.95, 'bass'), t, 0.32)
        for b in range(8):  # croches
            add(buf, note(hz(arp[c][b % 4]), 0.5, 'pluck'), t + b * BEAT / 2, 0.11)
            add(buf, hat(), t + b * BEAT / 2 + (0.02 if b % 2 else 0), 0.5 if b % 2 else 0.3)
        for b in range(4):
            if b in (0, 2) or (b == 3 and k % 2):
                add(buf, kick(), t + b * BEAT, 0.55)
            if b in (1, 3):
                add(buf, snap(), t + b * BEAT, 0.6)
        t += bar
        k += 1
    buf = buf[: int(duration * SR)]
    fade = int(0.8 * SR)
    buf[-fade:] *= np.linspace(1, 0, fade)
    buf[: int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))
    buf /= np.max(np.abs(buf)) * 1.12
    return buf


if __name__ == '__main__':
    out = sys.argv[1]
    dur = float(sys.argv[2]) if len(sys.argv) > 2 else 20
    data = (compose(dur) * 32767).astype(np.int16)
    stereo = np.column_stack([data, data]).ravel()
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())
