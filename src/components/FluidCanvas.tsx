import { useEffect, useRef } from "react";

// Compact WebGL fluid simulation (semi-Lagrangian advection + Jacobi pressure).
// Mouse motion injects velocity and dye color.
export function FluidCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const ext = {
      halfFloat: gl.getExtension("OES_texture_half_float"),
      halfFloatLinear: gl.getExtension("OES_texture_half_float_linear"),
    };
    const HALF_FLOAT = ext.halfFloat ? ext.halfFloat.HALF_FLOAT_OES : gl.FLOAT;
    const filtering = ext.halfFloatLinear ? gl.LINEAR : gl.NEAREST;

    // ---------- shaders ----------
    const baseVert = `
      attribute vec2 aPos;
      varying vec2 vUv;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform vec2 uTexel;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        vL = vUv - vec2(uTexel.x, 0.0);
        vR = vUv + vec2(uTexel.x, 0.0);
        vT = vUv + vec2(0.0, uTexel.y);
        vB = vUv - vec2(0.0, uTexel.y);
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    const displayFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      void main() {
        vec3 c = texture2D(uTex, vUv).rgb;
        // subtle vignette
        float d = distance(vUv, vec2(0.5));
        c *= smoothstep(0.95, 0.25, d) * 0.85 + 0.25;
        gl_FragColor = vec4(c, 1.0);
      }
    `;

    const splatFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float uAspect;
      uniform vec3 uColor;
      uniform vec2 uPoint;
      uniform float uRadius;
      void main() {
        vec2 p = vUv - uPoint;
        p.x *= uAspect;
        vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `;

    const advectionFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      uniform float uDt;
      uniform float uDissipation;
      void main() {
        vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;
        gl_FragColor = uDissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
      }
    `;

    const divergenceFrag = `
      precision highp float;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `;

    const curlFrag = `
      precision highp float;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `;

    const vorticityFrag = `
      precision highp float;
      varying vec2 vUv;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float uCurlAmount;
      uniform float uDt;
      void main() {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= uCurlAmount * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
      }
    `;

    const pressureFrag = `
      precision highp float;
      varying vec2 vUv;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float div = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - div) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `;

    const gradientSubtractFrag = `
      precision highp float;
      varying vec2 vUv;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vel -= vec2(R - L, T - B);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `;

    function compile(type: number, src: string) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    }
    function program(vert: string, frag: string) {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(p));
      }
      const uniforms: Record<string, WebGLUniformLocation> = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i)!;
        uniforms[info.name] = gl.getUniformLocation(p, info.name)!;
      }
      return { program: p, uniforms };
    }

    const displayProg = program(baseVert, displayFrag);
    const splatProg = program(baseVert, splatFrag);
    const advectionProg = program(baseVert, advectionFrag);
    const divergenceProg = program(baseVert, divergenceFrag);
    const curlProg = program(baseVert, curlFrag);
    const vorticityProg = program(baseVert, vorticityFrag);
    const pressureProg = program(baseVert, pressureFrag);
    const gradientProg = program(baseVert, gradientSubtractFrag);

    // fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function createFBO(w: number, h: number, internal: number, format: number, type: number, filter: number) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h, texel: [1 / w, 1 / h] as [number, number] };
    }
    function createDouble(w: number, h: number, internal: number, format: number, type: number, filter: number) {
      let a = createFBO(w, h, internal, format, type, filter);
      let b = createFBO(w, h, internal, format, type, filter);
      return {
        get read() { return a; },
        get write() { return b; },
        swap() { const t = a; a = b; b = t; },
        w, h,
      };
    }

    let dye: ReturnType<typeof createDouble>;
    let velocity: ReturnType<typeof createDouble>;
    let divergence: ReturnType<typeof createFBO>;
    let curlFBO: ReturnType<typeof createFBO>;
    let pressure: ReturnType<typeof createDouble>;

    let simW = 0, simH = 0, dyeW = 0, dyeH = 0;

    function initFBOs() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      canvas.width = w;
      canvas.height = h;

      const SIM_RES = 128;
      const DYE_RES = 512;
      const aspect = w / h;
      simW = aspect >= 1 ? Math.round(SIM_RES * aspect) : SIM_RES;
      simH = aspect >= 1 ? SIM_RES : Math.round(SIM_RES / aspect);
      dyeW = aspect >= 1 ? Math.round(DYE_RES * aspect) : DYE_RES;
      dyeH = aspect >= 1 ? DYE_RES : Math.round(DYE_RES / aspect);

      dye = createDouble(dyeW, dyeH, gl.RGBA, gl.RGBA, HALF_FLOAT, filtering);
      velocity = createDouble(simW, simH, gl.RGBA, gl.RGBA, HALF_FLOAT, filtering);
      divergence = createFBO(simW, simH, gl.RGBA, gl.RGBA, HALF_FLOAT, gl.NEAREST);
      curlFBO = createFBO(simW, simH, gl.RGBA, gl.RGBA, HALF_FLOAT, gl.NEAREST);
      pressure = createDouble(simW, simH, gl.RGBA, gl.RGBA, HALF_FLOAT, gl.NEAREST);
    }
    initFBOs();
    const ro = new ResizeObserver(() => initFBOs());
    ro.observe(canvas);

    function blit(target: { fbo: WebGLFramebuffer | null; w: number; h: number } | null) {
      if (target) {
        gl.viewport(0, 0, target.w, target.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      } else {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---------- pointer ----------
    type Pointer = { x: number; y: number; dx: number; dy: number; down: boolean; moved: boolean; color: [number, number, number] };
    const pointer: Pointer = { x: 0.5, y: 0.5, dx: 0, dy: 0, down: false, moved: false, color: [0.4, 0.7, 1.2] };

    function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        default: return [v, p, q];
      }
    }
    function pickColor() {
      // Cool tech palette: cyan/violet/magenta range
      const h = 0.55 + Math.random() * 0.35;
      return hsvToRgb(h, 0.9, 1.0).map((c) => c * 0.18) as [number, number, number];
    }

    const updatePointer = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (x - rect.left) / rect.width;
      const ny = 1.0 - (y - rect.top) / rect.height;
      pointer.dx = (nx - pointer.x) * 8;
      pointer.dy = (ny - pointer.y) * 8;
      pointer.x = nx;
      pointer.y = ny;
      pointer.moved = Math.abs(pointer.dx) > 0 || Math.abs(pointer.dy) > 0;
    };

    const onMove = (e: PointerEvent) => {
      if (!pointer.moved) pointer.color = pickColor();
      updatePointer(e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      pointer.down = true;
      pointer.color = pickColor();
      updatePointer(e.clientX, e.clientY);
    };
    const onUp = () => { pointer.down = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    function splat(x: number, y: number, dx: number, dy: number, color: [number, number, number]) {
      const aspect = canvas.width / canvas.height;
      // velocity splat
      gl.useProgram(splatProg.program);
      gl.uniform1i(splatProg.uniforms["uTarget"], 0);
      gl.uniform1f(splatProg.uniforms["uAspect"], aspect);
      gl.uniform2f(splatProg.uniforms["uPoint"], x, y);
      gl.uniform3f(splatProg.uniforms["uColor"], dx, dy, 0);
      gl.uniform1f(splatProg.uniforms["uRadius"], 0.0002);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      // dye splat
      gl.uniform3f(splatProg.uniforms["uColor"], color[0], color[1], color[2]);
      gl.uniform1f(splatProg.uniforms["uRadius"], 0.0003);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dye.read.tex);
      blit(dye.write);
      dye.swap();
    }

    let last = performance.now();
    let rafId = 0;
    let autoT = 0;

    function step(now: number) {
      const dt = Math.min((now - last) / 1000, 0.016);
      last = now;
      autoT += dt;

      // Inject from pointer
      if (pointer.moved) {
        splat(pointer.x, pointer.y, pointer.dx * 1500, pointer.dy * 1500, pointer.color);
        pointer.moved = false;
        pointer.dx *= 0.5;
        pointer.dy *= 0.5;
      } else if (autoT > 1.6) {
        // ambient drift so the canvas isn't dead before interaction
        autoT = 0;
        const ax = 0.2 + Math.random() * 0.6;
        const ay = 0.2 + Math.random() * 0.6;
        const adx = (Math.random() - 0.5) * 800;
        const ady = (Math.random() - 0.5) * 800;
        splat(ax, ay, adx, ady, pickColor());
      }

      // curl
      gl.useProgram(curlProg.program);
      gl.uniform2f(curlProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(curlProg.uniforms["uVelocity"], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      blit(curlFBO);

      // vorticity confinement
      gl.useProgram(vorticityProg.program);
      gl.uniform2f(vorticityProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(vorticityProg.uniforms["uVelocity"], 0);
      gl.uniform1i(vorticityProg.uniforms["uCurl"], 1);
      gl.uniform1f(vorticityProg.uniforms["uCurlAmount"], 30);
      gl.uniform1f(vorticityProg.uniforms["uDt"], dt);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, curlFBO.tex);
      blit(velocity.write); velocity.swap();

      // divergence
      gl.useProgram(divergenceProg.program);
      gl.uniform2f(divergenceProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(divergenceProg.uniforms["uVelocity"], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      blit(divergence);

      // clear pressure (decay)
      gl.useProgram(displayProg.program);
      // pressure jacobi
      gl.useProgram(pressureProg.program);
      gl.uniform2f(pressureProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(pressureProg.uniforms["uDivergence"], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, divergence.tex);
      for (let i = 0; i < 20; i++) {
        gl.uniform1i(pressureProg.uniforms["uPressure"], 1);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pressure.read.tex);
        blit(pressure.write); pressure.swap();
      }

      // gradient subtract
      gl.useProgram(gradientProg.program);
      gl.uniform2f(gradientProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(gradientProg.uniforms["uPressure"], 0);
      gl.uniform1i(gradientProg.uniforms["uVelocity"], 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pressure.read.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      blit(velocity.write); velocity.swap();

      // advect velocity
      gl.useProgram(advectionProg.program);
      gl.uniform2f(advectionProg.uniforms["uTexel"], velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1i(advectionProg.uniforms["uVelocity"], 0);
      gl.uniform1i(advectionProg.uniforms["uSource"], 0);
      gl.uniform1f(advectionProg.uniforms["uDt"], dt);
      gl.uniform1f(advectionProg.uniforms["uDissipation"], 0.998);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      blit(velocity.write); velocity.swap();

      // advect dye
      gl.uniform2f(advectionProg.uniforms["uTexel"], dye.read.texel[0], dye.read.texel[1]);
      gl.uniform1i(advectionProg.uniforms["uVelocity"], 0);
      gl.uniform1i(advectionProg.uniforms["uSource"], 1);
      gl.uniform1f(advectionProg.uniforms["uDissipation"], 0.992);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dye.read.tex);
      blit(dye.write); dye.swap();

      // display
      gl.useProgram(displayProg.program);
      gl.uniform1i(displayProg.uniforms["uTex"], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dye.read.tex);
      blit(null);

      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full"
      style={{ touchAction: "none", background: "#000" }}
    />
  );
}
