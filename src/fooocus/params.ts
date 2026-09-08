import type { GradioComponent, GradioConfig } from './gradio-config.js';
import { componentIndex, describeComponent } from './gradio-config.js';
import type { AspectRatio, CnType, FooocusCapabilities, GenerationRequest, InpaintMode } from './types.js';
import { LayoutError } from './types.js';

type Predicate = (component: GradioComponent) => boolean;

export interface LoraSlots {
  enabled: number;
  name: number;
  weight: number;
}

export interface CnSlots {
  image: number;
  stop: number;
  weight: number;
  type: number;
}

export interface CtrlIndexes {
  grid: number;
  prompt: number;
  negativePrompt: number;
  styles: number;
  performance: number;
  aspect: number;
  imageNumber: number;
  outputFormat: number;
  seed: number;
  sharpness: number;
  cfgScale: number;
  baseModel: number;
  refiner: number;
  refinerSwitch: number;
  loras: LoraSlots[];
  inputImageCheckbox: number;
  currentTab: number;
  uovMethod: number;
  uovImage: number;
  outpaintDirections: number;
  inpaintImage: number;
  inpaintAdditionalPrompt: number;
  inpaintMaskUpload: number;
  disablePreview: number;
  disableIntermediateResults: number;
  disableSeedIncrement: number;
  sampler: number;
  scheduler: number;
  mixingImagePromptAndVaryUpscale: number;
  mixingImagePromptAndInpaint: number;
  inpaintDisableInitialLatent: number;
  inpaintEngine: number;
  inpaintStrength: number;
  inpaintRespectiveField: number;
  inpaintAdvancedMasking: number;
  invertMask: number;
  inpaintErodeOrDilate: number;
  saveMetadata: number | undefined;
  cn: CnSlots[];
  enhanceCheckbox: number;
}

export const cnDefaults: Record<CnType, { stop: number; weight: number }> = {
  ImagePrompt: { stop: 0.5, weight: 0.6 },
  FaceSwap: { stop: 0.9, weight: 0.75 },
  PyraCanny: { stop: 0.5, weight: 1.0 },
  CPDS: { stop: 0.5, weight: 1.0 },
};

export function choiceValues(component: GradioComponent | undefined): string[] {
  const choices = component?.props.choices ?? [];
  return choices.map((choice) => (Array.isArray(choice) ? String(choice[choice.length - 1]) : String(choice)));
}

