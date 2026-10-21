import type { RendererFn } from '@cognimetric/core';
const r: RendererFn = ({ item }) => ({ payload: { stem: item.blueprint.phases[0]?.stem, options: item.blueprint.phases[0]?.options ?? [] } });
export default r;
