export interface GeneratePayload {
  taskId: string;
  prompt: string;
  mediaType: 'image' | 'video' | 'text';
  aspectRatio?: string;
  referenceImageUrls?: string[];
  referenceImageRoles?: string[];
  modelId?: string;
  storyboardFrameUrl?: string;
  generatorMode?: 'TEXT' | 'STORYBOARD' | 'HYBRID';
  cameraMovement?: string;
  projectName?: string;
  projectId?: string;
  entityType?: string;
  duration?: number;
  numOutputs?: number;
  negativePrompt?: string;
}

export interface GenerateResult {
  success: boolean;
  outputUrls?: string[];
  error?: string;
  rawResponse?: any;
  points?: number;
  email?: string;
  actualMeta?: any;
  creditsUsed?: number;
}

export interface IAIDriver {
  generate(payload: GeneratePayload, tokens: { oauthToken?: string; cookies?: any[]; email?: string; accountId?: string }): Promise<GenerateResult>;
}
