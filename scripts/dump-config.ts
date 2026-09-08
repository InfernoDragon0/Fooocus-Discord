import { loadConfig } from '../src/config.js';
import { fetchGradioConfig, resolveEndpoints } from '../src/fooocus/gradio-config.js';
import { CtrlLayout } from '../src/fooocus/params.js';

const config = loadConfig();
const gradio = await fetchGradioConfig(config.fooocus.baseUrl);
const endpoints = resolveEndpoints(gradio);
console.log(`Gradio ${gradio.version}, ${gradio.dependencies.length} dependencies, ${gradio.components.length} components`);
console.log('Endpoints', endpoints);
console.log(`get_task inputs: ${gradio.dependencies[endpoints.getTask]!.inputs.length}`);
console.log(`generate outputs: ${gradio.dependencies[endpoints.generate]!.outputs.length}`);
console.log(`describe inputs: ${gradio.dependencies[endpoints.describe]!.inputs.length}`);
console.log(`mask inputs: ${gradio.dependencies[endpoints.mask]!.inputs.length}`);

const layout = new CtrlLayout(gradio, gradio.dependencies[endpoints.getTask]!.inputs);
const { loras, cn, ...scalars } = layout.indexes;
console.log('Resolved ctrl positions');
for (const [name, index] of Object.entries(scalars)) {
  console.log(`  ${name.padEnd(34)} ${index === undefined ? 'absent' : layout.describeSlot(index)}`);
}
console.log(`  loras: ${loras.map((slot) => `${slot.enabled}/${slot.name}/${slot.weight}`).join(' ')}`);
console.log(`  cn:    ${cn.map((slot) => `${slot.image}/${slot.stop}/${slot.weight}/${slot.type}`).join(' ')}`);

const caps = layout.capabilities;
console.log('Capabilities');
console.log(`  models (${caps.models.length}): ${caps.models.join(', ')}`);
console.log(`  loras (${caps.loras.length}): ${caps.loras.join(', ')}`);
console.log(`  styles: ${caps.styles.length}`);
console.log(`  aspect ratios (${caps.aspectRatios.length}): ${caps.aspectRatios.map((ratio) => ratio.raw).join(' ')}`);
console.log(`  performances: ${caps.performances.join(', ')}`);
console.log('  defaults', caps.defaults);
