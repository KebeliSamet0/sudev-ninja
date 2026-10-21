(() => {
  'use strict';

  // ==========================================
  // 1. DOM ELEMANLARI VE DURUM DEĞİŞKENLERİ
  // ==========================================
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const videoElement = document.getElementById('webcam-raw');

  const camStatusDot = document.getElementById('cam-status-dot');
  const camStatusText = document.getElementById('cam-status-text');

  const startScreen = document.getElementById('start-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownNumber = document.getElementById('countdown-number');

  const startForm = document.getElementById('start-form');
  const instagramInput = document.getElementById('instagram-input');
  const newPlayerBtn = document.getElementById('new-player-btn');

  const hudPlayer = document.getElementById('hud-player');
  const hudScore = document.getElementById('hud-score');
  const hudTimer = document.getElementById('hud-timer');
  const timerCard = document.getElementById('timer-card');

  const finalScoreEl = document.getElementById('final-score');
  const finalPlayerEl = document.getElementById('final-player');

  const STORAGE_KEY = 'sudev_fruit_ninja_scores_v2';
  try { localStorage.removeItem('sudev_fruit_ninja_scores_v1'); } catch (_) {}
  const BG_EXCEL_API = 'http://127.0.0.1:3000/api/scores';
  const ROUND_DURATION = 30.0; // 30 saniye

  let width = window.innerWidth;
  let height = window.innerHeight;
  let cameraReady = false;

  // Oyun durumu: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'GAMEOVER'
  let gameState = 'LOBBY';
  let currentPlayer = '@misafir';
  let score = 0;
  let timeLeft = ROUND_DURATION;
  let slicedCount = 0;
  let bombsHit = 0;
  let maxCombo = 1;
  let lastFrameTime = performance.now();
  let spawnTimer = 0;
  let screenShake = 0;
  let bombFlashAlpha = 0;

  // Parmak / Kesim İzi (Tek Parmak - İşaret Parmağı)
  const pointer = {
    x: width / 2,
    y: height / 2,
    targetX: width / 2,
    targetY: height / 2,
    prevX: width / 2,
    prevY: height / 2,
    active: false,
    source: 'NONE', // 'HAND' | 'MOUSE'
    lastSeenTime: 0
  };

  // Bıçak izi noktaları
  const bladeTrail = [];
  const MAX_TRAIL_POINTS = 18;

  // Kombo penceresi (aynı savuruşta kesilen meyveler)
  let currentSwipeSlices = 0;
  let swipeResetTimer = 0;

  // Sahne nesneleri
  const fruits = [];
  const fruitHalves = [];
  const particles = [];
  const splatters = [];
  const floatingTexts = [];

  // ==========================================
  // 2. EKRAN BOYUTLANDIRMA
  // ==========================================
  function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ==========================================
  // 3. WEB AUDIO API SES EFEKTLERİ
  // ==========================================
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSliceSound(pitchMultiplier = 1) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320 * pitchMultiplier, now);
    osc.frequency.exponentialRampToValueAtTime(880 * pitchMultiplier, now + 0.09);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  function playComboSound(comboCount) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.slice(0, Math.min(4, comboCount)).forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.045);
      gain.gain.setValueAtTime(0.16, now + idx * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.045);
      osc.stop(now + idx * 0.045 + 0.18);
    });
  }

  function playBombSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.38);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  function playBeep(freq = 440, duration = 0.12) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  // ==========================================
  // 4. ARKA PLANDA OTOMATİK EXCEL (puanlar.xlsx) KAYIT SİSTEMİ
  // ==========================================
  function getSavedScores() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveScoresToStorage(scores) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    } catch (e) {
      console.error('LocalStorage kayıt hatası:', e);
    }
  }

  // Arka plandaki puanlar.xlsx listesinden mevcut kayıtları yükle
  async function syncFromBackgroundExcel() {
    try {
      const res = await fetch(BG_EXCEL_API);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.scores)) {
          saveScoresToStorage(data.scores);
        }
      }
    } catch (_) {}
  }

  // Yeni skoru arka planda puanlar.xlsx dosyasına alt alta ekle
  async function appendScoreToBackgroundExcel(entry) {
    try {
      const res = await fetch(BG_EXCEL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.scores)) {
          saveScoresToStorage(data.scores);
        }
        return true;
      }
    } catch (_) {}
    return false;
  }

  syncFromBackgroundExcel();

  // ==========================================
  // 5. MEDIAPIPE EL VE TEK PARMAK TAKİBİ (İŞARET PARMAĞI UCU)
  // ==========================================
  function initHandTracking() {
    if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
      camStatusText.textContent = 'FARE / DOKUNMATİK AKTİF';
      return;
    }

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });

    hands.onResults(onHandResults);

    const camera = new Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 640,
      height: 480
    });

    camera.start()
      .then(() => {
        cameraReady = true;
        camStatusDot.classList.add('ready');
        camStatusText.textContent = 'KAMERA AKTİF';
      })
      .catch((err) => {
        console.warn('Kamera açılamadı, fare/dokunmatik moduna geçildi:', err);
        camStatusText.textContent = 'FARE MODU';
      });
  }

  function onHandResults(results) {
    const now = performance.now();
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      // Landmark 8 = İşaret parmağı ucu (INDEX_FINGER_TIP)
      let indexTip = landmarks[8];
      const dip = landmarks[7];
      const pip = landmarks[6];
      const thumbTip = landmarks[4];

      // Eğer MediaPipe uç noktayı (8) baş parmak ucunun (4) üstüne yapıştırdıysa,
      // işaret parmağının kendi boğum doğrultusunu (6 -> 7) kullan
      if (indexTip && dip && pip && thumbTip) {
        const distToThumb = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const distDipToThumb = Math.hypot(dip.x - thumbTip.x, dip.y - thumbTip.y);
        if (distToThumb < 0.045 && distToThumb < distDipToThumb * 0.75) {
          indexTip = {
            x: dip.x + (dip.x - pip.x) * 0.8,
            y: dip.y + (dip.y - pip.y) * 0.8
          };
        }
      }

      // Ana ekran koordinatlarını güncelle (Aynalanmış X: 1 - x)
      // Kenarlarda rahat ulaşım için %8 marj ölçeklemesi
      const normX = Math.min(1, Math.max(0, ((1 - indexTip.x) - 0.06) / 0.88));
      const normY = Math.min(1, Math.max(0, (indexTip.y - 0.06) / 0.88));

      const newTargetX = normX * width;
      const newTargetY = normY * height;

      const wasInactive = !pointer.active || pointer.source !== 'HAND' || (now - pointer.lastSeenTime > 200);
      pointer.targetX = newTargetX;
      pointer.targetY = newTargetY;

      if (wasInactive) {
        pointer.x = newTargetX;
        pointer.y = newTargetY;
        pointer.prevX = newTargetX;
        pointer.prevY = newTargetY;
        bladeTrail.length = 0;
      }
      pointer.active = true;
      pointer.source = 'HAND';
      pointer.lastSeenTime = now;
    } else {
      if (pointer.source === 'HAND' && now - pointer.lastSeenTime > 200) {
        pointer.active = false;
        bladeTrail.length = 0;
      }
    }
  }

  // Fare / Dokunmatik Yedek Desteği (Kamera yoksa veya test ederken)
  window.addEventListener('pointermove', (e) => {
    if (pointer.source === 'HAND' && performance.now() - pointer.lastSeenTime < 400) {
      return; // Kamera aktifken el öncelikli
    }
    pointer.targetX = e.clientX;
    pointer.targetY = e.clientY;
    pointer.active = true;
    pointer.source = 'MOUSE';
    pointer.lastSeenTime = performance.now();
  });

  // ==========================================
  // 6. MEYVE TÜRLERİ VE BOMBA TANIMLARI
  // ==========================================
  const FRUIT_TYPES = [
    {
      id: 'watermelon',
      name: 'Karpuz',
      points: 10,
      radius: 48,
      lightColor: '#66BB6A',
      outerColor: '#2E7D32',
      darkColor: '#0D3B10',
      rindColor: '#C8E6C9',
      innerColor: '#FF5252',
      innerDark: '#B71C1C',
      juiceColor: '#E53935',
      seedColor: '#16181A'
    },
    {
      id: 'orange',
      name: 'Portakal',
      points: 10,
      radius: 40,
      lightColor: '#FFCC80',
      outerColor: '#FB8C00',
      darkColor: '#BF360C',
      rindColor: '#FFF3E0',
      innerColor: '#FFA726',
      innerDark: '#E65100',
      juiceColor: '#FB8C00',
      seedColor: '#FFFFFF'
    },
    {
      id: 'apple',
      name: 'Elma',
      points: 10,
      radius: 39,
      lightColor: '#FF8A80',
      outerColor: '#E53935',
      darkColor: '#7F0000',
      rindColor: '#FFF9C4',
      innerColor: '#FFFDE7',
      innerDark: '#FBC02D',
      juiceColor: '#EF5350',
      seedColor: '#4E342E'
    },
    {
      id: 'banana',
      name: 'Muz',
      points: 10,
      radius: 42,
      lightColor: '#FFFF8D',
      outerColor: '#FDD835',
      darkColor: '#C68400',
      rindColor: '#FFF9C4',
      innerColor: '#FFFDE7',
      innerDark: '#F9A825',
      juiceColor: '#FBC02D',
      seedColor: '#8D6E63'
    },
    {
      id: 'strawberry',
      name: 'Çilek',
      points: 15,
      radius: 36,
      lightColor: '#FF8A80',
      outerColor: '#D32F2F',
      darkColor: '#6A0000',
      rindColor: '#FFCDD2',
      innerColor: '#FF5252',
      innerDark: '#B71C1C',
      juiceColor: '#D32F2F',
      seedColor: '#FFEE58'
    },
    {
      id: 'pineapple',
      name: 'Ananas',
      points: 25,
      radius: 50,
      lightColor: '#FFE082',
      outerColor: '#F57F17',
      darkColor: '#6D3600',
      rindColor: '#FFF59D',
      innerColor: '#FFEE58',
      innerDark: '#F57F17',
      juiceColor: '#FBC02D',
      seedColor: '#8F3D0C'
    }
  ];

  // ==========================================
  // 6.5 THREE.JS 3D WEBGL SAHNE VE MODELLEME MOTORU
  // ==========================================
  let threeScene = null;
  let threeCamera = null;
  let threeRenderer = null;
  let threeReady = false;
  const threePrototypes = {
    whole: {},
    halfTop: {},
    halfBottom: {},
    bomb: null
  };

  function createSkinCanvasTexture(id) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');

    if (id === 'watermelon') {
      g.fillStyle = '#2E7D32';
      g.fillRect(0, 0, 256, 256);
      // Dalgalı koyu ve açık yeşil boylam şeritleri
      for (let s = 0; s < 10; s++) {
        const baseX = (s / 10) * 256;
        g.fillStyle = s % 2 === 0 ? '#0D3B10' : '#43A047';
        g.beginPath();
        g.moveTo(baseX, 0);
        for (let y = 0; y <= 256; y += 16) {
          const wave = Math.sin(y * 0.08 + s) * 6;
          g.lineTo(baseX + wave, y);
        }
        for (let y = 256; y >= 0; y -= 16) {
          const wave = Math.sin(y * 0.08 + s + 1) * 6;
          g.lineTo(baseX + 12 + wave, y);
        }
        g.closePath();
        g.fill();
      }
    } else if (id === 'orange') {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#FFA726');
      grad.addColorStop(0.5, '#FB8C00');
      grad.addColorStop(1, '#E65100');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      // Gözenekli narenciye kabuğu dokusu
      for (let i = 0; i < 420; i++) {
        const px = Math.random() * 256;
        const py = Math.random() * 256;
        g.fillStyle = i % 2 === 0 ? 'rgba(191,54,12,0.35)' : 'rgba(255,224,130,0.32)';
        g.beginPath();
        g.arc(px, py, 1.8 + Math.random() * 1.5, 0, Math.PI * 2);
        g.fill();
      }
    } else if (id === 'apple') {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#C62828');
      grad.addColorStop(0.5, '#E53935');
      grad.addColorStop(1, '#8E0000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      // Doğal elma alacası ve dikey fırça izleri
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = i % 4 === 0 ? 'rgba(255,213,79,0.22)' : 'rgba(183,28,28,0.28)';
        g.lineWidth = 2 + Math.random() * 3;
        const x = Math.random() * 256;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + (Math.random() - 0.5) * 14, 256);
        g.stroke();
      }
    } else if (id === 'banana') {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#689F38');
      grad.addColorStop(0.12, '#FDD835');
      grad.addColorStop(0.88, '#FBC02D');
      grad.addColorStop(1, '#4E342E');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    } else if (id === 'strawberry') {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#EF5350');
      grad.addColorStop(0.45, '#D32F2F');
      grad.addColorStop(1, '#7F0000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      // Çilek tohum çukurları
      for (let y = 24; y < 236; y += 26) {
        for (let x = 16; x < 246; x += 28) {
          const ox = x + ((y / 26) % 2) * 14;
          g.fillStyle = 'rgba(60,0,0,0.55)';
          g.beginPath();
          g.ellipse(ox, y, 4, 6, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#FFEE58';
          g.beginPath();
          g.ellipse(ox, y - 1, 2.3, 3.8, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (id === 'pineapple') {
      g.fillStyle = '#F57F17';
      g.fillRect(0, 0, 256, 256);
      const step = 32;
      g.strokeStyle = '#5D2906';
      g.lineWidth = 4;
      for (let d = -256; d <= 512; d += step) {
        g.beginPath();
        g.moveTo(d, 0);
        g.lineTo(d + 256, 256);
        g.moveTo(d + 256, 0);
        g.lineTo(d, 256);
        g.stroke();
      }
      for (let y = step / 2; y < 256; y += step / 2) {
        for (let x = step / 2; x < 256; x += step) {
          const ox = x + ((y / (step / 2)) % 2) * (step / 2);
          g.fillStyle = '#FFF176';
          g.beginPath();
          g.arc(ox % 256, y, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  function createCutFaceCanvasTexture(type) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    const cx = 128;
    const cy = 128;
    const r = 124;

    // Dış kabuk çemberi
    g.fillStyle = type.outerColor;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();

    // Beyaz/açık iç kabuk (Rind)
    g.fillStyle = type.rindColor;
    g.beginPath();
    g.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
    g.fill();

    // Sulu iç et dokusu
    const rad = g.createRadialGradient(cx, cy, r * 0.08, cx, cy, r * 0.80);
    rad.addColorStop(0, type.innerColor);
    rad.addColorStop(0.75, type.innerColor);
    rad.addColorStop(1, type.innerDark);
    g.fillStyle = rad;
    g.beginPath();
    g.arc(cx, cy, r * 0.80, 0, Math.PI * 2);
    g.fill();

    if (type.id === 'orange') {
      g.strokeStyle = type.rindColor;
      g.lineWidth = 5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
        g.stroke();
      }
      g.fillStyle = type.rindColor;
      g.beginPath();
      g.arc(cx, cy, 12, 0, Math.PI * 2);
      g.fill();
    } else if (type.id === 'watermelon') {
      g.fillStyle = '#16181A';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const dist = (i % 2 === 0 ? 0.48 : 0.62) * r;
        const sx = cx + Math.cos(a) * dist;
        const sy = cy + Math.sin(a) * dist;
        g.save();
        g.translate(sx, sy);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, 6.5, 3.8, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    } else if (type.id === 'apple') {
      g.strokeStyle = '#FBC02D';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#4E342E';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.save();
        g.translate(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    } else if (type.id === 'pineapple') {
      g.fillStyle = '#FFF9C4';
      g.beginPath();
      g.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(143, 61, 12, 0.35)';
      g.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.28);
        g.lineTo(cx + Math.cos(a) * r * 0.76, cy + Math.sin(a) * r * 0.76);
        g.stroke();
      }
    } else if (type.id === 'strawberry') {
      g.fillStyle = '#FFCDD2';
      g.beginPath();
      g.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
      g.fill();
    }

    return new THREE.CanvasTexture(c);
  }

  function sculptSphereGeometry(radius, widthSegs, heightSegs, modifierFn) {
    const geom = new THREE.SphereGeometry(radius, widthSegs, heightSegs);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const [nx, ny, nz] = modifierFn(vx, vy, vz, radius);
      pos.setXYZ(i, nx, ny, nz);
    }
    geom.computeVertexNormals();
    return geom;
  }

  function create3DCrownOrStem(type, r) {
    const group = new THREE.Group();
    const stemMat = new THREE.MeshPhongMaterial({
      color: 0x4E342E,
      specular: 0x1A120F,
      shininess: 8
    });
    const leafMat = new THREE.MeshPhongMaterial({
      color: 0x2E7D32,
      emissive: 0x051406,
      specular: 0x223824,
      shininess: 14,
      side: THREE.DoubleSide
    });

    if (type.id === 'pineapple') {
      // 3D çok katmanlı sivri ananas yaprak tacı
      for (let ring = 0; ring < 3; ring++) {
        const count = ring === 0 ? 6 : ring === 1 ? 5 : 3;
        const h = r * (0.62 + ring * 0.16);
        const tilt = 0.58 - ring * 0.22;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + ring * 0.5;
          const leafGeom = new THREE.ConeGeometry(r * 0.22, h, 4);
          leafGeom.scale(1, 1, 0.25);
          leafGeom.translate(0, h * 0.45, 0);
          const leaf = new THREE.Mesh(leafGeom, leafMat);
          leaf.position.set(0, r * 0.92, 0);
          leaf.rotation.y = angle;
          leaf.rotation.x = tilt;
          group.add(leaf);
        }
      }
      return group;
    }

    if (type.id === 'strawberry') {
      // Çilek 3D yıldız yaprak tacı + sap
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const petalGeom = new THREE.ConeGeometry(r * 0.22, r * 0.55, 4);
        petalGeom.scale(1, 1, 0.2);
        petalGeom.translate(0, r * 0.24, 0);
        const petal = new THREE.Mesh(petalGeom, leafMat);
        petal.position.set(0, r * 0.88, 0);
        petal.rotation.y = a;
        petal.rotation.z = Math.PI * 0.38;
        group.add(petal);
      }
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 12, 8), leafMat);
      stem.position.set(0, r * 0.98, 0);
      group.add(stem);
      return group;
    }

    // Elma, Portakal, Karpuz için 3D Sap ve Yaprak
    const stemGeom = new THREE.CylinderGeometry(2.2, 3.6, 15, 10);
    const stem = new THREE.Mesh(stemGeom, stemMat);
    stem.position.set(0, r * 0.95, 0);
    stem.rotation.z = -0.22;
    group.add(stem);

    if (type.id !== 'watermelon') {
      const leafGeom = new THREE.SphereGeometry(r * 0.28, 12, 8);
      leafGeom.scale(1.3, 0.22, 0.65);
      const leaf = new THREE.Mesh(leafGeom, leafMat);
      leaf.position.set(r * 0.25, r * 1.02, 0);
      leaf.rotation.z = 0.35;
      group.add(leaf);
    }

    return group;
  }

  function createBanana3DMesh(type, halfMode = 0) {
    const group = new THREE.Group();
    const r = type.radius;
    const skinTex = createSkinCanvasTexture('banana');
    const skinMat = new THREE.MeshPhongMaterial({
      map: skinTex,
      specular: 0x332B14,
      shininess: 12,
      flatShading: true
    });

    // 3D Kıvrımlı Muz Eğrisi
    const startT = halfMode === 1 ? 0.5 : 0.0;
    const endT = halfMode === -1 ? 0.5 : 1.0;
    const fullCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-r * 0.55, -r * 0.85, 0),
      new THREE.Vector3(r * 0.62, 0, r * 0.12),
      new THREE.Vector3(-r * 0.48, r * 0.90, 0)
    );

    const points = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = startT + (endT - startT) * (i / steps);
      points.push(fullCurve.getPoint(t));
    }
    const subCurve = new THREE.CatmullRomCurve3(points);
    const tubeGeom = new THREE.TubeGeometry(subCurve, 20, r * 0.33, 7, false);

    // Muz uçlarını incelt (Tapering)
    const pos = tubeGeom.attributes.position;
    const ringVerts = 8; // radialSegments (7) + 1
    const rings = 21;
    for (let ring = 0; ring < rings; ring++) {
      const localRatio = ring / (rings - 1);
      const globalT = startT + (endT - startT) * localRatio;
      const center = subCurve.getPoint(localRatio);
      // Uçlarda 0.22'ye inen, ortada 1.05 olan parabolik kalınlık
      const taper = Math.max(0.2, Math.sin(globalT * Math.PI) * 1.02);
      for (let j = 0; j < ringVerts; j++) {
        const idx = ring * ringVerts + j;
        const vx = pos.getX(idx);
        const vy = pos.getY(idx);
        const vz = pos.getZ(idx);
        pos.setXYZ(
          idx,
          center.x + (vx - center.x) * taper,
          center.y + (vy - center.y) * taper,
          center.z + (vz - center.z) * taper
        );
      }
    }
    tubeGeom.computeVertexNormals();
    const bananaMesh = new THREE.Mesh(tubeGeom, skinMat);
    group.add(bananaMesh);

    // Eğer kesilmişse kesit kapağı ekle
    if (halfMode !== 0) {
      const cutTex = createCutFaceCanvasTexture(type);
      const capMat = new THREE.MeshPhongMaterial({
        map: cutTex,
        specular: 0x2A261C,
        shininess: 18,
        side: THREE.DoubleSide
      });
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.33, 16), capMat);
      const cutCenter = fullCurve.getPoint(0.5);
      cap.position.copy(cutCenter);
      cap.rotation.x = Math.PI / 2;
      group.add(cap);
    }

    return group;
  }

  function initThreeJS() {
    if (typeof THREE === 'undefined') return;
    try {
      threeScene = new THREE.Scene();
      threeCamera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
      threeCamera.position.set(0, 0, 500);
      threeCamera.lookAt(0, 0, 0);

      threeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      threeRenderer.setSize(width, height);
      threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      // Doğal ve Dengeli 3D Işıklandırma (Aşırı parlamayı önleyen yumuşak stüdyo ışığı)
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.56);
      threeScene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xfff8ee, 0.78);
      keyLight.position.set(-350, 520, 620);
      threeScene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x90caf9, 0.25);
      rimLight.position.set(450, -350, -350);
      threeScene.add(rimLight);

      const bounceLight = new THREE.DirectionalLight(0xe97e2d, 0.18);
      bounceLight.position.set(0, -500, 300);
      threeScene.add(bounceLight);

      // Tüm meyveler ve bomba için 3D prototip modelleri oluştur
      FRUIT_TYPES.forEach((type) => {
        if (type.id === 'banana') {
          threePrototypes.whole[type.id] = createBanana3DMesh(type, 0);
          threePrototypes.halfTop[type.id] = createBanana3DMesh(type, -1);
          threePrototypes.halfBottom[type.id] = createBanana3DMesh(type, 1);
          return;
        }

        const r = type.radius;
        const skinTex = createSkinCanvasTexture(type.id);
        const cutTex = createCutFaceCanvasTexture(type);

        // Meyve türüne göre doğal mat/yarı-mat yüzey yansıması
        const specColorMap = {
          pineapple: 0x241B0B,
          orange: 0x332211,
          strawberry: 0x331818,
          watermelon: 0x263326,
          apple: 0x3A2828
        };
        const shininessMap = {
          pineapple: 8,
          orange: 14,
          strawberry: 16,
          watermelon: 22,
          apple: 26
        };

        const skinMat = new THREE.MeshPhongMaterial({
          map: skinTex,
          bumpMap: (type.id === 'orange' || type.id === 'pineapple' || type.id === 'strawberry') ? skinTex : null,
          bumpScale: type.id === 'pineapple' ? 2.4 : 1.2,
          specular: specColorMap[type.id] || 0x2A2A2A,
          shininess: shininessMap[type.id] || 16
        });

        const cutMat = new THREE.MeshPhongMaterial({
          map: cutTex,
          specular: 0x2E2E2E,
          shininess: 22,
          side: THREE.DoubleSide
        });

        // Meyveye Özel 3D Geometri Heykellemesi
        let bodyGeom;
        if (type.id === 'apple') {
          // Elma: üst ve alt kutuplarda gerçek 3D çukur + geniş üst omuzlar
          bodyGeom = sculptSphereGeometry(r, 32, 24, (vx, vy, vz, rad) => {
            const ny = vy / rad;
            const rHoriz = Math.hypot(vx, vz) / rad;
            const pit = Math.exp(-rHoriz * rHoriz * 9) * 0.24 * rad;
            const shoulder = ny > 0 ? 1 + 0.08 * Math.sin(ny * Math.PI) : 1 - 0.10 * Math.abs(ny);
            const yNew = vy - Math.sign(ny) * pit;
            return [vx * shoulder, yNew, vz * shoulder];
          });
        } else if (type.id === 'strawberry') {
          // Çilek: üstü dolgun, altı konik-kalp 3D çilek formu
          bodyGeom = sculptSphereGeometry(r, 28, 22, (vx, vy, vz, rad) => {
            const ny = vy / rad; // -1 (alt) .. +1 (üst)
            const taper = ny < 0 ? 1 + ny * 0.48 : 1 + Math.sin(ny * Math.PI) * 0.12;
            return [vx * taper, vy * 1.06, vz * taper];
          });
        } else if (type.id === 'watermelon') {
          bodyGeom = new THREE.SphereGeometry(r, 32, 24);
          bodyGeom.scale(1.10, 0.94, 0.96);
        } else if (type.id === 'pineapple') {
          bodyGeom = new THREE.SphereGeometry(r, 28, 22);
          bodyGeom.scale(0.84, 1.06, 0.84);
        } else {
          // Portakal: hafif basık narenciye küresi
          bodyGeom = new THREE.SphereGeometry(r, 32, 24);
          bodyGeom.scale(1.03, 0.95, 1.03);
        }

        // TAM 3D MEYVE GRUBU
        const wholeGroup = new THREE.Group();
        const bodyMesh = new THREE.Mesh(bodyGeom, skinMat);
        wholeGroup.add(bodyMesh);
        wholeGroup.add(create3DCrownOrStem(type, r));
        threePrototypes.whole[type.id] = wholeGroup;

        // 3D YARIM MEYVE GRUPLARI (Üst Yarı & Alt Yarı + 3D Kesit Kapağı)
        const sx = type.id === 'watermelon' ? 1.10 : type.id === 'pineapple' ? 0.84 : 1.0;
        const sy = type.id === 'watermelon' ? 0.94 : type.id === 'pineapple' ? 1.06 : 0.96;
        const sz = type.id === 'watermelon' ? 0.96 : type.id === 'pineapple' ? 0.84 : 1.0;

        // Üst Yarı
        const topGroup = new THREE.Group();
        const topHemiGeom = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        topHemiGeom.scale(sx, sy, sz);
        const topHemi = new THREE.Mesh(topHemiGeom, skinMat);
        const topCapGeom = new THREE.CircleGeometry(r, 28);
        topCapGeom.scale(sx, sz, 1);
        const topCap = new THREE.Mesh(topCapGeom, cutMat);
        topCap.rotation.x = Math.PI / 2;
        topGroup.add(topHemi);
        topGroup.add(topCap);
        topGroup.add(create3DCrownOrStem(type, r));
        threePrototypes.halfTop[type.id] = topGroup;

        // Alt Yarı
        const botGroup = new THREE.Group();
        const botHemiGeom = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        botHemiGeom.scale(sx, sy, sz);
        const botHemi = new THREE.Mesh(botHemiGeom, skinMat);
        const botCapGeom = new THREE.CircleGeometry(r, 28);
        botCapGeom.scale(sx, sz, 1);
        const botCap = new THREE.Mesh(botCapGeom, cutMat);
        botCap.rotation.x = -Math.PI / 2;
        botGroup.add(botHemi);
        botGroup.add(botCap);
        threePrototypes.halfBottom[type.id] = botGroup;
      });

      // 3D BOMBA MODELİ (Mat Döküm Demir Küre + Silindirik Fitil Boğumu + Kıvrımlı Fitil + 3D Kıvılcım)
      const bombR = 42;
      const bombGroup = new THREE.Group();

      // Bomba Gövde Dokusu (Koyu Mat Metal + Turuncu Uyarı İkonu)
      const bCanvas = document.createElement('canvas');
      bCanvas.width = 256;
      bCanvas.height = 256;
      const bg = bCanvas.getContext('2d');
      bg.fillStyle = '#1C1F24';
      bg.fillRect(0, 0, 256, 256);
      bg.strokeStyle = '#E97E2D';
      bg.lineWidth = 14;
      bg.lineCap = 'round';
      for (const cx of [64, 192]) {
        bg.beginPath();
        bg.moveTo(cx - 24, 128 - 24);
        bg.lineTo(cx + 24, 128 + 24);
        bg.moveTo(cx + 24, 128 - 24);
        bg.lineTo(cx - 24, 128 + 24);
        bg.stroke();
      }
      const bombTex = new THREE.CanvasTexture(bCanvas);

      const bombMat = new THREE.MeshPhongMaterial({
        map: bombTex,
        color: 0xe8eaed,
        specular: 0x2c3238,
        shininess: 18
      });
      const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(bombR, 32, 24), bombMat);
      bombGroup.add(sphereMesh);

      // Mat Metalik Fitil Boğumu
      const collarMat = new THREE.MeshPhongMaterial({
        color: 0x454A50,
        specular: 0x353A40,
        shininess: 22
      });
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 12, 16), collarMat);
      collar.position.set(0, bombR + 3, 0);
      bombGroup.add(collar);

      // 3D Kıvrımlı Fitil İpi
      const fuseCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, bombR + 8, 0),
        new THREE.Vector3(10, bombR + 24, 4),
        new THREE.Vector3(18, bombR + 18, 0)
      );
      const fuseGeom = new THREE.TubeGeometry(fuseCurve, 12, 2.6, 8, false);
      const fuseMat = new THREE.MeshLambertMaterial({ color: 0xD7C4B2 });
      const fuseMesh = new THREE.Mesh(fuseGeom, fuseMat);
      bombGroup.add(fuseMesh);

      // 3D Kıvılcım Çekirdeği + Turuncu Kor Halesi
      const sparkCore = new THREE.Mesh(
        new THREE.SphereGeometry(5, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xFFD54F })
      );
      sparkCore.position.set(18, bombR + 18, 0);
      sparkCore.name = 'sparkCore';
      bombGroup.add(sparkCore);

      const sparkHalo = new THREE.Mesh(
        new THREE.SphereGeometry(9.5, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xE97E2D, transparent: true, opacity: 0.42 })
      );
      sparkHalo.position.set(18, bombR + 18, 0);
      sparkHalo.name = 'sparkHalo';
      bombGroup.add(sparkHalo);

      threePrototypes.bomb = bombGroup;
      threeReady = true;
    } catch (err) {
      console.warn('Three.js başlatılamadı, 2D yedek çizime geçiliyor:', err);
      threeReady = false;
    }
  }

  function resizeThreeJS() {
    if (!threeReady || !threeRenderer || !threeCamera) return;
    threeRenderer.setSize(width, height);
    threeCamera.left = 0;
    threeCamera.right = width;
    threeCamera.top = height;
    threeCamera.bottom = 0;
    threeCamera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resizeThreeJS);

  function clearThreeSceneMeshes() {
    if (!threeReady || !threeScene) return;
    for (const f of fruits) {
      if (f.mesh) threeScene.remove(f.mesh);
    }
    for (const h of fruitHalves) {
      if (h.mesh) threeScene.remove(h.mesh);
    }
  }

  initThreeJS();

  function spawnWave() {
    // Kalan süreye göre zorluk artışı
    const elapsed = ROUND_DURATION - timeLeft;
    const count = elapsed < 8 ? randomInt(1, 3) : elapsed < 20 ? randomInt(2, 4) : randomInt(3, 5);

    let bombsInWave = 0;
    for (let i = 0; i < count; i++) {
      const isBomb = bombsInWave < 1 && Math.random() < (elapsed > 5 ? 0.10 : 0.04);
      const margin = Math.max(120, width * 0.15);
      const x = margin + Math.random() * (width - margin * 2);
      const y = height + 60 + i * 25;

      // Ekranın ortasına doğru parabolik fırlatma hızı
      const targetX = width * (0.25 + Math.random() * 0.5);
      const flightTime = 1.15 + Math.random() * 0.25;
      const vx = (targetX - x) / flightTime;
      const peakHeight = height * (0.16 + Math.random() * 0.28);
      const gravity = 980;
      const vy = -Math.sqrt(2 * gravity * (y - peakHeight));

      if (isBomb) {
        bombsInWave++;
        let mesh = null;
        if (threeReady && threePrototypes.bomb) {
          mesh = threePrototypes.bomb.clone();
          mesh.position.set(x, height - y, 0);
          threeScene.add(mesh);
        }
        fruits.push({
          isBomb: true,
          name: 'Bomba',
          points: -25,
          radius: 42,
          x,
          y,
          vx,
          vy,
          gravity,
          angle: Math.random() * Math.PI * 2,
          vAngle: (Math.random() - 0.5) * 4,
          rx: Math.random() * 0.6 - 0.3,
          ry: Math.random() * Math.PI * 2,
          rz: (Math.random() - 0.5) * 0.5,
          vrx: (Math.random() - 0.5) * 2.4,
          vry: (Math.random() - 0.5) * 3.8,
          vrz: (Math.random() - 0.5) * 2.8,
          mesh,
          sliced: false
        });
      } else {
        // Ananas biraz daha nadir çıksın
        const roll = Math.random();
        const type = roll < 0.12
          ? FRUIT_TYPES[5] // Ananas (+25)
          : FRUIT_TYPES[Math.floor(Math.random() * (FRUIT_TYPES.length - 1))];

        let mesh = null;
        if (threeReady && threePrototypes.whole[type.id]) {
          mesh = threePrototypes.whole[type.id].clone();
          mesh.position.set(x, height - y, 0);
          threeScene.add(mesh);
        }

        fruits.push({
          isBomb: false,
          type,
          name: type.name,
          points: type.points,
          radius: type.radius,
          x,
          y,
          vx,
          vy,
          gravity,
          angle: Math.random() * Math.PI * 2,
          vAngle: (Math.random() - 0.5) * 4.5,
          rx: (Math.random() - 0.5) * 0.8,
          ry: Math.random() * Math.PI * 2,
          rz: (Math.random() - 0.5) * 0.8,
          vrx: (Math.random() - 0.5) * 3.4,
          vry: (Math.random() - 0.5) * 4.2,
          vrz: (Math.random() - 0.5) * 3.6,
          mesh,
          sliced: false
        });
      }
    }
  }

  // ==========================================
  // 7. 3D MEYVE VE BOMBA ÇİZİM FONKSİYONLARI
  // ==========================================
  function draw3DStemAndLeaf(c, radius, isPineapple, isStrawberry) {
    if (isPineapple) {
      // Ananas 3D katmanlı yaprak tacı
      const leaves = [
        { angle: -0.55, len: radius * 0.65, w: 11, color1: '#2E7D32', color2: '#1B5E20' },
        { angle: 0.55, len: radius * 0.65, w: 11, color1: '#2E7D32', color2: '#1B5E20' },
        { angle: -0.28, len: radius * 0.82, w: 13, color1: '#43A047', color2: '#1B5E20' },
        { angle: 0.28, len: radius * 0.82, w: 13, color1: '#43A047', color2: '#1B5E20' },
        { angle: 0, len: radius * 0.95, w: 14, color1: '#66BB6A', color2: '#2E7D32' }
      ];
      leaves.forEach((lf) => {
        c.save();
        c.translate(0, -radius * 0.88);
        c.rotate(lf.angle);
        const grad = c.createLinearGradient(0, 0, 0, -lf.len);
        grad.addColorStop(0, lf.color2);
        grad.addColorStop(1, lf.color1);
        c.fillStyle = grad;
        c.strokeStyle = '#16181A';
        c.lineWidth = 2.2;
        c.beginPath();
        c.moveTo(-lf.w * 0.6, 4);
        c.quadraticCurveTo(-lf.w, -lf.len * 0.5, 0, -lf.len);
        c.quadraticCurveTo(lf.w, -lf.len * 0.5, lf.w * 0.6, 4);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      });
      return;
    }

    if (isStrawberry) {
      // Çilek 3D yıldız yaprak tacı
      for (let i = -2; i <= 2; i++) {
        c.save();
        c.translate(0, -radius * 0.86);
        c.rotate(i * 0.42);
        const lGrad = c.createLinearGradient(0, -16, 0, 6);
        lGrad.addColorStop(0, '#66BB6A');
        lGrad.addColorStop(1, '#1B5E20');
        c.fillStyle = lGrad;
        c.strokeStyle = '#16181A';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, -14);
        c.quadraticCurveTo(9, -2, 0, 8);
        c.quadraticCurveTo(-9, -2, 0, -14);
        c.fill();
        c.stroke();
        c.restore();
      }
      return;
    }

    // Üst çukur gölgesi (Elma/Portakal 3D sap çukuru)
    c.save();
    const pitGrad = c.createRadialGradient(0, -radius * 0.82, 1, 0, -radius * 0.82, radius * 0.28);
    pitGrad.addColorStop(0, 'rgba(22, 24, 26, 0.55)');
    pitGrad.addColorStop(1, 'rgba(22, 24, 26, 0)');
    c.fillStyle = pitGrad;
    c.beginPath();
    c.ellipse(0, -radius * 0.82, radius * 0.26, radius * 0.11, 0, 0, Math.PI * 2);
    c.fill();

    // 3D Kıvrımlı Odunsu Sap
    c.strokeStyle = '#4E342E';
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, -radius * 0.82);
    c.quadraticCurveTo(-3, -radius - 10, 4, -radius - 15);
    c.stroke();

    c.strokeStyle = '#8D6E63';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-1, -radius * 0.84);
    c.quadraticCurveTo(-3, -radius - 9, 3, -radius - 14);
    c.stroke();

    // 3D Bombeli Yaprak
    c.translate(10, -radius - 6);
    c.rotate(-0.35);
    const leafGrad = c.createLinearGradient(-12, -6, 12, 6);
    leafGrad.addColorStop(0, '#81C784');
    leafGrad.addColorStop(0.5, '#43A047');
    leafGrad.addColorStop(1, '#1B5E20');
    c.fillStyle = leafGrad;
    c.strokeStyle = '#16181A';
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(-12, 0);
    c.quadraticCurveTo(0, -10, 14, 0);
    c.quadraticCurveTo(0, 9, -12, 0);
    c.fill();
    c.stroke();

    // Yaprak damarı
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-9, 0);
    c.lineTo(10, 0);
    c.stroke();
    c.restore();
  }

  function drawBanana3D(c, type, radius, halfMode) {
    c.save();
    if (halfMode !== 0) {
      c.beginPath();
      if (halfMode === -1) {
        c.rect(-radius * 1.7, -radius * 1.7, radius * 3.4, radius * 1.7);
      } else {
        c.rect(-radius * 1.7, 0, radius * 3.4, radius * 1.7);
      }
      c.clip();
    }

    // 3D derin alt gölge
    c.save();
    c.translate(5, 7);
    c.fillStyle = 'rgba(22, 24, 26, 0.42)';
    c.beginPath();
    c.arc(0, 0, radius * 0.95, -0.65 * Math.PI, 0.55 * Math.PI, false);
    c.quadraticCurveTo(radius * 0.15, 0, Math.cos(-0.65 * Math.PI) * radius * 0.95, Math.sin(-0.65 * Math.PI) * radius * 0.95);
    c.fill();
    c.restore();

    // 3D Muz Hilal Gövdesi
    const bGrad = c.createRadialGradient(-radius * 0.25, -radius * 0.3, radius * 0.05, 0, 0, radius * 1.15);
    bGrad.addColorStop(0, type.lightColor);
    bGrad.addColorStop(0.55, type.outerColor);
    bGrad.addColorStop(1, type.darkColor);

    c.fillStyle = bGrad;
    c.strokeStyle = '#16181A';
    c.lineWidth = 3.2;
    c.beginPath();
    c.arc(0, 0, radius * 0.98, -0.68 * Math.PI, 0.58 * Math.PI, false);
    c.quadraticCurveTo(radius * 0.08, 0, Math.cos(-0.68 * Math.PI) * radius * 0.98, Math.sin(-0.68 * Math.PI) * radius * 0.98);
    c.closePath();
    c.fill();
    c.stroke();

    // 3D Muz Sırt Faset Çizgisi (Yumuşatılmış hacim çizgisi)
    c.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, 0, radius * 0.72, -0.52 * Math.PI, 0.42 * Math.PI, false);
    c.stroke();

    // Alt gölge faseti
    c.strokeStyle = 'rgba(143, 61, 12, 0.35)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, radius * 0.86, -0.58 * Math.PI, 0.48 * Math.PI, false);
    c.stroke();

    // Kesilmişse 3D Muz İçi Kesiti
    if (halfMode !== 0) {
      const cutY = halfMode === -1 ? -4 : 4;
      c.fillStyle = type.rindColor;
      c.strokeStyle = '#16181A';
      c.lineWidth = 2.5;
      c.beginPath();
      c.ellipse(radius * 0.48, cutY, radius * 0.36, radius * 0.16, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      const inGrad = c.createRadialGradient(radius * 0.45, cutY - 2, 2, radius * 0.48, cutY, radius * 0.3);
      inGrad.addColorStop(0, '#FFFFFF');
      inGrad.addColorStop(0.7, type.innerColor);
      inGrad.addColorStop(1, type.innerDark);
      c.fillStyle = inGrad;
      c.beginPath();
      c.ellipse(radius * 0.48, cutY, radius * 0.28, radius * 0.11, 0, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
  }

  function drawFruitShape(c, type, radius, halfMode = 0) {
    if (type.id === 'banana') {
      drawBanana3D(c, type, radius, halfMode);
      return;
    }

    c.save();

    // Yarı modunda dış kabuğu yarım küre olarak kırp
    if (halfMode !== 0) {
      c.beginPath();
      if (halfMode === -1) {
        c.rect(-radius * 1.6, -radius * 1.6, radius * 3.2, radius * 1.62);
      } else {
        c.rect(-radius * 1.6, -2, radius * 3.2, radius * 1.62);
      }
      c.clip();
    }

    // 1) 3D Yumuşak + Konturlu Alt Gölge (Drop Shadow)
    c.fillStyle = 'rgba(22, 24, 26, 0.38)';
    c.beginPath();
    c.arc(6, 8, radius * 0.98, 0, Math.PI * 2);
    c.fill();

    // 2) 3D Küresel Hacim (Radial Gradient: Sol-Üst Işık Kaynağı -> Sağ-Alt Koyu Gölge)
    const sphereGrad = c.createRadialGradient(
      -radius * 0.34,
      -radius * 0.34,
      radius * 0.06,
      0,
      0,
      radius * 1.05
    );
    sphereGrad.addColorStop(0, type.lightColor);
    sphereGrad.addColorStop(0.48, type.outerColor);
    sphereGrad.addColorStop(0.88, type.darkColor);
    sphereGrad.addColorStop(1, '#16181A');

    c.fillStyle = sphereGrad;
    c.strokeStyle = '#16181A';
    c.lineWidth = 3.2;
    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    // 3) Meyveye Özel 3D Yüzey Dokuları (Dış Kabuk Detayları)
    c.save();
    c.beginPath();
    c.arc(0, 0, radius - 2, 0, Math.PI * 2);
    c.clip();

    if (type.id === 'watermelon') {
      c.strokeStyle = 'rgba(10, 46, 14, 0.72)';
      c.lineWidth = radius * 0.18;
      c.lineCap = 'round';
      for (const offset of [-0.55, 0, 0.55]) {
        c.beginPath();
        c.ellipse(offset * radius * 0.4, 0, Math.max(4, Math.abs(offset) * radius * 0.55 + 6), radius * 0.95, 0, -Math.PI * 0.48, Math.PI * 0.48);
        c.stroke();
      }
    } else if (type.id === 'pineapple') {
      c.strokeStyle = 'rgba(109, 54, 0, 0.65)';
      c.lineWidth = 2.2;
      const step = radius * 0.38;
      for (let d = -radius * 1.4; d <= radius * 1.4; d += step) {
        c.beginPath();
        c.moveTo(d - radius, -radius);
        c.lineTo(d + radius, radius);
        c.moveTo(d + radius, -radius);
        c.lineTo(d - radius, radius);
        c.stroke();
      }
    } else if (type.id === 'strawberry') {
      const seedPositions = [
        [-0.45, -0.35], [0, -0.42], [0.45, -0.35],
        [-0.55, 0], [-0.18, -0.05], [0.2, -0.05], [0.55, 0],
        [-0.38, 0.38], [0, 0.35], [0.38, 0.38],
        [-0.15, 0.65], [0.18, 0.65]
      ];
      seedPositions.forEach(([sx, sy]) => {
        const px = sx * radius;
        const py = sy * radius;
        c.fillStyle = 'rgba(70, 0, 0, 0.65)';
        c.beginPath();
        c.ellipse(px + 1, py + 1.5, 3.2, 4.4, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = type.seedColor;
        c.beginPath();
        c.ellipse(px, py, 2.2, 3.3, 0, 0, Math.PI * 2);
        c.fill();
      });
    } else if (type.id === 'orange') {
      c.fillStyle = 'rgba(191, 54, 12, 0.28)';
      const pores = [
        [-0.4, -0.1], [-0.15, -0.45], [0.25, -0.3], [0.5, 0.1],
        [-0.3, 0.35], [0.1, 0.2], [0.35, 0.45], [-0.05, 0.58], [0.48, -0.22]
      ];
      pores.forEach(([px, py]) => {
        c.beginPath();
        c.arc(px * radius, py * radius, 2.1, 0, Math.PI * 2);
        c.fill();
      });
    }

    c.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, radius - 3.5, 0.12 * Math.PI, 0.45 * Math.PI);
    c.stroke();

    c.save();
    c.translate(-radius * 0.36, -radius * 0.36);
    c.rotate(-Math.PI / 4);
    const glossGrad = c.createRadialGradient(0, 0, 1, 0, 0, radius * 0.34);
    glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
    glossGrad.addColorStop(0.55, 'rgba(255, 255, 255, 0.10)');
    glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = glossGrad;
    c.beginPath();
    c.ellipse(0, 0, radius * 0.32, radius * 0.18, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.restore();

    if (halfMode <= 0) {
      draw3DStemAndLeaf(c, radius, type.id === 'pineapple', type.id === 'strawberry');
    }

    c.restore();

    if (halfMode !== 0) {
      c.save();
      const tiltY = radius * 0.42;
      const offsetY = halfMode === -1 ? -2 : 2;

      c.fillStyle = type.outerColor;
      c.strokeStyle = '#16181A';
      c.lineWidth = 2.8;
      c.beginPath();
      c.ellipse(0, offsetY, radius * 0.98, tiltY, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      c.fillStyle = type.rindColor;
      c.beginPath();
      c.ellipse(0, offsetY, radius * 0.88, tiltY * 0.86, 0, 0, Math.PI * 2);
      c.fill();

      const fleshGrad = c.createRadialGradient(-radius * 0.15, offsetY - 3, 2, 0, offsetY, radius * 0.82);
      fleshGrad.addColorStop(0, type.innerColor);
      fleshGrad.addColorStop(0.75, type.innerColor);
      fleshGrad.addColorStop(1, type.innerDark);
      c.fillStyle = fleshGrad;
      c.beginPath();
      c.ellipse(0, offsetY, radius * 0.78, tiltY * 0.74, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  function drawBomb(c, bomb) {
    const r = bomb.radius;
    c.save();
    c.translate(bomb.x, bomb.y);
    c.rotate(bomb.angle);

    c.fillStyle = 'rgba(233, 126, 45, 0.28)';
    c.beginPath();
    c.arc(5, 6, r * 1.03, 0, Math.PI * 2);
    c.fill();

    const bombGrad = c.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.08, 0, 0, r * 1.05);
    bombGrad.addColorStop(0, '#494E54');
    bombGrad.addColorStop(0.35, '#25282C');
    bombGrad.addColorStop(0.78, '#16181A');
    bombGrad.addColorStop(1, '#08090A');

    c.fillStyle = bombGrad;
    c.strokeStyle = '#16181A';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.restore();
  }

  // ==========================================
  // 8. KESİM (SLICE) VE ÇARPIŞMA KONTROLÜ
  // ==========================================
  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    return Math.hypot(px - projX, py - projY);
  }

  function checkSlices(x1, y1, x2, y2) {
    const moveDist = Math.hypot(x2 - x1, y2 - y1);
    if (moveDist < 4) return; // Çok hareketsiz parmak kesim yapmasın

    const sliceAngle = Math.atan2(y2 - y1, x2 - x1);

    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      if (f.sliced) continue;

      const d = distToSegment(f.x, f.y, x1, y1, x2, y2);
      if (d <= f.radius + 14) {
        f.sliced = true;
        if (f.mesh && threeScene) {
          threeScene.remove(f.mesh);
          f.mesh = null;
        }
        if (f.isBomb) {
          handleBombSlice(f);
        } else {
          handleFruitSlice(f, sliceAngle);
        }
        fruits.splice(i, 1);
      }
    }
  }

  function handleFruitSlice(f, sliceAngle) {
    slicedCount++;
    score += f.points;
    currentSwipeSlices++;
    swipeResetTimer = 0.22; // 220ms içinde kesilen meyveler kombo sayılır

    playSliceSound(0.95 + Math.random() * 0.25);

    // İki yarım 3D meyve oluştur
    const speed = 115;
    const perpAngle = sliceAngle + Math.PI / 2;

    let topMesh = null;
    let botMesh = null;
    if (threeReady && threePrototypes.halfTop[f.type.id] && threePrototypes.halfBottom[f.type.id]) {
      topMesh = threePrototypes.halfTop[f.type.id].clone();
      topMesh.position.set(f.x, height - f.y, 0);
      threeScene.add(topMesh);

      botMesh = threePrototypes.halfBottom[f.type.id].clone();
      botMesh.position.set(f.x, height - f.y, 0);
      threeScene.add(botMesh);
    }

    fruitHalves.push({
      type: f.type,
      radius: f.radius,
      x: f.x,
      y: f.y,
      vx: f.vx + Math.cos(perpAngle) * speed,
      vy: f.vy - 85 + Math.sin(perpAngle) * speed,
      gravity: f.gravity,
      angle: sliceAngle,
      vAngle: -3.8,
      rx: f.rx || 0.3,
      ry: f.ry || 0,
      rz: -sliceAngle,
      vrx: 3.2,
      vry: -2.8,
      vrz: -3.8,
      mesh: topMesh,
      halfMode: -1,
      alpha: 1
    });

    fruitHalves.push({
      type: f.type,
      radius: f.radius,
      x: f.x,
      y: f.y,
      vx: f.vx - Math.cos(perpAngle) * speed,
      vy: f.vy - 85 - Math.sin(perpAngle) * speed,
      gravity: f.gravity,
      angle: sliceAngle,
      vAngle: 3.8,
      rx: f.rx || -0.3,
      ry: f.ry || 0,
      rz: -sliceAngle,
      vrx: -3.4,
      vry: 2.9,
      vrz: 3.8,
      mesh: botMesh,
      halfMode: 1,
      alpha: 1
    });

    // Arka plana meyve suyu lekesi
    splatters.push({
      x: f.x,
      y: f.y,
      radius: f.radius * (0.7 + Math.random() * 0.4),
      color: f.type.juiceColor,
      alpha: 0.32
    });
    if (splatters.length > 25) splatters.shift();

    // Meyve suyu parçacıkları
    for (let p = 0; p < 14; p++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 260;
      particles.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        radius: 4 + Math.random() * 6,
        color: f.type.juiceColor,
        life: 0.45 + Math.random() * 0.35
      });
    }

    // Uçan puan etiketi
    floatingTexts.push({
      text: `+${f.points}`,
      x: f.x,
      y: f.y - 10,
      vy: -75,
      bg: '#FDF0E6',
      fg: '#8F3D0C',
      life: 0.85
    });

    // Kombo kontrolü
    if (currentSwipeSlices >= 2) {
      if (currentSwipeSlices > maxCombo) {
        maxCombo = currentSwipeSlices;
      }
      const bonus = currentSwipeSlices * 5;
      score += bonus;
      playComboSound(currentSwipeSlices);
      floatingTexts.push({
        text: `${currentSwipeSlices}X KOMBO! +${bonus}`,
        x: f.x,
        y: f.y - 48,
        vy: -95,
        bg: '#E97E2D',
        fg: '#16181A',
        life: 1.15,
        isBig: true
      });
    }

    updateHud();
  }

  function handleBombSlice(bomb) {
    bombsHit++;
    score = Math.max(0, score - 25); // -25 ceza, 0 taban
    currentSwipeSlices = 0;
    screenShake = 0.35;
    bombFlashAlpha = 0.45;
    playBombSound();

    // Patlama parçacıkları
    for (let p = 0; p < 22; p++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 140 + Math.random() * 360;
      particles.push({
        x: bomb.x,
        y: bomb.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        radius: 5 + Math.random() * 7,
        color: p % 2 === 0 ? '#16181A' : '#E97E2D',
        life: 0.55 + Math.random() * 0.35
      });
    }

    floatingTexts.push({
      text: `BOMBA! -25 P`,
      x: bomb.x,
      y: bomb.y - 20,
      vy: -85,
      bg: '#17171D',
      fg: '#FFFFFF',
      life: 1.2,
      isBig: true
    });

    updateHud();
  }

  // ==========================================
  // 9. OYUN AKIŞI (BAŞLATMA, GERİ SAYIM, BİTİŞ)
  // ==========================================
  function updateHud() {
    hudPlayer.textContent = currentPlayer;
    hudScore.textContent = score;
    hudTimer.textContent = `${Math.max(0, timeLeft).toFixed(1)}s`;
    if (timeLeft <= 5.0 && gameState === 'PLAYING') {
      timerCard.classList.add('urgent');
    } else {
      timerCard.classList.remove('urgent');
    }
  }

  function startCountdown(instagramHandle) {
    ensureAudio();
    let cleaned = String(instagramHandle || '').trim().replace(/^@+/, '');
    if (!cleaned) cleaned = 'sudev_oyuncu';
    currentPlayer = '@' + cleaned;

    clearThreeSceneMeshes();
    score = 0;
    timeLeft = ROUND_DURATION;
    slicedCount = 0;
    bombsHit = 0;
    maxCombo = 1;
    fruits.length = 0;
    fruitHalves.length = 0;
    particles.length = 0;
    splatters.length = 0;
    floatingTexts.length = 0;
    updateHud();

    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    countdownOverlay.classList.remove('hidden');
    gameState = 'COUNTDOWN';

    let count = 3;
    countdownNumber.textContent = count;
    playBeep(440, 0.12);

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownNumber.textContent = count;
        playBeep(440, 0.12);
      } else if (count === 0) {
        countdownNumber.textContent = 'KES!';
        playBeep(880, 0.22);
      } else {
        clearInterval(interval);
        countdownOverlay.classList.add('hidden');
        gameState = 'PLAYING';
        spawnTimer = 0.15;
      }
    }, 750);
  }

  async function finishRound() {
    gameState = 'GAMEOVER';
    playBeep(587.33, 0.15);
    setTimeout(() => playBeep(880, 0.3), 160);

    const now = new Date();
    const entry = {
      isim: currentPlayer,
      puan: score,
      tarih: now.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }),
      saat: now.toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };

    const scores = getSavedScores();
    scores.push(entry);
    scores.sort((a, b) => (Number(b.puan ?? b.score) || 0) - (Number(a.puan ?? a.score) || 0));
    saveScoresToStorage(scores);

    // Sonuç ekranını doldur
    finalScoreEl.textContent = score;
    finalPlayerEl.textContent = currentPlayer;
    gameoverScreen.classList.remove('hidden');

    // Arka planda sessizce puanlar.xlsx dosyasına puana göre sıralı ekle
    await appendScoreToBackgroundExcel(entry);
  }

  startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    startCountdown(instagramInput.value);
  });

  newPlayerBtn.addEventListener('click', () => {
    gameoverScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    gameState = 'LOBBY';
    instagramInput.value = '';
    setTimeout(() => instagramInput.focus(), 50);
  });

  // Hızlı hareketlerde aşma (overshoot) ve düğümlenme yapmayan Kiriş-Sınırlı (Chord-Clamped) Spline
  function getSmoothSplinePoints(pts, subdivisions = 4) {
    if (pts.length < 2) return pts;
    if (pts.length === 2) {
      return [
        pts[0],
        { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 },
        pts[1]
      ];
    }
    const result = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (segDist < 0.5) continue;

      // Teğet büyüklüğünü segment uzunluğuyla sınırla (hızlı hareketlerde savrulmayı önler)
      let m1x = (p2.x - p0.x) * 0.5;
      let m1y = (p2.y - p0.y) * 0.5;
      const m1Len = Math.hypot(m1x, m1y);
      if (m1Len > segDist) {
        const s = segDist / m1Len;
        m1x *= s;
        m1y *= s;
      }

      let m2x = (p3.x - p1.x) * 0.5;
      let m2y = (p3.y - p1.y) * 0.5;
      const m2Len = Math.hypot(m2x, m2y);
      if (m2Len > segDist) {
        const s = segDist / m2Len;
        m2x *= s;
        m2y *= s;
      }

      for (let step = 0; step < subdivisions; step++) {
        const t = step / subdivisions;
        const t2 = t * t;
        const t3 = t2 * t;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        result.push({
          x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
          y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y
        });
      }
    }
    result.push(pts[pts.length - 1]);
    return result;
  }

  // Hızlı dönüşlerde kendi kendini kesmeyen (twist/spike yapmayan) katmanlı pürüzsüz bıçak izi
  function drawSmoothBladeTrail(c, rawPoints) {
    if (rawPoints.length < 2) return;
    const curve = getSmoothSplinePoints(rawPoints, 4);
    if (curve.length < 2) return;

    const maxWidth = 17;
    const n = curve.length - 1;

    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // 1. Katman: Koyu mürekkep dış kontur (#16181A)
    c.strokeStyle = '#16181A';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const profile = Math.pow(t, 1.25) * Math.sin(Math.min(1, (1 - t) * 6.5 + 0.38) * (Math.PI / 2));
      const w = Math.max(1.5, profile * maxWidth);
      c.lineWidth = w + 5.5;
      c.beginPath();
      c.moveTo(curve[i].x, curve[i].y);
      c.lineTo(curve[i + 1].x, curve[i + 1].y);
      c.stroke();
    }

    // 2. Katman: SÜDEV turuncu gövde (#E97E2D)
    c.strokeStyle = '#E97E2D';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const profile = Math.pow(t, 1.25) * Math.sin(Math.min(1, (1 - t) * 6.5 + 0.38) * (Math.PI / 2));
      const w = Math.max(1.0, profile * maxWidth);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(curve[i].x, curve[i].y);
      c.lineTo(curve[i + 1].x, curve[i + 1].y);
      c.stroke();
    }

    // 3. Katman: İç parlak çekirdek (#FFF3E0)
    c.strokeStyle = '#FFF3E0';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const profile = Math.pow(t, 1.25) * Math.sin(Math.min(1, (1 - t) * 6.5 + 0.38) * (Math.PI / 2));
      const cw = Math.max(0.5, profile * maxWidth * 0.42);
      c.lineWidth = cw;
      c.beginPath();
      c.moveTo(curve[i].x, curve[i].y);
      c.lineTo(curve[i + 1].x, curve[i + 1].y);
      c.stroke();
    }

    c.restore();
  }

  // ==========================================
  // 10. ANA OYUN DÖNGÜSÜ (60 FPS UPDATE & RENDER)
  // ==========================================
  function updateAndDraw(now) {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    // Hıza duyarlı (Velocity-Adaptive) parmak pozisyonu yumuşatma:
    // Yavaşken titremeyi sönümler, hızlı savuruşlarda gecikmesiz anında takip eder
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    const targetDist = Math.hypot(pointer.targetX - pointer.x, pointer.targetY - pointer.y);
    let smoothFactor;
    if (pointer.source === 'HAND') {
      const speedBoost = Math.min(1, targetDist / 75);
      const rate = 26 + speedBoost * 65;
      smoothFactor = Math.min(0.95, dt * rate + speedBoost * 0.45);
    } else {
      smoothFactor = Math.min(0.96, dt * 55);
    }
    pointer.x += (pointer.targetX - pointer.x) * smoothFactor;
    pointer.y += (pointer.targetY - pointer.y) * smoothFactor;

    if (pointer.active) {
      if (bladeTrail.length === 0) {
        bladeTrail.push({ x: pointer.x, y: pointer.y, time: now });
      } else {
        const lastPt = bladeTrail[bladeTrail.length - 1];
        const dist = Math.hypot(pointer.x - lastPt.x, pointer.y - lastPt.y);
        if (dist >= 3.5) {
          // Çok hızlı harekette iz kopukluğunu önlemek için ara nokta ekle
          if (dist > 48) {
            const steps = Math.min(4, Math.ceil(dist / 36));
            for (let s = 1; s < steps; s++) {
              const r = s / steps;
              bladeTrail.push({
                x: lastPt.x + (pointer.x - lastPt.x) * r,
                y: lastPt.y + (pointer.y - lastPt.y) * r,
                time: now
              });
            }
          }
          bladeTrail.push({ x: pointer.x, y: pointer.y, time: now });
          while (bladeTrail.length > MAX_TRAIL_POINTS) {
            bladeTrail.shift();
          }
        } else {
          lastPt.x = pointer.x;
          lastPt.y = pointer.y;
          lastPt.time = now;
        }
      }
    }
    // Eski iz noktalarını temizle
    while (bladeTrail.length > 0 && now - bladeTrail[0].time > 135) {
      bladeTrail.shift();
    }

    // Kombo sayacı
    if (swipeResetTimer > 0) {
      swipeResetTimer -= dt;
      if (swipeResetTimer <= 0) {
        currentSwipeSlices = 0;
      }
    }

    // Oyun içi süre ve dalga üretimi
    if (gameState === 'PLAYING') {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateHud();
        finishRound();
      } else {
        updateHud();
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnWave();
          spawnTimer = 1.05 + Math.random() * 0.55;
        }
      }

      if (pointer.active) {
        checkSlices(pointer.prevX, pointer.prevY, pointer.x, pointer.y);
        // Hızlı savuruşlarda hedef noktaya kadar olan kesim hattını da kontrol et
        if (Math.hypot(pointer.targetX - pointer.x, pointer.targetY - pointer.y) > 8) {
          checkSlices(pointer.x, pointer.y, pointer.targetX, pointer.targetY);
        }
      }
    }

    // Tuvali temizle
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Kamera sarsıntısı (bomba patladığında)
    if (screenShake > 0) {
      screenShake -= dt;
      const mag = screenShake * 28;
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    // Tam ekran, sislemesiz (net) aynalanmış kamera arka planı (object-fit: cover mantığında)
    if (cameraReady && videoElement.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      const vw = videoElement.videoWidth || 640;
      const vh = videoElement.videoHeight || 480;
      const scale = Math.max(width / vw, height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (width - dw) * 0.5;
      const dy = (height - dh) * 0.5;

      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoElement, dx, dy, dw, dh);
      ctx.restore();
    }

    // 1) Arka plan meyve suyu lekeleri
    for (let i = splatters.length - 1; i >= 0; i--) {
      const s = splatters[i];
      s.alpha -= dt * 0.04;
      if (s.alpha <= 0) {
        splatters.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2) Kesilmiş meyve yarıları fizik + Three.js 3D dönüş güncellemesi
    for (let i = fruitHalves.length - 1; i >= 0; i--) {
      const h = fruitHalves[i];
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.vy += h.gravity * dt;
      h.angle += h.vAngle * dt;
      h.rx = (h.rx || 0) + (h.vrx || 3) * dt;
      h.ry = (h.ry || 0) + (h.vry || 2) * dt;
      h.rz = (h.rz || 0) + (h.vrz || 3) * dt;

      if (h.y > height + 120) {
        if (h.mesh && threeScene) threeScene.remove(h.mesh);
        fruitHalves.splice(i, 1);
        continue;
      }

      if (threeReady && h.mesh) {
        h.mesh.position.set(h.x, height - h.y, 0);
        h.mesh.rotation.set(h.rx, h.ry, h.rz);
      } else {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.angle);
        drawFruitShape(ctx, h.type, h.radius, h.halfMode);
        ctx.restore();
      }
    }

    // 3) Aktif meyveler ve bombalar fizik + Three.js 3D dönüş güncellemesi
    const sparkScale = 0.85 + Math.sin(now * 0.04) * 0.35;
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += f.gravity * dt;
      f.angle += f.vAngle * dt;
      f.rx = (f.rx || 0) + (f.vrx || 2) * dt;
      f.ry = (f.ry || 0) + (f.vry || 3) * dt;
      f.rz = (f.rz || 0) + (f.vrz || 2) * dt;

      if (f.y > height + 140 && f.vy > 0) {
        if (f.mesh && threeScene) threeScene.remove(f.mesh);
        fruits.splice(i, 1);
        continue;
      }

      if (threeReady && f.mesh) {
        f.mesh.position.set(f.x, height - f.y, 0);
        f.mesh.rotation.set(f.rx, f.ry, f.rz);
        if (f.isBomb) {
          const halo = f.mesh.getObjectByName('sparkHalo');
          if (halo) halo.scale.setScalar(sparkScale);
        }
      } else if (f.isBomb) {
        drawBomb(ctx, f);
      } else {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.angle);
        drawFruitShape(ctx, f.type, f.radius, 0);
        ctx.restore();
      }
    }

    // 3.5) Three.js 3D WebGL Sahnesini Render Et ve Ana Tuvale Çiz
    if (threeReady && threeRenderer && threeScene && threeCamera) {
      threeRenderer.render(threeScene, threeCamera);
      ctx.drawImage(threeRenderer.domElement, 0, 0, width, height);
    }

    // 4) Parçacıklar
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 520 * dt;

      ctx.save();
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#16181A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * Math.max(0.2, p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 5) Uçan puan / kombo rozetleri (SÜDEV .tag stilinde)
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        floatingTexts.splice(i, 1);
        continue;
      }
      ft.y += ft.vy * dt;
      ft.vy *= 0.94;

      ctx.save();
      ctx.font = ft.isBig ? '800 22px "JetBrains Mono", monospace' : '800 17px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(ft.text).width;
      const padX = 12;
      const boxW = textWidth + padX * 2;
      const boxH = ft.isBig ? 36 : 28;

      // Blok gölge
      ctx.fillStyle = '#16181A';
      ctx.fillRect(ft.x - boxW / 2 + 3, ft.y - boxH / 2 + 3, boxW, boxH);

      // Etiket kutusu
      ctx.fillStyle = ft.bg;
      ctx.strokeStyle = '#16181A';
      ctx.lineWidth = 2.5;
      ctx.fillRect(ft.x - boxW / 2, ft.y - boxH / 2, boxW, boxH);
      ctx.strokeRect(ft.x - boxW / 2, ft.y - boxH / 2, boxW, boxH);

      // Metin
      ctx.fillStyle = ft.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, ft.x, ft.y + 1);
      ctx.restore();
    }

    // 6) Bomba flaş efekti
    if (bombFlashAlpha > 0) {
      bombFlashAlpha -= dt * 1.4;
      ctx.save();
      ctx.fillStyle = `rgba(233, 126, 45, ${Math.max(0, bombFlashAlpha)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 7) Akıcı ve Köşesiz Bıçak İzi (Catmull-Rom Spline Şerit)
    if (bladeTrail.length >= 2) {
      drawSmoothBladeTrail(ctx, bladeTrail);
    }

    // 8) Zarif Parmak Ucu Noktası
    if (pointer.active) {
      ctx.save();
      ctx.fillStyle = '#E97E2D';
      ctx.strokeStyle = '#16181A';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    requestAnimationFrame(updateAndDraw);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Başlat
  initHandTracking();
  requestAnimationFrame(updateAndDraw);
})();
