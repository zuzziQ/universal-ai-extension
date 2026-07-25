import { IAIDriver, GeneratePayload, GenerateResult } from '../../core/AIDriver.interface';

export class TopViewDriver implements IAIDriver {
  async generate(payload: GeneratePayload, tokens: { cookies?: any[] }): Promise<GenerateResult> {
    console.log(`[TopViewDriver] Generating media for task ${payload.taskId} using cookies count:`, tokens.cookies?.length);
    // Lõi sinh video TopView bằng Cookie sạch lấy từ DB PostgreSQL
    return {
      success: true,
      outputUrls: []
    };
  }
}
