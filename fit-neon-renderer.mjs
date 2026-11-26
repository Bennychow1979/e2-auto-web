// E2 heading integration adapted from React Bits NeonLogo by David Haz.
// License: vendor/react-bits-LICENSE.md. No React runtime or external requests.
const FLOOR = 34;
const MAX_RENDER_DIM = 2400;
const GROW_SECONDS = 0.9;
const FLARE_LEAD = 1;
const FLARE_HOLD = 0.95;
const FLARE_SECONDS = 2.2;
const DEFAULT_COLORS = ['#ffc9f4', '#ea6fe0', '#d351b6', '#a6f3fa', '#6fd6f7', '#5aaef0', '#2b4bb8', '#121646'];
const DEFAULT_FONT = 'Inter, system-ui, sans-serif';

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uPalette;
uniform vec2 uRes;
uniform vec3 uBase;
uniform float uGain;
uniform float uGrow;
uniform vec3 uHand;
uniform vec3 uRadii;
uniform float uCool;
uniform float uSwell;
uniform float uLit;
uniform vec4 uFlare;
uniform float uFlareWidth;
uniform float uOpacity;
out vec4 outColor;

void main() {
  vec2 frag = gl_FragCoord.xy;
  float f = min(texture(uField, frag / uRes).r * uGain, 1.0) * uGrow;
  vec2 dv = frag - uHand.xy;
  float d2 = dot(dv, dv);
  float on = uHand.z;
  float m = uLit;
  if (on > 0.002) {
    f = min(f * (1.0 + uSwell * on * exp(-d2 / (uRadii.z * uRadii.z))), 1.0);
    float r = sqrt(d2) / uRadii.x;
    float k = r < 0.45 ? mix(1.0, 0.6, r / 0.45) : mix(0.6, 0.0, clamp((r - 0.45) / 0.55, 0.0, 1.0));
    f *= 1.0 - uCool * on * k;
    float t = clamp(1.0 - d2 / (uRadii.y * uRadii.y), 0.0, 1.0);
    m = max(m, on * t * t * (3.0 - 2.0 * t));
  }
  if (uFlare.z > 0.0) {
    float fd = length(frag - uFlare.xy);
    float lead = clamp((uFlare.z - fd) / uFlareWidth + 0.5, 0.0, 1.0);
    float trail = clamp((uFlare.w - fd) / uFlareWidth + 0.5, 0.0, 1.0);
    lead = lead * lead * (3.0 - 2.0 * lead);
    trail = trail * trail * (3.0 - 2.0 * trail);
    m = max(m, lead * (1.0 - trail));
  }
  vec4 heat = texture(uPalette, vec2((f * 255.0 + 0.5) / 256.0, 0.5));
  float grey = clamp((f * 255.0 - 70.0) / 45.0, 0.0, 1.0);
  vec3 rgb = heat.rgb;
  float alpha = heat.a * m * uOpacity;
  outColor = vec4(rgb * alpha, alpha);
}`;

const UNIFORMS = [
  'uField',
  'uPalette',
  'uRes',
  'uBase',
  'uGain',
  'uGrow',
  'uHand',
  'uRadii',
  'uCool',
  'uSwell',
  'uLit',
  'uFlare',
  'uFlareWidth',
  'uOpacity'
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
};

const startProgram = gl => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return { program, vertex, fragment };
};

const finishProgram = (gl, job) => {
  const { program, vertex, fragment } = job;
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked && !gl.isContextLost()) {
    const broken = [vertex, fragment].filter(shader => !gl.getShaderParameter(shader, gl.COMPILE_STATUS));
    if (broken.length) broken.forEach(shader => console.error(gl.getShaderInfoLog(shader)));
    else console.error(gl.getProgramInfoLog(program));
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!linked) {
    gl.deleteProgram(program);
    return null;
  }
  const uniforms = {};
  for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
};

const makeTexture = gl => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return texture;
};

const strokeWidth = (paint, width, height, box) => {
  const scale = Math.min(1, 220 / Math.max(box[2], box[3], 1));
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  paint(context, 0);
  const data = context.getImageData(0, 0, w, h).data;
  const far = 1e6;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = data[i * 4 + 3] > 127 ? far : 0;
  const d2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, dist[i - w] + 1);
        if (x > 0) v = Math.min(v, dist[i - w - 1] + d2);
        if (x < w - 1) v = Math.min(v, dist[i - w + 1] + d2);
      }
      dist[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let v = dist[i];
      if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, dist[i + w] + 1);
        if (x < w - 1) v = Math.min(v, dist[i + w + 1] + d2);
        if (x > 0) v = Math.min(v, dist[i + w - 1] + d2);
      }
      dist[i] = v;
    }
  }
  const inside = [];
  for (let i = 0; i < w * h; i++) if (dist[i] > 0 && dist[i] < far) inside.push(dist[i]);
  if (!inside.length) return 0;
  inside.sort((a, b) => a - b);
  return (2 * inside[Math.floor(inside.length * 0.92)]) / scale;
};

const buildField = (canvas, shape, settings, width, height) => {
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  const ratio = width / settings.cssWidth;
  const font = `${settings.fontWeight} ${settings.fontSize * ratio}px ${settings.fontFamily}`;
  const drawW = settings.textWidth * ratio, drawH = settings.fontSize * ratio;
  const box = [width / 2, height / 2, drawW, drawH];
  const paint = (target, offset) => {
    target.font = font;
    target.letterSpacing = `${settings.letterSpacing * ratio}px`;
    target.textBaseline = 'alphabetic'; target.fillStyle = '#fff';
    for (const line of settings.lines) {
      const metrics = target.measureText(line.text);
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
      const y = line.y * ratio + (line.height * ratio + ascent - descent) / 2;
      target.fillText(line.text, line.x * ratio - offset, y);
    }
  };
  const unit = Math.sqrt(Math.max(drawW * drawH, 1)) / 139;
  const stroke = strokeWidth(paint, width, height, box);
  const blurUnit = stroke > 0 ? Math.min(unit, stroke / 17) : unit;
  const offset = width * 3 + 64;
  context.shadowColor = '#fff'; context.shadowBlur = (2 + settings.softness * 6) * blurUnit;
  context.shadowOffsetX = offset;
  paint(context, offset); paint(context, offset);
  return {unit, box};
};

const measureGain = canvas => {
  const probe = document.createElement('canvas');
  const scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
  probe.width = Math.max(1, Math.round(canvas.width * scale));
  probe.height = Math.max(1, Math.round(canvas.height * scale));
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return 1;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const data = context.getImageData(0, 0, probe.width, probe.height).data;
  let peak = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > peak) peak = data[i];
  return peak > 0 ? clamp(235 / peak, 1, 4) : 1;
};

export function mountNeonHeading(container, text) {
  const style = getComputedStyle(text);
  const canvas = document.createElement('canvas');
  canvas.className = 'e2NeonCanvas'; canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const settingsRef = {current: {
    fontFamily: style.fontFamily, fontWeight: style.fontWeight,
    fontSize: parseFloat(style.fontSize), letterSpacing: parseFloat(style.letterSpacing) || 0,
    textWidth: text.getBoundingClientRect().width, cssWidth: container.clientWidth,
    scale: 1, baseColor: '#111214',
    colors: ['#fff4cc', '#f4d686', '#d4ac50', '#ad812c', '#705019', '#211b10'],
    heat: .3, radius: 1.5, softness: .12, swell: .06,
    idle: 'none', speed: 0, igniteOnClick: true, interactive: true,
    intro: false, opacity: 1, dpr: Math.min(devicePixelRatio || 1, 2)
  }};
  const shapeRef = {current: {kind: 'text', text: text.textContent, key: text.textContent}};
  const wakeRef = {current: null};
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'default'
    });
    if (!gl) { canvas.remove(); return () => {}; }
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    let job = startProgram(gl);
    if (!job) return undefined;
    let surface = null;
    if (!parallel) {
      surface = finishProgram(gl, job);
      job = null;
      if (!surface) return undefined;
    }
    const vao = gl.createVertexArray();
    const fieldTexture = makeTexture(gl);
    const paletteTexture = makeTexture(gl);
    const fieldCanvas = document.createElement('canvas');
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const probeContext = probe.getContext('2d', { willReadFrequently: true });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = {
      width: 1,
      height: 1,
      ratio: 1,
      shape: null,
      fieldKey: '',
      paletteKey: '',
      base: [0.66, 0.33, 0.97],
      baseKey: '',
      gain: 1,
      unit: 1,
      box: [0, 0, 0, 0],
      grow: 0,
      growing: false,
      shown: false,
      pointer: { x: 0, y: 0, inside: false },
      hand: { x: 0, y: 0, tx: 0, ty: 0, power: 0, placed: false },
      drift: 0,
      release: 1,
      anchor: null,
      flare: null
    };
    let raf = 0;
    let last = 0;
    let visible = true;
    let alive = true;
    let lost = false;

    const toRgb = (value, fallback) => {
      if (!probeContext || !value) return fallback;
      const css = /^[0-9a-f]{3,8}$/i.test(value) ? `#${value}` : value;
      probeContext.clearRect(0, 0, 1, 1);
      probeContext.fillStyle = '#000000';
      probeContext.fillStyle = css;
      probeContext.fillRect(0, 0, 1, 1);
      const [r, g, b] = probeContext.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };

    const syncPalette = s => {
      const key = s.colors.join('|');
      if (key === state.paletteKey) return;
      state.paletteKey = key;
      const stops = s.colors.map(color => toRgb(color, [255, 255, 255]));
      if (stops.length === 1) stops.push(stops[0]);
      const table = new Uint8Array(256 * 4);
      for (let i = FLOOR; i < 256; i++) {
        const x = ((i - FLOOR) / (255 - FLOOR)) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(x));
        const f = x - k;
        for (let c = 0; c < 3; c++) table[i * 4 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
        table[i * 4 + 3] = Math.round(255 * clamp((i - FLOOR) / 26, 0, 1));
      }
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, table);
    };

    const syncBase = s => {
      if (s.baseColor === state.baseKey) return;
      state.baseKey = s.baseColor;
      state.base = toRgb(s.baseColor, [168, 85, 247]).map(v => v / 255);
    };

    const syncField = () => {
      const s = settingsRef.current;
      const key = `${state.shape?.key ?? ''}|${canvas.width}x${canvas.height}|${s.scale}|${s.softness}`;
      if (key === state.fieldKey) return;
      state.fieldKey = key;
      const built = buildField(fieldCanvas, state.shape, s, canvas.width, canvas.height);
      if (!built) return;
      state.unit = built.unit;
      state.box = built.box;
      state.gain = state.shape ? measureGain(fieldCanvas) : 1;
      gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fieldCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };

    const render = () => {
      if (!surface || lost) return;
      const s = settingsRef.current;
      syncPalette(s);
      syncBase(s);
      syncField();
      const u = surface.uniforms;
      const r = state.ratio;
      const spread = s.radius;
      const unit = state.unit;
      const hand = state.hand;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(surface.program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.uniform1i(u.uField, 0);
      gl.uniform1i(u.uPalette, 1);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform3f(u.uBase, state.base[0], state.base[1], state.base[2]);
      gl.uniform1f(u.uGain, state.gain);
      const grow = state.grow;
      gl.uniform1f(u.uGrow, grow * grow * (3 - 2 * grow));
      gl.uniform3f(u.uHand, hand.x * r, canvas.height - hand.y * r, hand.power);
      gl.uniform3f(
        u.uRadii,
        (60 + s.heat * 50) * unit * spread,
        (95 + s.heat * 55) * unit * spread,
        62 * unit * spread
      );
      gl.uniform1f(u.uCool, 0.35 + s.heat * 0.55);
      gl.uniform1f(u.uSwell, 0.75 * s.swell);
      gl.uniform1f(u.uLit, s.idle === 'lit' ? 1 : 0);
      const flare = state.flare;
      const flareWidth = 70 * unit;
      if (flare) {
        const [cx, cy, bw, bh] = state.box;
        const fx = flare.x * r;
        const fy = flare.y * r;
        const reach =
          Math.max(
            Math.hypot(fx - (cx - bw / 2), fy - (cy - bh / 2)),
            Math.hypot(fx - (cx + bw / 2), fy - (cy - bh / 2)),
            Math.hypot(fx - (cx - bw / 2), fy - (cy + bh / 2)),
            Math.hypot(fx - (cx + bw / 2), fy - (cy + bh / 2))
          ) +
          flareWidth * 1.5;
        const lead = clamp(flare.age / FLARE_LEAD, 0, 1);
        const trail = clamp((flare.age - FLARE_HOLD) / (FLARE_SECONDS - FLARE_HOLD), 0, 1);
        const leadFront = reach * (1 - (1 - lead) * (1 - lead)) - flareWidth;
        const trailFront = trail > 0 ? reach * trail * trail * (3 - 2 * trail) - flareWidth : -1e6;
        gl.uniform4f(u.uFlare, fx, canvas.height - fy, Math.max(leadFront, 0.001), trailFront);
      } else {
        gl.uniform4f(u.uFlare, 0, 0, 0, 0);
      }
      gl.uniform1f(u.uFlareWidth, flareWidth);
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      container.classList.add('e2NeonActive');
      gl.bindVertexArray(null);
    };

    const resize = () => {
      const s = settingsRef.current;
      const css = getComputedStyle(text);
      s.fontSize = parseFloat(css.fontSize); s.letterSpacing = parseFloat(css.letterSpacing) || 0;
      s.textWidth = text.getBoundingClientRect().width;
      // Match native line wrapping and baseline, including Chinese and zoomed text.
      const origin = container.getBoundingClientRect();
      s.lines = [];
      const range = document.createRange(), node = text.firstChild;
      let offset = 0;
      for (const char of node.textContent) {
        range.setStart(node, offset); offset += char.length; range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        let line = s.lines[s.lines.length - 1];
        if (!line || Math.abs(line.y - (rect.top - origin.top)) > 2) {
          line = {text: '', x: rect.left - origin.left, y: rect.top - origin.top, height: rect.height};
          s.lines.push(line);
        }
        line.text += char;
      }
      const width = s.cssWidth = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const base = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
      const longest = Math.max(width, height) * base;
      const ratio = longest > MAX_RENDER_DIM ? (base * MAX_RENDER_DIM) / longest : base;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      state.width = width;
      state.height = height;
      state.ratio = pixelHeight / height;
      render();
    };

    const ready = () => {
      if (surface) return true;
      if (!job || !parallel || !gl.getProgramParameter(job.program, parallel.COMPLETION_STATUS_KHR)) return false;
      surface = finishProgram(gl, job);
      job = null;
      return Boolean(surface);
    };

    const driftTarget = () => {
      const [cx, cy, bw, bh] = state.box;
      const r = state.ratio || 1;
      const t = state.drift;
      return {
        x: (cx + Math.sin(t * 0.53) * bw * 0.42 + Math.sin(t * 1.31 + 1.7) * bw * 0.06) / r,
        y: (cy + Math.sin(t * 0.79 + 0.6) * bh * 0.32) / r
      };
    };

    const frame = now => {
      raf = 0;
      if (!alive || !visible || document.hidden || lost) return;
      if (!ready()) {
        if (job) raf = requestAnimationFrame(frame);
        return;
      }
      const s = settingsRef.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (state.growing) {
        state.grow = Math.min(1, state.grow + dt / GROW_SECONDS);
        if (state.grow >= 1) state.growing = false;
      }
      const hand = state.hand;
      const pointer = state.pointer;
      const hovering = s.interactive && pointer.inside;
      const drifting = !hovering && s.idle === 'drift' && !reduce && Boolean(state.shape);
      let want = 0;
      if (hovering) {
        hand.tx = pointer.x;
        hand.ty = pointer.y;
        state.anchor = { x: hand.x, y: hand.y };
        state.release = 0;
        want = 1;
      } else if (drifting) {
        state.drift += dt * s.speed;
        state.release = Math.min(1, state.release + dt / 1.4);
        const spot = driftTarget();
        const blend = state.release * state.release * (3 - 2 * state.release);
        const from = state.anchor || spot;
        hand.tx = from.x + (spot.x - from.x) * blend;
        hand.ty = from.y + (spot.y - from.y) * blend;
        want = state.grow;
      }
      if (!hand.placed && want) {
        hand.x = hand.tx;
        hand.y = hand.ty;
        hand.placed = true;
      }
      const follow = 1 - Math.pow(0.002, dt);
      hand.x += (hand.tx - hand.x) * follow;
      hand.y += (hand.ty - hand.y) * follow;
      hand.power += (want - hand.power) * (1 - Math.pow(0.01, dt));
      if (!want && hand.power < 0.004) {
        hand.power = 0;
        hand.placed = false;
      }
      if (state.flare) {
        state.flare.age += dt;
        if (state.flare.age >= FLARE_SECONDS) state.flare = null;
      }
      render();
      const settling =
        state.growing ||
        Math.abs(want - hand.power) > 0.004 ||
        Math.abs(hand.tx - hand.x) > 0.05 ||
        Math.abs(hand.ty - hand.y) > 0.05 ||
        Boolean(state.flare) ||
        drifting;
      if (settling) raf = requestAnimationFrame(frame);
      else { last = 0; container.classList.remove('e2NeonActive'); }
    };

    const wake = () => {
      if (!raf && alive && visible && !document.hidden && !lost) raf = requestAnimationFrame(frame);
    };

    const adopt = next => {
      if (!next || next === state.shape) return;
      const first = !state.shown;
      state.shape = next;
      state.shown = true;
      const animate = !reduce && (first ? settingsRef.current.intro : true);
      state.grow = animate ? 0 : 1;
      state.growing = animate;
    };

    const locate = event => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
    };

    const onPointerMove = event => {
      if (!fine.matches || event.pointerType === 'touch') return;
      const spot = locate(event);
      state.pointer.x = spot.x;
      state.pointer.y = spot.y;
      state.pointer.inside = spot.inside;
      wake();
    };

    const onPointerDown = event => {
      const s = settingsRef.current;
      if (!s.interactive || !s.igniteOnClick || event.button !== 0 || reduce) return;
      const spot = locate(event);
      if (!spot.inside) return;
      state.flare = { x: spot.x, y: spot.y, age: 0 };
      wake();
    };

    const onPointerLeave = () => {
      state.pointer.inside = false;
      wake();
    };

    const onVisibility = () => {
      last = 0;
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; container.classList.remove('e2NeonActive'); }
      else wake();
    };

    const onLost = event => {
      event.preventDefault();
      lost = true;
      container.classList.remove('e2NeonActive');
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onRestored = () => { cleanup(); };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) { last = 0; wake(); }
      else { cancelAnimationFrame(raf); raf = 0; container.classList.remove('e2NeonActive'); }
    });
    intersection.observe(container);
    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    adopt(shapeRef.current);
    resize();
    state.flare = {x: 16, y: state.height / 2, age: 0};
    wake();
    wakeRef.current = next => {
      adopt(next);
      if (!raf) render();
      wake();
    };

    const cleanup = () => {
      alive = false;
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      resizeObserver.disconnect();
      intersection.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (!gl.isContextLost()) {
        gl.deleteVertexArray(vao);
        gl.deleteTexture(fieldTexture);
        gl.deleteTexture(paletteTexture);
        if (surface) gl.deleteProgram(surface.program);
        const release = () => {
          if (!job || gl.isContextLost()) return;
          if (parallel && !gl.getProgramParameter(job.program, parallel.COMPLETION_STATUS_KHR)) {
            requestAnimationFrame(release);
            return;
          }
          gl.deleteShader(job.vertex);
          gl.deleteShader(job.fragment);
          gl.deleteProgram(job.program);
          job = null;
        };
        release();
      }
      canvas.remove(); container.classList.remove('e2NeonActive');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    return cleanup;
}
