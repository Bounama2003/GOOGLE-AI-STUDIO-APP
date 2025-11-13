
export enum Language {
  FR = 'fr',
  WO = 'wo',
  EN = 'en',
}

export interface ConversationTurn {
  speaker: 'user' | 'assistant';
  text: string;
}
