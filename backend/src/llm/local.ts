// Local provider: authors items with each plugin's procedural author, so the full pipeline
// (prompt assembly → generation → five gates → render → bank) runs with no API key (Doc 01 §12,
// "dev bank seeded so no API key is needed"). It reads the L2 request it is sent and refuses a
// request whose structured copy disagrees with the prompt text, so the prompt is honoured.
import { parseL2 } from '../prompts/l2';
import { ProviderError, type GenerateRequest, type GenerateResult, type LlmProvider } from './provider';

export class LocalProvider implements LlmProvider {
  id = 'local';
  model = 'procedural-author-v1';

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!req.local) throw new ProviderError('local provider requires the structured request copy', false, 'malformed');
    const parsed = parseL2(req.request);
    const l = req.local;
    if (parsed.task_type !== l.taskType.def.id || parsed.count !== l.count || parsed.locale !== l.locale || (l.modality && parsed.modality !== l.modality))
      throw new ProviderError('L2 text and structured request disagree', false, 'malformed');
    if (!l.taskType.author) throw new ProviderError(`task type ${l.taskType.def.id} has no procedural author`, false, 'not_found');
    let items: unknown[];
    if (req.followUp) {
      // Repair turn: the procedural author cannot reason about errors; it re-emits the previous item.
      items = (JSON.parse(req.followUp.previous) as { items: unknown[] }).items;
    } else {
      items = l.taskType.author(
        { taskType: l.taskType.def, modality: l.modality, levers: l.levers, count: l.count, seed: l.seed, locale: l.locale, readingLevel: l.readingLevel, exclusionSignatures: l.exclusions },
        l.services,
      );
    }
    const text = JSON.stringify({ refusal: null, items });
    return {
      json: JSON.parse(text),
      text,
      usage: { inputTokens: Math.ceil((req.prefix.text.length + req.request.length) / 4), cachedInputTokens: Math.ceil(req.prefix.text.length / 4), outputTokens: Math.ceil(text.length / 4) },
      finishReason: 'STOP',
      modelId: this.model,
      costUsd: 0,
    };
  }

  async getModelInfo() {
    return { available: true, note: 'procedural authors from plugin folders' };
  }
}
