// Live wallpapers: a moving picture behind tinted glass. Each one has its colours matched to
// its wallpaper (buttons, rims, glow, charts) and an entrance animation (components/ThemeIntro.tsx).
// Videos live in public/themes/: 15-second muted loops, 1080p, ~2–8 MB.
import type { ThemeDefinition } from './types'

export const LIVE_IDS = ['gta', 'space', 'arcade'] as const
export type LiveId = typeof LIVE_IDS[number]
export const isLive = (id?: string | null): id is LiveId => !!id && (LIVE_IDS as readonly string[]).includes(id)

export const LIVE_THEMES: ThemeDefinition[] = [
  { id: 'gta', name: 'GTA', family: 'live', scheme: 'dark', bestFor: ['lcd', 'oled'],
    description: 'Vice-coloured neon: a 15-second city loop under pink and sunset-orange glass.',
    palette: { base: '#0A0612', a: '#FF5FA8', b: '#FFB04A', c: '#8F6BFF',
      ink: '#FFF4FA', ink2: 'rgb(255 244 250 / .7)', ink3: 'rgb(255 244 250 / .48)',
      glass: 'rgb(24 10 32 / .4)', glassHi: 'rgb(44 16 56 / .52)', glassSolid: 'rgb(18 8 26 / .9)',
      rim: 'rgb(255 150 205 / .22)', rimTop: 'rgb(255 195 230 / .4)', rimBottom: 'rgb(255 255 255 / .05)',
      shadow: '0 30px 60px -30px rgb(20 0 30 / .85)', onAccent: '#1A0612' },
    backdrop: { kind: 'video', src: '/themes/gta.mp4', poster: '/themes/gta.jpg',
      tint: 'linear-gradient(90deg, rgb(12 4 22 / .6) 0%, rgb(12 4 22 / .2) 55%, transparent 80%), linear-gradient(180deg, rgb(12 4 22 / .4) 0%, rgb(12 4 22 / .15) 40%, rgb(30 6 30 / .55) 100%)' },
    status: { P1: '#FF4D6D', P2: '#FFB04A', P3: '#FF5FA8', P4: '#6ED6FF' },
    chart: { series: ['#E0458F', '#D98A1F'] } },

  { id: 'space', name: 'Space', family: 'live', scheme: 'dark', bestFor: ['oled', 'night'],
    description: 'A black hole turning slowly in the dark, its gold light caught in smoked glass.',
    palette: { base: '#050404', a: '#FFB866', b: '#FF7A3D', c: '#B9C8FF',
      ink: '#FBF4EA', ink2: 'rgb(251 244 234 / .68)', ink3: 'rgb(251 244 234 / .46)',
      glass: 'rgb(14 10 8 / .36)', glassHi: 'rgb(32 24 18 / .5)', glassSolid: 'rgb(12 9 7 / .9)',
      rim: 'rgb(255 210 160 / .16)', rimTop: 'rgb(255 228 196 / .34)', rimBottom: 'rgb(255 255 255 / .04)',
      shadow: '0 30px 60px -30px rgb(0 0 0 / .9)', onAccent: '#1A0E04' },
    backdrop: { kind: 'video', src: '/themes/space.mp4', poster: '/themes/space.jpg',
      tint: 'linear-gradient(180deg, rgb(0 0 0 / .25) 0%, rgb(0 0 0 / .1) 45%, rgb(5 3 2 / .6) 100%)' },
    status: { P1: '#FF5A4E', P2: '#FFB866', P3: '#B9C8FF', P4: '#7FD6C2' },
    chart: { series: ['#D9892E', '#5C86D6'] } },

  { id: 'arcade', name: 'Arcade', family: 'live', scheme: 'dark', bestFor: ['lcd', 'night'],
    description: 'Retro arcade: a pixel sunset over a neon grid, scanlines and chunky cyan and magenta glass.',
    palette: { base: '#07021A', a: '#00E5FF', b: '#FF2BD6', c: '#FFE600',
      ink: '#F2F7FF', ink2: 'rgb(242 247 255 / .7)', ink3: 'rgb(242 247 255 / .48)',
      glass: 'rgb(12 4 38 / .5)', glassHi: 'rgb(26 10 66 / .6)', glassSolid: 'rgb(10 4 30 / .93)',
      rim: 'rgb(0 229 255 / .28)', rimTop: 'rgb(130 245 255 / .5)', rimBottom: 'rgb(255 43 214 / .22)',
      shadow: '0 24px 50px -26px rgb(0 0 0 / .9)', onAccent: '#06021A' },
    backdrop: { kind: 'arcade' },
    surfaces: { radius: 14, rimWidth: 1.5, blur: 14 },
    status: { P1: '#FF3B6B', P2: '#FFE600', P3: '#00E5FF', P4: '#5CFF8A' },
    chart: { series: ['#1AA7C4', '#D0329F'] } },
]
