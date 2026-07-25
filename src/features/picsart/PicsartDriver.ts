import { IAIDriver, GeneratePayload, GenerateResult } from '../../core/AIDriver.interface';

export class PicsartDriver implements IAIDriver {
  async generate(payload: GeneratePayload, tokens: { cookies?: any[] }): Promise<GenerateResult> {
    console.log(`[PicsartDriver] Generating media for task ${payload.taskId} using cookies count:`, tokens.cookies?.length);
    // Lõi sinh ảnh/video Picsart bằng Cookie sạch lấy từ DB PostgreSQL
    return {
      success: true,
      outputUrls: []
    };
  }
}
