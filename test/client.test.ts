import { describe, expect, it } from 'vitest';
import { parseProgressHtml, unwrapUpdate } from '../src/fooocus/client.js';
import { decodeCustomId, encodeCustomId } from '../src/discord/buttons.js';
import { progressBar, truncate } from '../src/discord/render.js';
import { parseStyles, resolveModel } from '../src/discord/options.js';

describe('unwrapUpdate', () => {
  it('returns the value of update objects and passes other values through', () => {
    expect(unwrapUpdate({ __type__: 'update', value: 'x', visible: true })).toBe('x');
    expect(unwrapUpdate({ __type__: 'update', visible: false })).toBeUndefined();
    expect(unwrapUpdate('plain')).toBe('plain');
    expect(unwrapUpdate(null)).toBeNull();
  });
});

describe('parseProgressHtml', () => {
  it('extracts percent and text', () => {
    const html =
      '<div class="loader-container"><div class="loader"></div><div class="progress-container"><progress value="37" max="100"></progress></div><span>Sampling step 10/30, image 1/1 ...</span></div>';
    expect(parseProgressHtml(html)).toEqual({ percent: 37, text: 'Sampling step 10/30, image 1/1 ...' });
    expect(parseProgressHtml(undefined)).toBeUndefined();
  });
});

describe('custom ids', () => {
  it('round-trips', () => {
    const id = encodeCustomId('up15', 'abc123', 2);
    expect(id.length).toBeLessThan(100);
    expect(decodeCustomId(id)).toEqual({ action: 'up15', jobId: 'abc123', index: 2 });
    expect(decodeCustomId('other|x')).toBeUndefined();
  });
});

describe('render helpers', () => {
  it('truncates and draws bars', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(progressBar(50, 10)).toBe('▰▰▰▰▰▱▱▱▱▱ 50%');
  });
});

describe('option parsing', () => {
  const styles = ['Fooocus V2', 'Fooocus Enhance', 'SAI Anime'];
  it('parses comma separated styles case-insensitively', () => {
    expect(parseStyles('fooocus v2, SAI Anime,', styles)).toEqual(['Fooocus V2', 'SAI Anime']);
    expect(() => parseStyles('Nope', styles)).toThrow(/Nope/);
  });
  it('resolves models by partial name and respects the allow list', () => {
    const models = ['juggernautXL_v8Rundiffusion.safetensors', 'animaPencilXL_v500.safetensors'];
    expect(resolveModel('anima', models, null)).toBe('animaPencilXL_v500.safetensors');
    expect(resolveModel('juggernautXL_v8Rundiffusion', models, null)).toBe('juggernautXL_v8Rundiffusion.safetensors');
    expect(() => resolveModel('anima', models, ['juggernautXL_v8Rundiffusion.safetensors'])).toThrow();
  });
});
