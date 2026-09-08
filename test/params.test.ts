import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GradioConfig } from '../src/fooocus/gradio-config.js';
import { resolveEndpoints } from '../src/fooocus/gradio-config.js';
import { CtrlLayout, parseAspectLabel } from '../src/fooocus/params.js';

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'config.json'), 'utf8')) as GradioConfig;
const endpoints = resolveEndpoints(fixture);
const layout = new CtrlLayout(fixture, fixture.dependencies[endpoints.getTask]!.inputs);
const png = 'data:image/png;base64,AAAA';

describe('resolveEndpoints', () => {
  it('finds the generate chain, stop, describe and mask functions', () => {
    expect(endpoints).toEqual({ stateId: 1, getTask: 67, generate: 68, stop: 0, describe: 74, mask: 60 });
    expect(fixture.dependencies[endpoints.getTask]!.inputs).toHaveLength(153);
  });
});

describe('CtrlLayout', () => {
  it('resolves the known ctrl positions', () => {
    const idx = layout.indexes;
    expect(idx.prompt).toBe(1);
    expect(idx.negativePrompt).toBe(2);
    expect(idx.styles).toBe(3);
    expect(idx.aspect).toBe(5);
    expect(idx.seed).toBe(8);
    expect(idx.baseModel).toBe(12);
    expect(idx.loras.map((slot) => slot.name)).toEqual([16, 19, 22, 25, 28]);
    expect(idx.inputImageCheckbox).toBe(30);
    expect(idx.currentTab).toBe(31);
    expect(idx.uovMethod).toBe(32);
    expect(idx.uovImage).toBe(33);
    expect(idx.outpaintDirections).toBe(34);
    expect(idx.inpaintImage).toBe(35);
    expect(idx.inpaintEngine).toBe(71);
    expect(idx.saveMetadata).toBe(78);
    expect(idx.cn.map((slot) => slot.image)).toEqual([80, 84, 88, 92]);
    expect(idx.enhanceCheckbox).toBe(100);
  });

  it('reads capabilities from component choices', () => {
    const caps = layout.capabilities;
    expect(caps.models).toContain('juggernautXL_v8Rundiffusion.safetensors');
    expect(caps.loras).toHaveLength(2);
    expect(caps.styles.length).toBeGreaterThan(100);
    expect(caps.aspectRatios).toHaveLength(26);
    expect(caps.defaults.aspect).toBe('1152*896');
    expect(caps.performances).toEqual(['Quality', 'Speed', 'Extreme Speed', 'Lightning', 'Hyper-SD']);
  });

  it('builds txt2img data with verbatim aspect labels', () => {
    const data = layout.buildData({ mode: 'txt2img', prompt: 'a cat', aspect: '1024*1024', imageNumber: 3 }, '42');
    expect(data).toHaveLength(152);
    expect(data[1]).toBe('a cat');
    expect(data[5]).toBe('1024×1024 <span style="color: grey;"> ∣ 1:1</span>');
    expect(data[6]).toBe(3);
    expect(data[8]).toBe('42');
    expect(data[30]).toBe(false);
    expect(data[31]).toBe('uov');
    expect(data[38]).toBe(false);
    expect(data[78]).toBe(true);
  });

  it('rejects unknown aspect ratios', () => {
    expect(() => layout.buildData({ mode: 'txt2img', prompt: 'x', aspect: '123*456' }, '1')).toThrow(/123\*456/);
  });

  it('fills a free lora slot without touching preset loras', () => {
    const data = layout.buildData(
      { mode: 'txt2img', prompt: 'x', loras: [{ name: 'FurryDalleSDXL-000006.safetensors', weight: 0.7 }] },
      '1',
    );
    expect(data[16]).toBe('sd_xl_offset_example-lora_1.0.safetensors');
    expect(data[19]).toBe('FurryDalleSDXL-000006.safetensors');
    expect(data[20]).toBe(0.7);
  });

  it('clears preset loras when asked and still applies requested ones', () => {
    const data = layout.buildData(
      {
        mode: 'txt2img',
        prompt: 'x',
        clearPresetLoras: true,
        loras: [{ name: 'FurryDalleSDXL-000006.safetensors', weight: 0.5 }],
      },
      '1',
    );
    expect(data.slice(15, 18)).toEqual([true, 'FurryDalleSDXL-000006.safetensors', 0.5]);
    expect(data.slice(18, 21)).toEqual([false, 'None', 1]);
  });

  it('builds vary/upscale data', () => {
    const data = layout.buildData({ mode: 'uov', prompt: 'x', image: png, method: 'Upscale (2x)' }, '1');
    expect(data[30]).toBe(true);
    expect(data[31]).toBe('uov');
    expect(data[32]).toBe('Upscale (2x)');
    expect(data[33]).toBe(png);
  });

  it('builds outpaint data with a non-null mask and default inpaint ctrls', () => {
    const mask = 'data:image/png;base64,BBBB';
    const data = layout.buildData(
      { mode: 'outpaint', prompt: 'x', image: png, mask, directions: ['Left', 'Right', 'Top', 'Bottom'] },
      '1',
    );
    expect(data[31]).toBe('inpaint');
    expect(data[34]).toEqual(['Left', 'Right', 'Top', 'Bottom']);
    expect(data[35]).toEqual({ image: png, mask });
    expect(data.slice(70, 74)).toEqual([false, 'v2.6', 1.0, 0.618]);
  });

  it('applies the inpaint mode table', () => {
    const detail = layout.buildData(
      { mode: 'inpaint', prompt: 'x', image: png, mask: png, inpaintMode: 'detail' },
      '1',
    );
    expect(detail.slice(70, 74)).toEqual([false, 'None', 0.5, 0.0]);
    const modify = layout.buildData(
      { mode: 'inpaint', prompt: 'x', image: png, mask: png, inpaintMode: 'modify', additionalPrompt: 'hat' },
      '1',
    );
    expect(modify.slice(70, 74)).toEqual([true, 'v2.6', 1.0, 0.0]);
    expect(modify[36]).toBe('hat');
  });

  it('fills image prompt slots with per-type defaults', () => {
    const data = layout.buildData(
      {
        mode: 'imageprompt',
        prompt: '',
        images: [
          { image: png, type: 'FaceSwap' },
          { image: png, type: 'PyraCanny', weight: 0.5 },
        ],
      },
      '1',
    );
    expect(data[31]).toBe('ip');
    expect(data.slice(80, 84)).toEqual([png, 0.9, 0.75, 'FaceSwap']);
    expect(data.slice(84, 88)).toEqual([png, 0.5, 0.5, 'PyraCanny']);
    expect(data[88]).toBeNull();
  });
});

describe('parseAspectLabel', () => {
  it('extracts width and height', () => {
    expect(parseAspectLabel('1152×896 <span style="color: grey;"> ∣ 9:7</span>')).toMatchObject({
      raw: '1152*896',
      width: 1152,
      height: 896,
    });
    expect(parseAspectLabel('nonsense')).toBeUndefined();
  });
});