export function parseAspectLabel(label: string): AspectRatio | undefined {
  const match = /^(\d+)×(\d+)/.exec(label);
  if (!match) {
    return undefined;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { raw: `${width}*${height}`, width, height, label };
}

export class CtrlLayout {
  readonly ctrlIds: number[];
  readonly components: GradioComponent[];
  readonly indexes: CtrlIndexes;
  readonly capabilities: FooocusCapabilities;
  private readonly defaults: unknown[];

  constructor(config: GradioConfig, getTaskInputs: number[]) {
    const byId = componentIndex(config);
    this.ctrlIds = getTaskInputs.slice(1);
    this.components = this.ctrlIds.map((id) => {
      const component = byId.get(id);
      if (!component) {
        throw new LayoutError(`ctrl component ${id} missing from /config`);
      }
      return component;
    });
    this.defaults = this.components.map((component) => structuredClone(component.props.value ?? null));
    this.indexes = this.resolveIndexes();
    this.capabilities = this.readCapabilities();
  }

  private find(name: string, predicate: Predicate, from = 0): number {
    for (let index = from; index < this.components.length; index += 1) {
      if (predicate(this.components[index]!)) {
        return index;
      }
    }
    throw new LayoutError(`ctrl "${name}" not found from position ${from}`);
  }

  private findAll(predicate: Predicate): number[] {
    return this.components.flatMap((component, index) => (predicate(component) ? [index] : []));
  }

  private findOptional(predicate: Predicate): number | undefined {
    const matches = this.findAll(predicate);
    return matches[0];
  }

  private expect(index: number, type: string, name: string): number {
    const component = this.components[index];
    if (!component || component.type !== type) {
      throw new LayoutError(`ctrl "${name}" at ${index} expected ${type}, got ${describeComponent(component)}`);
    }
    return index;
  }

  private resolveIndexes(): CtrlIndexes {
    const byLabel =
      (type: string, label: string): Predicate =>
      (component) =>
        component.type === type && component.props.label === label;
    const byElem =
      (elemId: string): Predicate =>
      (component) =>
        component.props.elem_id === elemId;
    const withChoice =
      (type: string, choice: string): Predicate =>
      (component) =>
        component.type === type && choiceValues(component).includes(choice);

    const grid = this.expect(0, 'checkbox', 'generate_image_grid');
    const prompt = this.find('prompt', byElem('positive_prompt'));
    const negativePrompt = this.find('negative_prompt', byElem('negative_prompt'));
    const styles = this.find('style_selections', (component) => component.type === 'checkboxgroup', negativePrompt);
    const performance = this.find('performance', byLabel('radio', 'Performance'));
    const aspect = this.find('aspect_ratios', byLabel('radio', 'Aspect Ratios'));
    const imageNumber = this.find('image_number', byLabel('slider', 'Image Number'));
    const outputFormat = this.find('output_format', withChoice('radio', 'png'));
    const seed = this.find('seed', byLabel('textbox', 'Seed'));
    const sharpness = this.find('sharpness', byLabel('slider', 'Image Sharpness'));
    const cfgScale = this.find('cfg_scale', byLabel('slider', 'Guidance Scale'));
    const baseModel = this.find(
      'base_model',
      (component) => component.type === 'dropdown' && (component.props.label ?? '').startsWith('Base Model'),
    );
    const refiner = this.find(
      'refiner',
      (component) => component.type === 'dropdown' && (component.props.label ?? '').startsWith('Refiner ('),
    );
    const refinerSwitch = this.find('refiner_switch', byLabel('slider', 'Refiner Switch At'));

    const loras = this.findAll(
      (component) => component.type === 'dropdown' && /^LoRA \d+$/.test(component.props.label ?? ''),
    ).map((name) => ({
      enabled: this.expect(name - 1, 'checkbox', 'lora_enabled'),
      name,
      weight: this.expect(name + 1, 'slider', 'lora_weight'),
    }));
    if (loras.length === 0) {
      throw new LayoutError('No LoRA slots found');
    }

    const inputImageCheckbox = this.find('input_image_checkbox', byLabel('checkbox', 'Input Image'));
    const currentTab = this.find(
      'current_tab',
      (component) => component.type === 'textbox' && component.props.value === 'uov',
      inputImageCheckbox,
    );
    const uovMethod = this.find('uov_method', withChoice('radio', 'Vary (Subtle)'), currentTab);
    const uovImage = this.find('uov_input_image', (component) => component.type === 'image', currentTab);
    const outpaintDirections = this.find('outpaint_selections', withChoice('checkboxgroup', 'Left'), currentTab);
    const inpaintImage = this.find('inpaint_input_image', byElem('inpaint_canvas'));
    const inpaintAdditionalPrompt = this.find('inpaint_additional_prompt', byElem('inpaint_additional_prompt'));
    const inpaintMaskUpload = this.find('inpaint_mask_image_upload', byElem('inpaint_mask_canvas'));
    const disablePreview = this.find('disable_preview', byLabel('checkbox', 'Disable Preview'));
    const disableIntermediateResults = this.find(
      'disable_intermediate_results',
      byLabel('checkbox', 'Disable Intermediate Results'),
    );
    const disableSeedIncrement = this.find('disable_seed_increment', byLabel('checkbox', 'Disable seed increment'));
    const sampler = this.find('sampler', byLabel('dropdown', 'Sampler'));
    const scheduler = this.find('scheduler', byLabel('dropdown', 'Scheduler'));
    const mixingImagePromptAndVaryUpscale = this.find(
      'mixing_image_prompt_and_vary_upscale',
      byLabel('checkbox', 'Mixing Image Prompt and Vary/Upscale'),
    );
    const mixingImagePromptAndInpaint = this.find(
      'mixing_image_prompt_and_inpaint',
      byLabel('checkbox', 'Mixing Image Prompt and Inpaint'),
    );
    const inpaintDisableInitialLatent = this.find(
      'inpaint_disable_initial_latent',
      byLabel('checkbox', 'Disable initial latent in inpaint'),
      disableSeedIncrement,
    );
    const inpaintEngine = this.expect(inpaintDisableInitialLatent + 1, 'dropdown', 'inpaint_engine');
    const inpaintStrength = this.expect(inpaintDisableInitialLatent + 2, 'slider', 'inpaint_strength');
    const inpaintRespectiveField = this.expect(inpaintDisableInitialLatent + 3, 'slider', 'inpaint_respective_field');
    const inpaintAdvancedMasking = this.find(
      'inpaint_advanced_masking_checkbox',
      byLabel('checkbox', 'Enable Advanced Masking Features'),
    );
    const invertMask = this.find('invert_mask_checkbox', byLabel('checkbox', 'Invert Mask When Generating'));
    const inpaintErodeOrDilate = this.expect(invertMask + 1, 'slider', 'inpaint_erode_or_dilate');
    const saveMetadata = this.findOptional(byLabel('checkbox', 'Save Metadata to Images'));

    const cn = this.findAll(withChoice('radio', 'FaceSwap')).map((type) => ({
      image: this.expect(type - 3, 'image', 'cn_img'),
      stop: this.expect(type - 2, 'slider', 'cn_stop'),
      weight: this.expect(type - 1, 'slider', 'cn_weight'),
      type,
    }));
    if (cn.length === 0) {
      throw new LayoutError('No image prompt slots found');
    }

    const enhanceCheckbox = this.find('enhance_checkbox', byLabel('checkbox', 'Enhance'), invertMask);

    return {
      grid,
      prompt,
      negativePrompt,
      styles,
      performance,
      aspect,
      imageNumber,
      outputFormat,
      seed,
      sharpness,
      cfgScale,
      baseModel,
      refiner,
      refinerSwitch,
      loras,
      inputImageCheckbox,
      currentTab,
      uovMethod,
      uovImage,
      outpaintDirections,
      inpaintImage,
      inpaintAdditionalPrompt,
      inpaintMaskUpload,
      disablePreview,
      disableIntermediateResults,
      disableSeedIncrement,
      sampler,
      scheduler,
      mixingImagePromptAndVaryUpscale,
      mixingImagePromptAndInpaint,
      inpaintDisableInitialLatent,
      inpaintEngine,
      inpaintStrength,
      inpaintRespectiveField,
      inpaintAdvancedMasking,
      invertMask,
      inpaintErodeOrDilate,
      saveMetadata,
      cn,
      enhanceCheckbox,
    };
  }

  private component(index: number): GradioComponent {
    return this.components[index]!;
  }

  private readCapabilities(): FooocusCapabilities {
    const idx = this.indexes;
    const values = (index: number): string[] => choiceValues(this.component(index));
    const value = <T>(index: number): T => this.defaults[index] as T;
    const aspectRatios = values(idx.aspect).flatMap((label) => {
      const parsed = parseAspectLabel(label);
      return parsed ? [parsed] : [];
    });
    const defaultAspect = parseAspectLabel(value<string>(idx.aspect));
    return {
      models: values(idx.baseModel).filter((name) => name !== 'None'),
      refiners: values(idx.refiner),
      loras: values(idx.loras[0]!.name).filter((name) => name !== 'None'),
      styles: values(idx.styles),
      aspectRatios,
      performances: values(idx.performance),
      samplers: values(idx.sampler),
      schedulers: values(idx.scheduler),
      defaults: {
        model: value<string>(idx.baseModel),
        refiner: value<string>(idx.refiner),
        styles: value<string[]>(idx.styles) ?? [],
        aspect: defaultAspect?.raw ?? aspectRatios[0]?.raw ?? '1152*896',
        performance: value<string>(idx.performance),
        negativePrompt: value<string>(idx.negativePrompt) ?? '',
        imageNumber: value<number>(idx.imageNumber),
        cfgScale: value<number>(idx.cfgScale),
        sharpness: value<number>(idx.sharpness),
        loras: idx.loras.map((slot) => ({
          enabled: value<boolean>(slot.enabled),
          name: value<string>(slot.name),
          weight: value<number>(slot.weight),
        })),
      },
    };
  }

  aspectLabel(raw: string): string {
    const match = this.capabilities.aspectRatios.find((ratio) => ratio.raw === raw);
    if (!match) {
      throw new LayoutError(`Aspect ratio ${raw} is not offered by Fooocus`);
    }
    return match.label;
  }

  inpaintModeCtrls(mode: InpaintMode): [boolean, string, number, number] {
    const engine = this.defaults[this.indexes.inpaintEngine] as string;
    switch (mode) {
      case 'default':
        return [false, engine, 1.0, 0.618];
      case 'detail':
        return [false, 'None', 0.5, 0.0];
      case 'modify':
        return [true, engine, 1.0, 0.0];
    }
  }

  buildData(request: GenerationRequest, seed: string): unknown[] {
    const data = structuredClone(this.defaults);
    const idx = this.indexes;
    const set = (index: number, value: unknown): void => {
      data[index] = value;
    };

    set(idx.grid, false);
    set(idx.prompt, request.prompt);
    set(idx.negativePrompt, request.negativePrompt ?? this.capabilities.defaults.negativePrompt);
    if (request.styles) {
      set(idx.styles, request.styles);
    }
    if (request.performance) {
      set(idx.performance, request.performance);
    }
    set(idx.aspect, this.aspectLabel(request.aspect ?? this.capabilities.defaults.aspect));
    set(idx.imageNumber, request.imageNumber ?? this.capabilities.defaults.imageNumber);
    if (request.outputFormat) {
      set(idx.outputFormat, request.outputFormat);
    }
    set(idx.seed, seed);
    if (request.sharpness !== undefined) {
      set(idx.sharpness, request.sharpness);
    }
    if (request.cfgScale !== undefined) {
      set(idx.cfgScale, request.cfgScale);
    }
    if (request.baseModel) {
      set(idx.baseModel, request.baseModel);
    }
    if (request.refiner) {
      set(idx.refiner, request.refiner);
    }
    if (request.clearPresetLoras) {
      for (const slot of idx.loras) {
        set(slot.enabled, false);
        set(slot.name, 'None');
        set(slot.weight, 1);
      }
    }
    if (request.loras) {
      const free = idx.loras.filter((slot) => (data[slot.name] as string) === 'None');
      request.loras.slice(0, free.length).forEach((lora, position) => {
        const slot = free[position]!;
        set(slot.enabled, true);
        set(slot.name, lora.name);
        set(slot.weight, lora.weight);
      });
    }
    set(idx.disablePreview, false);
    set(idx.disableIntermediateResults, false);
    if (idx.saveMetadata !== undefined) {
      set(idx.saveMetadata, true);
    }
    set(idx.inputImageCheckbox, request.mode !== 'txt2img');
    set(idx.enhanceCheckbox, false);
    set(idx.mixingImagePromptAndVaryUpscale, false);
    set(idx.mixingImagePromptAndInpaint, false);
    set(idx.inpaintAdvancedMasking, false);
    set(idx.invertMask, false);

    switch (request.mode) {
      case 'txt2img':
        set(idx.currentTab, 'uov');
        break;
      case 'uov':
        set(idx.currentTab, 'uov');
        set(idx.uovMethod, request.method);
        set(idx.uovImage, request.image);
        break;
      case 'outpaint': {
        set(idx.currentTab, 'inpaint');
        set(idx.outpaintDirections, request.directions);
        set(idx.inpaintImage, { image: request.image, mask: request.mask });
        set(idx.inpaintAdditionalPrompt, '');
        this.applyInpaintMode(data, 'default');
        break;
      }
      case 'inpaint': {
        set(idx.currentTab, 'inpaint');
        set(idx.outpaintDirections, []);
        set(idx.inpaintImage, { image: request.image, mask: request.mask });
        set(idx.inpaintAdditionalPrompt, request.additionalPrompt ?? '');
        this.applyInpaintMode(data, request.inpaintMode);
        break;
      }
      case 'imageprompt': {
        set(idx.currentTab, 'ip');
        request.images.slice(0, idx.cn.length).forEach((entry, position) => {
          const slot = idx.cn[position]!;
          set(slot.image, entry.image);
          set(slot.stop, entry.stop ?? cnDefaults[entry.type].stop);
          set(slot.weight, entry.weight ?? cnDefaults[entry.type].weight);
          set(slot.type, entry.type);
        });
        break;
      }
    }
    return data;
  }

  private applyInpaintMode(data: unknown[], mode: InpaintMode): void {
    const [disableInitialLatent, engine, strength, respectiveField] = this.inpaintModeCtrls(mode);
    data[this.indexes.inpaintDisableInitialLatent] = disableInitialLatent;
    data[this.indexes.inpaintEngine] = engine;
    data[this.indexes.inpaintStrength] = strength;
    data[this.indexes.inpaintRespectiveField] = respectiveField;
  }

  describeSlot(index: number): string {
    return `${index}: ${describeComponent(this.components[index])}`;
  }
}
