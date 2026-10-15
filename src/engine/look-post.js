// The post-processing stack behind engine.look (you normally use look.set(), not this file).
// Order: scene → ambient occlusion → bloom → outline → tone mapping/sRGB → grade → anti-aliasing.
// Passes that are switched off are skipped entirely, so they cost nothing.
//
//   const post = createPost({ renderer, scene, camera, hide: [skyMesh] });
//   post.configure({ bloom, ao, grade, vignette, grain, aberration, tiltShift }, QUALITY.high)
//   post.render(dt)          post.setSize(w, h)          post.outline([mesh], '#ffd166')
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// One pass for all the "camera lens" looks; each part is skipped when its amount is 0.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    saturation: { value: 1 },
    contrast: { value: 1 },
    brightness: { value: 0 },
    tint: { value: new THREE.Color(1, 1, 1) },
    shadowTint: { value: new THREE.Color(0, 0, 0) },
    vignette: { value: 0 },
    grain: { value: 0 },
    aberration: { value: 0 },
    tiltShift: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time, saturation, contrast, brightness, vignette, grain, aberration, tiltShift;
    uniform vec3 tint, shadowTint;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (tiltShift > 0.0) {
        // diorama blur: sharp band in the middle, blurrier towards top and bottom
        float b = smoothstep(0.12, 0.5, abs(uv.y - 0.5)) * tiltShift * 14.0;
        if (b > 0.01) {
          vec3 acc = c; float n = 1.0;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.39996; float r = sqrt(float(i) + 0.5) / 3.5;
            acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r * b / resolution).rgb; n += 1.0;
          }
          c = acc / n;
        }
      }
      if (aberration > 0.0) {
        vec2 off = (uv - 0.5) * aberration * 0.012;
        c.r = texture2D(tDiffuse, uv + off).r;
        c.b = texture2D(tDiffuse, uv - off).b;
      }
      c += brightness;
      c = (c - 0.5) * contrast + 0.5;
      float l = luma(c);
      c = mix(vec3(l), c, saturation);
      c *= tint;
      // shadows keep their colour: lift the darks toward a tint instead of grey
      c += shadowTint * pow(1.0 - clamp(l, 0.0, 1.0), 3.0);
      if (vignette > 0.0) {
        float d = length((uv - 0.5) * vec2(resolution.x / resolution.y, 1.0));
        c *= mix(1.0, smoothstep(1.05, 0.25, d), vignette);
      }
      if (grain > 0.0) {
        float g = fract(sin(dot(uv * resolution + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        c += g * grain * 0.12;
      }
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function createPost({ renderer, scene, camera, hide = [] }) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.updateGtaoMaterial({ radius: 0.5, distanceFallOff: 1, thickness: 1, samples: 12 });
  ao.updatePdMaterial({ samples: 8, rings: 2, radius: 6 });
  let aoScale = 1;
  const aoSetSize = ao.setSize.bind(ao);
  ao.setSize = (w, h) => aoSetSize(Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale))); // half-res AO on medium
  const bloom = new UnrealBloomPass(size.clone(), 0.4, 0.5, 1);
  const outline = new OutlinePass(size.clone(), scene, camera);
  Object.assign(outline, { edgeStrength: 4, edgeThickness: 1.5, edgeGlow: 0.4 });
  outline.hiddenEdgeColor.set('#000000');
  outline.enabled = false; // until something is selected
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  const fxaa = new FXAAPass();
  const smaa = new SMAAPass();
  // the sky dome is drawn "at infinity" by its own shader; with the override materials these
  // passes use it would become a small ball at the origin, so hide it from them. Sprites and
  // see-through things that don't write depth (glows, particles, halos) would turn into solid
  // squares in those override renders, so they are hidden too.
  const seeThrough = (o) =>
    o.visible && (o.isSprite || o.isPoints || (o.material && !Array.isArray(o.material) && o.material.transparent && !o.material.depthWrite));
  for (const pass of [ao, outline]) {
    const render = pass.render.bind(pass);
    pass.render = (...args) => {
      const shown = hide.filter((o) => o.visible);
      scene.traverseVisible((o) => seeThrough(o) && shown.push(o));
      for (const o of shown) o.visible = false;
      render(...args);
      for (const o of shown) o.visible = true;
    };
  }
  const passes = [renderPass, ao, bloom, outline, output, grade, fxaa, smaa];
  for (const p of passes) composer.addPass(p);

  const u = grade.uniforms;
  let msaa = -1;

  return {
    composer,
    passes: { render: renderPass, ao, bloom, outline, output, grade, fxaa, smaa },

    /** Switch passes on/off and copy settings into them. `q` is a QUALITY level object. */
    configure(look, q) {
      ao.enabled = !!look.ao && q.ao > 0;
      if (ao.enabled) {
        ao.blendIntensity = look.ao.intensity ?? 1;
        ao.updateGtaoMaterial({ radius: look.ao.radius ?? 0.5 });
        if (aoScale !== q.ao) {
          aoScale = q.ao;
          ao.setSize(composer.renderTarget1.width, composer.renderTarget1.height);
        }
      }
      bloom.enabled = !!look.bloom && look.bloom.strength > 0;
      if (bloom.enabled) Object.assign(bloom, { strength: look.bloom.strength, radius: look.bloom.radius ?? 0.5, threshold: look.bloom.threshold ?? 1 });

      const g = look.grade || {};
      u.saturation.value = g.saturation ?? 1;
      u.contrast.value = g.contrast ?? 1;
      u.brightness.value = g.brightness ?? 0;
      // tint is normalised to keep brightness, then blended in by tintAmount
      const t = new THREE.Color(g.tint ?? '#ffffff');
      const tl = Math.max(0.001, 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b);
      u.tint.value.setRGB(1, 1, 1).lerp(t.multiplyScalar(1 / tl), g.tintAmount ?? (g.tint ? 0.3 : 0));
      u.shadowTint.value.set(g.shadows ?? '#000000').multiplyScalar(0.6);
      u.vignette.value = look.vignette || 0;
      u.grain.value = look.grain || 0;
      u.aberration.value = look.aberration || 0;
      u.tiltShift.value = look.tiltShift || 0;
      grade.enabled = !!(look.grade || look.vignette || look.grain || look.aberration || look.tiltShift);

      const aa = look.aa ?? q.aa;
      fxaa.enabled = aa === 'fxaa';
      smaa.enabled = aa === 'smaa';
      const samples = aa === 'msaa' ? q.msaa || 4 : 0;
      if (samples !== msaa) {
        msaa = samples;
        composer.renderTarget1.samples = composer.renderTarget2.samples = samples;
        composer.renderTarget1.dispose(); // re-create with the new sample count
        composer.renderTarget2.dispose();
      }
    },

    /** Highlight objects with a glowing outline (empty array or null = none). */
    outline(objects, color = '#ffd166') {
      outline.selectedObjects = objects ? [].concat(objects) : [];
      outline.visibleEdgeColor.set(color);
      outline.enabled = outline.selectedObjects.length > 0; // the mask render only runs when needed
    },

    render(dt) {
      u.time.value += dt;
      composer.render(dt);
    },

    setSize(w, h) {
      composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      u.resolution.value.set(w * pr, h * pr);
    },
  };
}
