import { LayoutError } from './types.js';

export interface GradioComponentProps {
  elem_id?: string;
  label?: string;
  choices?: unknown[];
  value?: unknown;
  [key: string]: unknown;
}

export interface GradioComponent {
  id: number;
  type: string;
  props: GradioComponentProps;
}

export interface GradioDependency {
  targets: number[];
  trigger: string;
  inputs: number[];
  outputs: number[];
  queue: boolean | null;
  trigger_after: number | null;
}

export interface GradioConfig {
  version: string;
  components: GradioComponent[];
  dependencies: GradioDependency[];
}

export interface Endpoints {
  stateId: number;
  getTask: number;
  generate: number;
  stop: number;
  describe: number;
  mask: number;
}

export async function fetchGradioConfig(baseUrl: string, timeoutMs = 5000): Promise<GradioConfig> {
  const response = await fetch(new URL('/config', baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new LayoutError(`GET /config returned ${response.status}`);
  }
  return (await response.json()) as GradioConfig;
}

export function componentIndex(config: GradioConfig): Map<number, GradioComponent> {
  return new Map(config.components.map((component) => [component.id, component]));
}

export function describeComponent(component: GradioComponent | undefined): string {
  if (!component) {
    return 'missing';
  }
  const elem = component.props.elem_id ? `#${component.props.elem_id}` : '';
  const label = component.props.label ? `[${component.props.label}]` : '';
  return `${component.type}${elem}${label}`;
}

function single(
  name: string,
  matches: number[],
  config: GradioConfig,
  byId: Map<number, GradioComponent>,
): number {
  if (matches.length === 1) {
    return matches[0]!;
  }
  const detail = matches
    .map((index) => {
      const dep = config.dependencies[index]!;
      return `#${index} inputs=${dep.inputs.map((id) => describeComponent(byId.get(id))).join(',')} outputs=${dep.outputs.map((id) => describeComponent(byId.get(id))).join(',')}`;
    })
    .join('\n');
  throw new LayoutError(`Expected exactly one ${name} dependency, found ${matches.length}\n${detail}`);
}

export function resolveEndpoints(config: GradioConfig): Endpoints {
  const byId = componentIndex(config);
  const deps = config.dependencies;
  const indexesWhere = (predicate: (dep: GradioDependency, index: number) => boolean): number[] =>
    deps.flatMap((dep, index) => (predicate(dep, index) ? [index] : []));
  const elemId = (id: number): string | undefined => byId.get(id)?.props.elem_id;
  const type = (id: number): string | undefined => byId.get(id)?.type;

  const getTask = single(
    'get_task',
    indexesWhere(
      (dep) =>
        dep.inputs.length >= 100 &&
        dep.outputs.length === 1 &&
        type(dep.outputs[0]!) === 'state' &&
        dep.inputs[0] === dep.outputs[0],
    ),
    config,
    byId,
  );
  const stateId = deps[getTask]!.outputs[0]!;

  const generate = single(
    'generate_clicked',
    indexesWhere(
      (dep) => dep.inputs.length === 1 && dep.inputs[0] === stateId && dep.outputs.length === 4 && dep.trigger === 'then',
    ),
    config,
    byId,
  );

  const stopButton = config.components.find((component) => component.props.elem_id === 'stop_button');
  if (!stopButton) {
    throw new LayoutError('No component with elem_id stop_button');
  }
  const stop = single(
    'stop',
    indexesWhere((dep) => dep.targets.includes(stopButton.id) && dep.queue === false && dep.inputs[0] === stateId),
    config,
    byId,
  );

  const describe = single(
    'describe',
    indexesWhere(
      (dep) =>
        dep.inputs.length === 3 &&
        dep.outputs.length === 2 &&
        elemId(dep.outputs[0]!) === 'positive_prompt' &&
        dep.queue === true,
    ),
    config,
    byId,
  );

  const mask = single(
    'generate_mask',
    indexesWhere(
      (dep) => dep.inputs.length === 10 && dep.outputs.length === 1 && elemId(dep.outputs[0]!) === 'inpaint_mask_canvas',
    ),
    config,
    byId,
  );

  return { stateId, getTask, generate, stop, describe, mask };
}
